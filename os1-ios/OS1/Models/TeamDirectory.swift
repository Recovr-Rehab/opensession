import Foundation
import Observation

/// The team roster, fetched once per launch from `GET /api/people` and kept in
/// memory: first name → GitHub login, so a name that arrives over the wire
/// (presence viewers, `startedBy`) can be drawn as that person's face.
///
/// Keyed on the LOWERCASED FIRST NAME because that is the shape the server
/// sends everywhere — the WebSocket upgrade stamps each socket with the
/// signed-in person's first name, and chat integrations send full names whose
/// first token is the same key.
@MainActor
@Observable
final class TeamDirectory {
    static let shared = TeamDirectory()

    private(set) var githubLogins: [String: String] = [:]
    /// First name → the roster's own spelling of it. This is what merges one
    /// person's spellings for a filter: chat integrations write a full name
    /// where the web writes a first name, so "Kent" and "Kent de Bruin" must
    /// answer to one option (`ArchivedOwners`). The key already IS the first
    /// name, so no second map is needed the way the web needs one.
    private(set) var displayNames: [String: String] = [:]
    private var fullNames: [String: String] = [:]
    private var loading = false
    private var lastFailureAt: Date?

    /// GitHub login for a display name, or nil for someone outside the roster
    /// (the agent persona, "Anonymous", a teammate not yet in the config) —
    /// those fall back to a tinted initial.
    func githubLogin(for name: String) -> String? {
        guard let key = Self.key(name) else { return nil }
        return githubLogins[key]
    }

    /// Full name when the roster knows one, for accessibility labels and
    /// tooltips; otherwise whatever the wire called them.
    func fullName(for name: String) -> String {
        guard let key = Self.key(name) else { return name }
        return fullNames[key] ?? name
    }

    /// Fetch the roster unless it is already loaded or in flight. Failures
    /// retry after a cooldown instead of hammering a server that is down —
    /// a missing directory only costs initials.
    func ensureLoaded() async {
        guard githubLogins.isEmpty, !loading else { return }
        if let lastFailureAt, Date().timeIntervalSince(lastFailureAt) < 30 { return }
        loading = true
        defer { loading = false }
        guard let people = try? await OS1API.people() else {
            lastFailureAt = Date()
            return
        }
        for person in people {
            guard let key = Self.key(person.name) else { continue }
            displayNames[key] = person.name
            if let github = person.github, !github.isEmpty { githubLogins[key] = github }
            if let fullName = person.fullName, !fullName.isEmpty { fullNames[key] = fullName }
        }
        lastFailureAt = nil
    }

    private static func key(_ name: String) -> String? {
        name.trimmingCharacters(in: .whitespacesAndNewlines)
            .split(separator: " ")
            .first?
            .lowercased()
    }
}
