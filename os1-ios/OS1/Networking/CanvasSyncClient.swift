import Foundation
import Observation

/// Native client for the server's one instance-wide tldraw room. It draws only
/// session cards, but keeps and patches the complete record map so web-created
/// shapes remain intact while native clients collaborate on card geometry.
@MainActor
@Observable
final class CanvasSyncClient {
    private(set) var cards: [CanvasCardRecord] = []
    private(set) var collaborators: [String] = []
    private(set) var state: CanvasConnectionState = .connecting

    private var records: [String: CanvasJSON] = [:]
    private var socket: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?
    private var keepAliveTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var sendTask: Task<Void, Never>?
    private var sessions: [Session] = []
    private var requestId = ""
    private var clientClock = 0
    private var connected = false
    private var stopped = true
    private var incompatible = false
    private var selectedShapeIds: [String] = []
    private var pendingDiffs: [Int: [String: CanvasJSON]] = [:]
    private var lastInboundAt = Date.distantPast

    func start(sessions: [Session]) {
        self.sessions = sessions
        guard stopped else { return }
        stopped = false
        incompatible = false
        open()
    }

    func update(sessions: [Session]) {
        self.sessions = sessions
        if connected { reconcileCards() }
    }

    func stop() {
        stopped = true
        connected = false
        incompatible = false
        receiveTask?.cancel()
        keepAliveTask?.cancel()
        reconnectTask?.cancel()
        sendTask?.cancel()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
    }

    func move(_ card: CanvasCardRecord, by translation: CGSize) {
        let nextX = card.x + translation.width
        let nextY = card.y + translation.height
        send(diff: [card.id: CanvasWire.cardPatch(x: nextX, y: nextY)])
    }

    func arrangeByActivity() {
        let relevant = CanvasSessionSet.relevant(sessions, claims: LaneStore.shared.claims)
        let bySession = Dictionary(uniqueKeysWithValues: cards.map { ($0.sessionId, $0) })
        var diff: [String: CanvasJSON] = [:]
        for (slot, session) in relevant.enumerated() {
            guard let card = bySession[session.id] else { continue }
            let point = CanvasSessionSet.slot(slot)
            diff[card.id] = CanvasWire.cardPatch(x: point.x, y: point.y)
        }
        send(diff: diff)
    }

    func select(_ card: CanvasCardRecord?) {
        selectedShapeIds = card.map { [$0.id] } ?? []
        sendPresence()
        guard let card, card.index != cards.last?.index else { return }
        send(diff: [card.id: CanvasWire.indexPatch(
            CanvasSessionSet.index(above: cards.map(\.index).max())
        )])
    }

    private func open() {
        guard !stopped, socket == nil,
              let base = ServerConfig.shared.baseURL,
              var components = URLComponents(url: base, resolvingAgainstBaseURL: false)
        else {
            if ServerConfig.shared.baseURL == nil { state = .offline("Server URL not set") }
            return
        }
        state = .connecting
        requestId = UUID().uuidString.lowercased()
        components.scheme = components.scheme == "http" ? "ws" : "wss"
        components.path = "/canvas-ws"
        components.queryItems = [
            URLQueryItem(name: "room", value: CanvasWire.roomId),
            URLQueryItem(name: "sessionId", value: "native-\(UUID().uuidString.lowercased())"),
        ]
        guard let url = components.url else {
            state = .offline("Canvas URL couldn't be built")
            return
        }
        let socket = URLSession.shared.webSocketTask(
            with: ServerConfig.shared.authorizedRequest(url)
        )
        socket.maximumMessageSize = 32 * 1024 * 1024
        self.socket = socket
        lastInboundAt = Date()
        socket.resume()
        enqueue(CanvasWire.connect(requestId: requestId))
        receiveTask = Task { [weak self] in await self?.receiveLoop(socket) }
        keepAliveTask = Task { [weak self] in await self?.keepAliveLoop(socket) }
    }

    private func receiveLoop(_ socket: URLSessionWebSocketTask) async {
        while !Task.isCancelled, !stopped {
            do {
                let message = try await socket.receive()
                let data: Data? = switch message {
                case .string(let value): Data(value.utf8)
                case .data(let value): value
                @unknown default: nil
                }
                guard let data else { continue }
                let frame = try await Task.detached(priority: .userInitiated) {
                    try JSONDecoder().decode(CanvasJSON.self, from: data)
                }.value
                guard self.socket === socket else { return }
                lastInboundAt = Date()
                receive(frame)
            } catch {
                guard self.socket === socket else { return }
                if socket.closeCode.rawValue == 4099 {
                    incompatible = true
                    state = .incompatible
                    stopSocket()
                } else if !stopped, !incompatible {
                    connectionLost(await Reachability.describe(error))
                }
                return
            }
        }
    }

    private func receive(_ frame: CanvasJSON) {
        guard let value = frame.objectValue,
              let type = value["type"]?.stringValue
        else { return }
        switch type {
        case "connect":
            guard value["connectRequestId"]?.stringValue == requestId else { return }
            guard value["protocolVersion"]?.numberValue == Double(CanvasWire.protocolVersion),
                  value["schema"] == CanvasWire.schema
            else {
                incompatible = true
                state = .incompatible
                stopSocket()
                return
            }
            if value["hydrationType"]?.stringValue == "wipe_all" {
                records.removeAll()
            } else {
                records = records.filter { $0.value.objectValue?["typeName"]?.stringValue != "instance_presence" }
            }
            if let diff = value["diff"] { CanvasWire.apply(diff: diff, to: &records) }
            connected = true
            state = .connected
            publishRecords()
            sendPresence()
            reconcileCards()
        case "data":
            for event in value["data"]?.arrayValue ?? [] { receive(event) }
        case "patch":
            if let diff = value["diff"] {
                CanvasWire.apply(diff: diff, to: &records)
                publishRecords()
            }
        case "push_result":
            let clock = value["clientClock"]?.numberValue.map(Int.init)
            let pending = clock.flatMap { pendingDiffs.removeValue(forKey: $0) }
            if value["action"]?.stringValue == "commit", let pending {
                CanvasWire.apply(diff: .object(pending), to: &records)
                publishRecords()
            } else if let action = value["action"]?.objectValue,
                      let diff = action["rebaseWithDiff"] {
                CanvasWire.apply(diff: diff, to: &records)
                publishRecords()
            } else if value["action"]?.stringValue == "discard", pending != nil {
                reconnect()
            }
        case "pong":
            break
        case "incompatibility_error":
            incompatible = true
            state = .incompatible
            stopSocket()
        default:
            break
        }
    }

    private func reconcileCards() {
        let relevant = CanvasSessionSet.relevant(sessions, claims: LaneStore.shared.claims)
        let listed = Set(sessions.map(\.id))
        let current = CanvasWire.cards(in: records)
        let currentBySession = Dictionary(uniqueKeysWithValues: current.map { ($0.sessionId, $0) })
        var diff: [String: CanvasJSON] = [:]

        // The polled list updates optimistically while archive requests are in
        // flight. Native therefore never deletes durable room geometry from a
        // transient absence; the web room owner cleans confirmed stale cards.
        let live = current.filter { listed.contains($0.sessionId) }
        let occupied = Set(live.map { CanvasSessionSet.slotKey(x: $0.x, y: $0.y) })
        var openSlots = (0..<(CanvasWire.limit * 4))
            .map(CanvasSessionSet.slot)
            .filter { !occupied.contains(CanvasSessionSet.slotKey(x: $0.x, y: $0.y)) }
        var nextIndex = CanvasSessionSet.index(above: current.map(\.index).max())
        for session in relevant where currentBySession[session.id] == nil {
            let point = openSlots.isEmpty
                ? CanvasSessionSet.slot(current.count + diff.count)
                : openSlots.removeFirst()
            let id = "shape:card-\(session.id)"
            let record = CanvasWire.cardRecord(
                id: id,
                sessionId: session.id,
                x: point.x,
                y: point.y,
                index: nextIndex
            )
            records[id] = record
            diff[id] = .array([.string("put"), record])
            nextIndex = CanvasSessionSet.index(above: nextIndex)
        }
        publishRecords()
        send(diff: diff)
    }

    private func publishRecords() {
        cards = CanvasWire.cards(in: records)
        let config = ServerConfig.shared
        collaborators = CanvasWire.collaborators(in: records).filter {
            !CanvasSessionSet.samePerson($0, config.userName)
                && !CanvasSessionSet.samePerson($0, config.githubLogin)
        }
    }

    private func send(diff: [String: CanvasJSON]) {
        guard connected, !diff.isEmpty else { return }
        let clock = nextClock()
        pendingDiffs[clock] = diff
        enqueue(CanvasWire.push(clientClock: clock, diff: diff))
    }

    private func sendPresence() {
        guard connected else { return }
        let config = ServerConfig.shared
        enqueue(CanvasWire.push(
            clientClock: nextClock(),
            presence: CanvasWire.presence(
                user: config.userName,
                login: config.githubLogin,
                selectedShapeIds: selectedShapeIds
            )
        ))
    }

    private func nextClock() -> Int {
        defer { clientClock += 1 }
        return clientClock
    }

    private func enqueue(_ frame: CanvasJSON) {
        guard let socket,
              let data = try? JSONEncoder().encode(frame),
              let text = String(data: data, encoding: .utf8)
        else { return }
        let previous = sendTask
        sendTask = Task {
            await previous?.value
            do {
                try await socket.send(.string(text))
            } catch {
                if !stopped, self.socket === socket {
                    connectionLost("Couldn't send Canvas changes")
                }
            }
        }
    }

    private func keepAliveLoop(_ socket: URLSessionWebSocketTask) async {
        while !Task.isCancelled, !stopped {
            try? await Task.sleep(for: .seconds(5))
            guard self.socket === socket else { return }
            if connected, Date().timeIntervalSince(lastInboundAt) > 12 {
                connectionLost("Canvas connection timed out")
                return
            }
            enqueue(.object(["type": .string("ping")]))
        }
    }

    private func connectionLost(_ message: String) {
        guard !stopped, !incompatible else { return }
        state = .offline(message)
        reconnect()
    }

    private func reconnect() {
        stopSocket()
        guard !stopped else { return }
        reconnectTask?.cancel()
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            self?.open()
        }
    }

    private func stopSocket() {
        connected = false
        receiveTask?.cancel()
        keepAliveTask?.cancel()
        sendTask?.cancel()
        pendingDiffs.removeAll()
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
    }
}

enum CanvasSessionSet {
    static func relevant(_ sessions: [Session], claims: Set<String>) -> [Session] {
        sessions
            .filter {
                $0.archived != true
                    && $0.desk != true
                    && ($0.spawnedBy?.isEmpty != false)
                    && (!$0.isAutomation || claims.contains($0.id))
            }
            .sorted {
                if ($0.waitingForInput == true) != ($1.waitingForInput == true) {
                    return $0.waitingForInput == true
                }
                return ($0.lastActivity ?? "") > ($1.lastActivity ?? "")
            }
            .prefix(CanvasWire.limit)
            .map { $0 }
    }

    static func slot(_ index: Int) -> CGPoint {
        CGPoint(
            x: CGFloat(index % CanvasWire.columns) * (CanvasWire.cardWidth + CanvasWire.cardGap),
            y: CGFloat(index / CanvasWire.columns) * (CanvasWire.cardHeight + CanvasWire.cardGap)
        )
    }

    static func slotKey(x: CGFloat, y: CGFloat) -> String {
        "\(Int((x / (CanvasWire.cardWidth + CanvasWire.cardGap)).rounded())):\(Int((y / (CanvasWire.cardHeight + CanvasWire.cardGap)).rounded()))"
    }

    /// Increment the positive integer portion of a tldraw fractional index.
    /// Existing jitter/fractional suffixes are intentionally skipped: the next
    /// integer is compact, valid, and strictly above the complete current key.
    static func index(above current: String?) -> String {
        guard let current, !current.isEmpty else { return "a1" }
        let digits = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
        let lowerA = Character("a").asciiValue ?? 97
        let lowerZ = Character("z").asciiValue ?? 122
        guard let first = current.first,
              let scalar = first.asciiValue,
              scalar >= lowerA,
              scalar <= lowerZ
        else { return current + "V" }
        let suffixLength = Int(scalar - lowerA) + 1
        let integer = Array(current.prefix(suffixLength + 1))
        guard integer.count == suffixLength + 1 else { return current + "V" }
        var suffix = Array(integer.dropFirst())
        for position in suffix.indices.reversed() {
            guard let value = digits.firstIndex(of: suffix[position]) else {
                return current + "V"
            }
            if value + 1 < digits.count {
                suffix[position] = digits[value + 1]
                return String(first) + String(suffix)
            }
            suffix[position] = digits[0]
        }
        guard scalar < lowerZ, let next = UnicodeScalar(Int(scalar) + 1) else {
            return current + "V"
        }
        return String(Character(next)) + String(repeating: "0", count: suffix.count + 1)
    }

    static func samePerson(_ lhs: String, _ rhs: String) -> Bool {
        let left = lhs.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let right = rhs.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !left.isEmpty, !right.isEmpty else { return false }
        return left == right || left.hasPrefix(right) || right.hasPrefix(left)
    }
}
