import Foundation

/// Arbitrary JSON — used for `toolInput`, which has no fixed schema.
enum JSONValue: Decodable, Equatable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Double.self) {
            self = .number(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else {
            self = .object(try container.decode([String: JSONValue].self))
        }
    }

    var stringValue: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    subscript(key: String) -> JSONValue? {
        if case .object(let dict) = self { return dict[key] }
        return nil
    }

    /// Pretty multi-line rendering for the expanded tool-input view.
    var pretty: String {
        prettyLines(indent: "")
    }

    private func prettyLines(indent: String) -> String {
        let deeper = indent + "  "
        switch self {
        case .string(let value): return value
        case .number(let value):
            return value == value.rounded() && abs(value) < 1e15
                ? String(Int(value)) : String(value)
        case .bool(let value): return value ? "true" : "false"
        case .null: return "null"
        case .array(let items):
            if items.isEmpty { return "[]" }
            let body = items
                .map { "\(deeper)- \($0.prettyLines(indent: deeper))" }
                .joined(separator: "\n")
            return "\n" + body
        case .object(let dict):
            if dict.isEmpty { return "{}" }
            let body = dict.keys.sorted()
                .map { "\(deeper)\($0): \(dict[$0]!.prettyLines(indent: deeper))" }
                .joined(separator: "\n")
            return "\n" + body
        }
    }
}

/// One transcript entry, as returned by `GET /api/sessions/:id/transcript` and
/// carried inside WS `transcript_*` / `stream_tool_*` frames.
struct TranscriptEntry: Identifiable, Decodable, Equatable, Sendable {
    let id: String
    let type: String // "user" | "assistant" | "tool_use" | "tool_result" | "system"
    var content: String?
    var timestamp: String?
    var toolName: String?
    var toolInput: JSONValue?
    var toolUseId: String?
    var isError: Bool?
    var model: String?
    var agentId: String?
    var contentClamped: Bool?
    var contentLength: Int?
    /// Image attachments on conversation messages: `data:` URLs or bounded
    /// transcript `os-blob:` references resolved through the image endpoint.
    var images: [String]?
    /// Images an agent marked as the visual result of its work. A merged-change
    /// share uses the newest local screenshot when no walkthrough still exists.
    var featuredMedia: [String]?
    /// Set when this entry is an operational notice rather than a message —
    /// a runner line, a recap, a worker's report, a heads-up from another
    /// session. The server classifies it (protocol notices.ts) and strips the
    /// delivery plumbing out of `content`, so every kind renders through one
    /// row here instead of each client re-deriving its own.
    var notice: EntryNotice?
    /// Who sent this turn when it wasn't the session's driver — a teammate who
    /// steered in, or one whose answer was routed back from `senderVia`.
    var sender: String?
    var senderVia: String?

    var text: String { content ?? "" }

    var timestampDate: Date? {
        Session.parseISO(timestamp)
    }

    var isUser: Bool { type == "user" }
    var isAssistant: Bool { type == "assistant" }
    var isTool: Bool { type == "tool_use" || type == "tool_result" }
    var isSystem: Bool { type == "system" }
}

/// How an entry that isn't a message reads. One shape for all of them: a
/// title, how loudly to say it, optionally a body to put underneath, and at
/// most one action. Unknown `kind`s from a newer server still render, because
/// nothing here branches on it.
struct EntryNotice: Decodable, Equatable, Sendable {
    /// What produced it ("system", "recap", "worker-report", …). Carried for
    /// diagnostics; deliberately not a rendering switch.
    let kind: String
    let title: String
    /// "info" | "warn" | "error" — an unknown value reads as info.
    let tone: String
    /// "inline" (always shown) | "collapsed" (behind show/hide). Absent means
    /// the title is the whole notice.
    let body: String?
    let link: Link?
    /// A quiet state mark on an `info` notice: "merge", "deploy", "done".
    /// These lines used to open with an emoji of their own; the server strips
    /// it and names the state instead, so each client draws it in its own
    /// icon set. An unknown name renders as plain text.
    let icon: String?

    struct Link: Decodable, Equatable, Sendable {
        let label: String
        let sessionId: String
    }

    var showsBodyInline: Bool { body == "inline" }
    var isCollapsible: Bool { body == "collapsed" }

    /// The SF Symbol for `icon`. `tone.symbol` outranks it: a warning says
    /// more than a merge mark, and only one glyph fits the line.
    var iconSymbol: String? {
        switch icon {
        case "merge": "arrow.triangle.merge"
        case "deploy": "arrow.up.circle"
        case "done": "checkmark"
        default: nil
        }
    }
}
