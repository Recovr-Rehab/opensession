import Foundation

/// A human-to-human note interleaved into a session transcript. The agent
/// never receives it.
struct SessionNote: Codable, Identifiable, Equatable, Sendable {
    let id: String
    let user: String
    let text: String
    /// Milliseconds since 1970, matching the server store.
    let ts: Double
    let editedAt: Double?

    var date: Date { Date(timeIntervalSince1970: ts / 1_000) }
}
