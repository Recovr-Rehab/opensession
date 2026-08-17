import Foundation

/// JSON values from tldraw's sync protocol. Canvas keeps the complete record
/// map, including record types the native board does not draw, so applying a
/// server patch can never erase web-authored content.
enum CanvasJSON: Codable, Equatable, Sendable {
    case object([String: CanvasJSON])
    case array([CanvasJSON])
    case string(String)
    case number(Double)
    case bool(Bool)
    case null

    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let decoded = try? value.decode(Bool.self) { self = .bool(decoded) }
        else if let decoded = try? value.decode(Double.self) { self = .number(decoded) }
        else if let decoded = try? value.decode(String.self) { self = .string(decoded) }
        else if let decoded = try? value.decode([CanvasJSON].self) { self = .array(decoded) }
        else { self = .object(try value.decode([String: CanvasJSON].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .object(let decoded): try value.encode(decoded)
        case .array(let decoded): try value.encode(decoded)
        case .string(let decoded): try value.encode(decoded)
        case .number(let decoded): try value.encode(decoded)
        case .bool(let decoded): try value.encode(decoded)
        case .null: try value.encodeNil()
        }
    }

    var objectValue: [String: CanvasJSON]? {
        guard case .object(let value) = self else { return nil }
        return value
    }

    var arrayValue: [CanvasJSON]? {
        guard case .array(let value) = self else { return nil }
        return value
    }

    var stringValue: String? {
        guard case .string(let value) = self else { return nil }
        return value
    }

    var numberValue: Double? {
        guard case .number(let value) = self else { return nil }
        return value
    }
}

struct CanvasCardRecord: Identifiable, Equatable, Sendable {
    let id: String
    let sessionId: String
    var x: CGFloat
    var y: CGFloat
    var width: CGFloat
    var height: CGFloat
    var index: String
}

enum CanvasConnectionState: Equatable, Sendable {
    case connecting
    case connected
    case offline(String)
    case incompatible
}

/// The shipped server contract (`@tldraw/sync-core` protocol 8 plus
/// `src/shared/canvas-schema.ts`). Kept in one place so a schema bump produces
/// one explicit native compatibility change rather than a partly-working room.
enum CanvasWire {
    static let roomId = "main"
    static let protocolVersion = 8
    static let cardWidth: CGFloat = 380
    static let cardHeight: CGFloat = 440
    static let cardGap: CGFloat = 56
    static let columns = 5
    static let limit = 30

    static let schema: CanvasJSON = {
        let raw = #"{"schemaVersion":2,"sequences":{"com.tldraw.store":5,"com.tldraw.asset":1,"com.tldraw.camera":1,"com.tldraw.document":2,"com.tldraw.instance":26,"com.tldraw.instance_page_state":5,"com.tldraw.page":1,"com.tldraw.instance_presence":6,"com.tldraw.pointer":1,"com.tldraw.shape":4,"com.tldraw.user":1,"com.tldraw.asset.image":6,"com.tldraw.asset.video":5,"com.tldraw.asset.bookmark":2,"com.tldraw.shape.arrow":8,"com.tldraw.shape.bookmark":2,"com.tldraw.shape.draw":5,"com.tldraw.shape.embed":4,"com.tldraw.shape.frame":1,"com.tldraw.shape.geo":12,"com.tldraw.shape.group":0,"com.tldraw.shape.highlight":4,"com.tldraw.shape.image":5,"com.tldraw.shape.line":5,"com.tldraw.shape.note":13,"com.tldraw.shape.text":4,"com.tldraw.shape.video":4,"com.tldraw.shape.session-card":0,"com.tldraw.binding.arrow":1}}"#
        return try! JSONDecoder().decode(CanvasJSON.self, from: Data(raw.utf8))
    }()

    static func connect(requestId: String, lastServerClock: Double = -1) -> CanvasJSON {
        .object([
            "type": .string("connect"),
            "connectRequestId": .string(requestId),
            "schema": schema,
            "protocolVersion": .number(Double(protocolVersion)),
            "lastServerClock": .number(lastServerClock),
        ])
    }

    static func presence(user: String, login: String, selectedShapeIds: [String]) -> CanvasJSON {
        .array([
            .string("put"),
            .object([
                // The server replaces these two fields with the authenticated
                // identity before validation and broadcast.
                "userId": .string("user:\((login.isEmpty ? user : login).lowercased())"),
                "userName": .string(user),
                "lastActivityTimestamp": .number(Date().timeIntervalSince1970 * 1_000),
                "followingUserId": .null,
                "color": .string("#0A84FF"),
                "camera": .null,
                "cursor": .null,
                "screenBounds": .null,
                "selectedShapeIds": .array(selectedShapeIds.map(CanvasJSON.string)),
                "currentPageId": .string("page:page"),
                "brush": .null,
                "scribbles": .array([]),
                "chatMessage": .string(""),
                "meta": .object(["client": .string("native")]),
            ]),
        ])
    }

    static func cardRecord(
        id: String,
        sessionId: String,
        x: CGFloat,
        y: CGFloat,
        index: String
    ) -> CanvasJSON {
        .object([
            "x": .number(Double(x)),
            "y": .number(Double(y)),
            "rotation": .number(0),
            "isLocked": .bool(false),
            "opacity": .number(1),
            "meta": .object([:]),
            "id": .string(id),
            "type": .string("session-card"),
            "parentId": .string("page:page"),
            "index": .string(index),
            "props": .object([
                "w": .number(Double(cardWidth)),
                "h": .number(Double(cardHeight)),
                "sessionId": .string(sessionId),
            ]),
            "typeName": .string("shape"),
        ])
    }

    static func cardPatch(x: CGFloat, y: CGFloat) -> CanvasJSON {
        .array([
            .string("patch"),
            .object([
                "x": .array([.string("put"), .number(Double(x))]),
                "y": .array([.string("put"), .number(Double(y))]),
            ]),
        ])
    }

    static func indexPatch(_ index: String) -> CanvasJSON {
        .array([
            .string("patch"),
            .object(["index": .array([.string("put"), .string(index)])]),
        ])
    }

    static func push(clientClock: Int, diff: [String: CanvasJSON]? = nil, presence: CanvasJSON? = nil) -> CanvasJSON {
        var frame: [String: CanvasJSON] = [
            "type": .string("push"),
            "clientClock": .number(Double(clientClock)),
        ]
        if let diff { frame["diff"] = .object(diff) }
        if let presence { frame["presence"] = presence }
        return .object(frame)
    }

    static func cards(in records: [String: CanvasJSON]) -> [CanvasCardRecord] {
        records.values.compactMap { record in
            guard let value = record.objectValue,
                  value["typeName"]?.stringValue == "shape",
                  value["type"]?.stringValue == "session-card",
                  let id = value["id"]?.stringValue,
                  let x = value["x"]?.numberValue,
                  let y = value["y"]?.numberValue,
                  let index = value["index"]?.stringValue,
                  let props = value["props"]?.objectValue,
                  let sessionId = props["sessionId"]?.stringValue
            else { return nil }
            return CanvasCardRecord(
                id: id,
                sessionId: sessionId,
                x: CGFloat(x),
                y: CGFloat(y),
                width: CGFloat(props["w"]?.numberValue ?? Double(cardWidth)),
                height: CGFloat(props["h"]?.numberValue ?? Double(cardHeight)),
                index: index
            )
        }
        .sorted { $0.index < $1.index }
    }

    static func collaborators(in records: [String: CanvasJSON]) -> [String] {
        Array(Set(records.values.compactMap { record in
            guard let value = record.objectValue,
                  value["typeName"]?.stringValue == "instance_presence"
            else { return nil }
            return value["userName"]?.stringValue
        })).sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    static func apply(diff: CanvasJSON, to records: inout [String: CanvasJSON]) {
        guard let operations = diff.objectValue else { return }
        for (id, operation) in operations {
            guard let parts = operation.arrayValue,
                  let kind = parts.first?.stringValue
            else { continue }
            switch kind {
            case "put":
                if parts.count > 1 { records[id] = parts[1] }
            case "patch":
                guard parts.count > 1,
                      let patch = parts[1].objectValue,
                      let current = records[id]
                else { continue }
                records[id] = applying(patch: patch, to: current)
            case "remove":
                records.removeValue(forKey: id)
            default:
                continue
            }
        }
    }

    static func applying(patch: [String: CanvasJSON], to value: CanvasJSON) -> CanvasJSON {
        switch value {
        case .object(var object):
            for (key, operation) in patch {
                apply(valueOperation: operation, key: key, to: &object)
            }
            return .object(object)
        case .array(var array):
            for (key, operation) in patch {
                guard let index = Int(key), array.indices.contains(index),
                      let next = applying(valueOperation: operation, to: array[index])
                else { continue }
                array[index] = next
            }
            return .array(array)
        default:
            return value
        }
    }

    private static func apply(
        valueOperation: CanvasJSON,
        key: String,
        to object: inout [String: CanvasJSON]
    ) {
        guard let operation = valueOperation.arrayValue,
              let kind = operation.first?.stringValue
        else { return }
        if kind == "delete" {
            object.removeValue(forKey: key)
            return
        }
        guard let current = object[key],
              let next = applying(valueOperation: valueOperation, to: current)
        else {
            if kind == "put", operation.count > 1 { object[key] = operation[1] }
            return
        }
        object[key] = next
    }

    private static func applying(valueOperation: CanvasJSON, to current: CanvasJSON) -> CanvasJSON? {
        guard let operation = valueOperation.arrayValue,
              let kind = operation.first?.stringValue
        else { return nil }
        switch kind {
        case "put":
            return operation.count > 1 ? operation[1] : current
        case "patch":
            guard operation.count > 1, let patch = operation[1].objectValue else { return current }
            return applying(patch: patch, to: current)
        case "append":
            guard operation.count > 2,
                  let expectedLength = operation[2].numberValue
            else { return current }
            switch (current, operation[1]) {
            case (.string(let lhs), .string(let rhs)) where lhs.utf16.count == Int(expectedLength):
                return .string(lhs + rhs)
            case (.array(let lhs), .array(let rhs)) where lhs.count == Int(expectedLength):
                return .array(lhs + rhs)
            default:
                return current
            }
        case "delete":
            return nil
        default:
            return current
        }
    }
}
