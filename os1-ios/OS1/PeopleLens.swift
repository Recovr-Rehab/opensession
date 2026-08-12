import Foundation

/// Who a row belongs to under the list's "My sessions" lens.
///
/// Two things make a row yours:
///
/// - a session of yours in it (automation runs never count as anyone's — they
///   carry their creator, not a person), or
/// - a CLAIM. Claiming is the per-user triage that pulls an automation's run,
///   or work someone else started, into your own list, and the web sidebar has
///   honored it since lanes went per-user (`focusWsRows` in
///   src/frontend/components/Sidebar.tsx). See `LaneStore`.
///
/// The app used to test only the first, which is how a workspace claimed in
/// the browser could be missing from the phone entirely: nothing in it was
/// started by you, it was opened by the machine identity, and the claim that
/// made it yours was invisible here.
///
/// The web's rule has a third clause this deliberately leaves out — a
/// workspace whose `createdBy` is you, even with no session of yours in it.
/// Measured against the live list it more than tripled one person's sidebar
/// (31 rows to 96), which is a different product decision from fixing a
/// missing row, so it stays a known difference rather than a quiet change.
///
/// One rule for every surface that asks the question — the live list, its
/// archived slice, and the Archived sheet — because three spellings of "mine"
/// is how they drift apart.
struct PeopleLens {
    /// Identity strings that count as you: display name, its first token
    /// (sessions store first names, e.g. "Jaap"), and the GitHub login.
    let names: Set<String>
    /// Session ids you have claimed (`LaneStore`).
    let claims: Set<String>

    @MainActor
    static func current() -> PeopleLens {
        var names: Set<String> = []
        let config = ServerConfig.shared
        let user = config.userName.trimmingCharacters(in: .whitespaces)
        if !user.isEmpty {
            names.insert(user.lowercased())
            if let first = user.split(separator: " ").first {
                names.insert(first.lowercased())
            }
        }
        let login = config.githubLogin
        if !login.isEmpty { names.insert(login.lowercased()) }
        return PeopleLens(names: names, claims: LaneStore.shared.claims)
    }

    /// A single session under the lens: yours to start with, or claimed.
    func isMine(_ session: Session) -> Bool {
        if claims.contains(session.id) { return true }
        guard !session.isAutomation, let startedBy = session.startedBy?.lowercased() else {
            return false
        }
        return names.contains(startedBy)
    }

    /// A sidebar row under the lens. A row is yours as soon as ONE of its
    /// sessions is — a workspace is shared work, not a possession.
    func owns(_ workspace: SidebarWorkspace) -> Bool {
        workspace.sessions.contains(where: isMine)
    }
}
