import Foundation
import Observation

/// Who on the team is looking at which session, app-wide — the sidebar's half
/// of presence (the session header's own facepile is per-session, and comes
/// from `SessionViewModel`).
///
/// It holds a WebSocket of its own rather than borrowing the open session's:
/// the list is the surface that needs this, and it is exactly when NO session
/// is open that there is no other socket to listen on. The connection never
/// sends `watch`, so it joins no session's watcher set and cannot make us look
/// present anywhere — a listener, not a viewer.
@MainActor
@Observable
final class PresenceStore {
    static let shared = PresenceStore()

    /// sessionId → the people on it, excluding us. Keyed this way because a
    /// row asks "who is on any of my sessions", once per row.
    private(set) var bySession: [String: [String]] = [:]

    private var socket: OS1Socket?
    private var reconnectTask: Task<Void, Never>?
    /// Server + token the live socket was opened for; signing in elsewhere or
    /// switching instances has to land on a new connection.
    private var connectedScope: String?

    /// Everyone else on any of these sessions — what a sidebar row shows. A
    /// person appears once even when the row holds several of their sessions.
    func viewers(of sessions: [Session]) -> [String] {
        guard !bySession.isEmpty else { return [] }
        var seen = Set<String>()
        var out: [String] = []
        for session in sessions {
            for user in bySession[session.id] ?? [] where seen.insert(user).inserted {
                out.append(user)
            }
        }
        return out
    }

    /// Connect (or reconnect after a sign-in change). Idempotent: called from
    /// the list's task and again whenever the app comes forward.
    func start() {
        let config = ServerConfig.shared
        guard config.isConfigured else { return stop() }
        let scope = "\(config.baseURLString)|\(config.token)"
        if socket != nil, connectedScope == scope { return }
        stop()
        connectedScope = scope
        let socket = OS1Socket()
        socket.onEvent = { [weak self] event in
            guard case .globalPresence(let viewing) = event else { return }
            self?.apply(viewing)
        }
        socket.onClose = { [weak self] _ in self?.scheduleReconnect() }
        self.socket = socket
        socket.connect()
    }

    /// Backgrounded, or the list went away. Faces are only true while the
    /// socket that reported them is up, so the map goes with it — a stale pile
    /// claiming a teammate is reading along is the bug this whole feature is
    /// meant to remove.
    func stop() {
        reconnectTask?.cancel()
        reconnectTask = nil
        socket?.disconnect()
        socket = nil
        connectedScope = nil
        bySession = [:]
    }

    /// Internal (not private) so tests can drive the store with raw frames
    /// without a live socket, the way `SessionViewModel.handle` is.
    func apply(_ viewing: [PresenceEntry]) {
        let me = ServerConfig.shared.userName
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        var next: [String: [String]] = [:]
        for entry in viewing {
            let first = entry.user.split(separator: " ").first?.lowercased() ?? ""
            guard !first.isEmpty, first != me else { continue }
            next[entry.sessionId, default: []].append(entry.user)
        }
        bySession = next
        // Faces need the roster; the frame carries names only.
        if !next.isEmpty {
            Task { await TeamDirectory.shared.ensureLoaded() }
        }
    }

    private func scheduleReconnect() {
        guard socket != nil else { return }
        bySession = [:]
        reconnectTask?.cancel()
        let scope = connectedScope
        reconnectTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(3))
            guard let self, !Task.isCancelled, self.connectedScope == scope else { return }
            // Force a fresh connection for the same scope.
            self.socket = nil
            self.connectedScope = nil
            self.start()
        }
    }
}
