import Foundation

/// A team note on a session — a human-to-human message the agent never sees
/// (Plain's "internal note" concept). Backed by the session's chat channel
/// `session:<id>` (src/server/chat.ts), which the web viewer interleaves into
/// the transcript by timestamp; this is the same payload, decoded tolerantly.
struct SessionNote: Identifiable, Decodable, Equatable, Sendable {
    let id: String
    /// Sender's self-selected display name.
    var user: String
    var text: String
    /// Milliseconds since epoch — the server's own clock for chat.
    var ts: Double
    var images: [NoteImage]?

    var date: Date { Date(timeIntervalSince1970: ts / 1000) }

    /// The channel a note belongs to, as the chat API spells it.
    static func channel(for sessionId: String) -> String { "session:\(sessionId)" }
}

/// An image attached to a note. Only the metadata rides the frame; the bytes
/// come from the chat image endpoint.
struct NoteImage: Identifiable, Decodable, Equatable, Sendable {
    let id: String
    /// Original filename — used as the label and the alt text.
    var name: String
    var mime: String
}
