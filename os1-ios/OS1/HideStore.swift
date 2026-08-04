import Foundation
import Observation

/// Per-user sidebar hides — the personal counterpart to archiving.
///
/// Archiving is global (it removes a chat for the whole team), which is the
/// wrong tool for "this isn't mine to watch anymore" while a teammate is still
/// working in the chat. A hide is an overlay on a sidebar ROW key that only
/// ever affects one user; the chat keeps running and stays in everyone else's
/// sidebar. Same store the web sidebar writes (`GET/PUT /api/hides`, see
/// src/server/hides.ts and src/frontend/lib/hides.ts), so a row hidden on the
/// phone is hidden in the browser too.
///
/// There is deliberately no "Hidden" band: hiding means the row is off your
/// sidebar, not filed into a drawer. Search ignores hides — that's how a
/// hidden row is found again, and its context menu then offers to restore it.
/// Two rules keep a hide from swallowing work: a hidden row resurfaces (and
/// its entry is consumed) while one of its chats is blocked on a question, and
/// prompting in a chat clears its hide outright.
@Observable
@MainActor
final class HideStore {
    static let shared = HideStore()

    /// Sidebar row key → ISO timestamp of when this user hid it.
    private(set) var hides: [String: String] = [:]

    /// Bumped by every local write and by every hydrate. An in-flight GET that
    /// finishes after a local hide is discarded rather than resurrecting the
    /// row it just removed.
    private var generation = 0

    private init() {}

    /// Load this user's map from the server. Guarded like
    /// `NativePreferences.hydrate`: a stale response (server/user switched, or
    /// a hide landed meanwhile) is dropped.
    func hydrate() async {
        let requestContext = NativePreferences.context()
        generation += 1
        let requestGeneration = generation
        guard let loaded = try? await SettingsAPI.hides(user: requestContext.user) else { return }
        guard requestGeneration == generation,
              NativePreferences.context() == requestContext
        else { return }
        if loaded != hides { hides = loaded }
    }

    func isHidden(_ workspace: SidebarWorkspace) -> Bool {
        hides[Self.rowKey(for: workspace)] != nil
    }

    func hide(_ workspace: SidebarWorkspace) {
        let key = Self.rowKey(for: workspace)
        // The server drops over-long keys (src/server/hides.ts `clean`), which
        // would look like a hide that survives until the next hydrate.
        guard !key.isEmpty, key.count <= 128, hides[key] == nil else { return }
        hides[key] = Self.timestamp.string(from: .now)
        save()
    }

    /// Drop hide entries. Takes a list so a poll can consume several resurfaced
    /// rows in one write; idempotent.
    func clear(_ keys: [String]) {
        let doomed = keys.filter { hides[$0] != nil }
        guard !doomed.isEmpty else { return }
        for key in doomed { hides.removeValue(forKey: key) }
        save()
    }

    /// Clear the hide covering a chat, whichever row key its row uses. Called
    /// when the user PROMPTS in a chat: you can't be done with a chat you're
    /// actively working in, and "I replied but it's still gone" reads as a bug.
    /// Opening a hidden chat deliberately does NOT unhide it.
    func unhide(for session: Session) {
        clear(Self.candidateKeys(for: session))
    }

    private func save() {
        generation += 1
        let user = ServerConfig.shared.userName
        let snapshot = hides
        // Fire-and-forget, like the web: the map is local truth and a failed
        // PUT costs nothing worth an error banner.
        Task { _ = try? await SettingsAPI.saveHides(user: user, hides: snapshot) }
    }

    private static let timestamp: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    /// Translate a `SidebarWorkspace.id` into the key the web sidebar uses, so
    /// both clients hide the same row: `workspace:<id>` for a real workspace,
    /// `wt:<dir>` for a legacy isolated-worktree row, and the bare chat id for
    /// a solo chat. Only these forms may be persisted — the iOS-internal
    /// `worktree:` / `session:` prefixes would be invisible to the web.
    nonisolated static func rowKey(for workspace: SidebarWorkspace) -> String {
        let id = workspace.id
        if let dir = id.dropPrefix("worktree:") { return "wt:\(dir)" }
        if let sessionId = id.dropPrefix("session:") { return sessionId }
        return id
    }

    /// Every row key a chat can sit under. Used to clear a hide (over-clearing
    /// is safe — it only ever restores a row) and to spot the hidden rows a
    /// blocked chat should resurface.
    nonisolated static func candidateKeys(for session: Session) -> [String] {
        var keys = [session.id]
        if let projectId = session.projectId, !projectId.isEmpty {
            keys.append("workspace:\(projectId)")
        }
        if let dir = session.worktreeDir, !dir.isEmpty {
            keys.append("wt:\(dir)")
        }
        return keys
    }
}

private extension String {
    func dropPrefix(_ prefix: String) -> String? {
        hasPrefix(prefix) ? String(dropFirst(prefix.count)) : nil
    }
}
