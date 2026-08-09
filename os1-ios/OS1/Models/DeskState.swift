import Foundation

/// The Desk's live state (`GET /api/desk/state`; server: src/server/desk-state.ts).
///
/// A tolerant subset, like every other model here: optionals everywhere and
/// unknown fields ignored, so a server addition never breaks an older build.
struct DeskState: Decodable, Sendable, Equatable {
    struct Pr: Decodable, Sendable, Equatable {
        struct Checks: Decodable, Sendable, Equatable {
            let passed: Int
            let failed: Int
            let pending: Int
        }
        let number: Int
        let url: String?
        let state: String?
        let checks: Checks?

        /// A PR with no checks at all is not "green" — say nothing rather
        /// than imply a pass (mirrors the server's own wording).
        var label: String {
            let total = (checks?.passed ?? 0) + (checks?.failed ?? 0) + (checks?.pending ?? 0)
            guard let checks, total > 0 else { return "PR #\(number)" }
            let health: String
            if checks.failed > 0 { health = " · checks failing" }
            else if checks.pending > 0 { health = " · checks pending" }
            else { health = " · checks green" }
            return "PR #\(number)\(health)"
        }
    }

    struct Question: Decodable, Sendable, Equatable {
        /// Which transport answers this — `session` is a run's own
        /// AskUserQuestion (answered over the socket), `human` is an
        /// ask_human addressed to this user (answered over REST).
        let kind: String
        let questionId: String
        let text: String
        let options: [String]
    }

    struct WorkItem: Decodable, Sendable, Equatable, Identifiable {
        let sessionId: String
        let title: String
        let repo: String?
        let lastActivity: String?
        let question: Question?
        let pr: Pr?

        var id: String { sessionId }
    }

    struct Todo: Decodable, Sendable, Equatable, Identifiable {
        let id: String
        let text: String
        let due: String?
    }

    struct More: Decodable, Sendable, Equatable {
        let waiting: Int
        let running: Int
        let review: Int
        let todos: Int
    }

    let waiting: [WorkItem]
    let running: [WorkItem]
    let review: [WorkItem]
    let todos: [Todo]
    let more: More?

    var isQuiet: Bool { waiting.isEmpty && running.isEmpty && review.isEmpty }
    var isEmpty: Bool { isQuiet && todos.isEmpty }
}
