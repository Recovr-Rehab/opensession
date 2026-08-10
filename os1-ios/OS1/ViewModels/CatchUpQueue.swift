import Foundation

/// One card in the catch-up deck: everything unread under a single workspace.
///
/// A card is a WORKSPACE, not a session — the same grouping the sessions list
/// shows — because that is the unit a decision is made about: you are done with
/// a piece of work, not with one of its tabs.
struct CatchUpCard: Identifiable, Equatable, Sendable {
    /// The sidebar row's key (`workspace:…` / `worktree:…` / `session:…`), so a
    /// card keeps its identity across a refresh and SwiftUI can animate it.
    let id: String
    let title: String
    let repo: String
    /// Every unread session under the row — what a read or archive acts on.
    let sessions: [Session]
    /// Where a reply, an "open" or a read mark lands: the freshest session,
    /// which is the one carrying the part you haven't seen.
    let target: Session
    let lane: Session.Lane
    let isRunning: Bool
    let runStartedAt: Date?
    let lastActivity: Date

    var sessionCount: Int { sessions.count }
}

/// Builds the deck. Pure and `nonisolated` so it can be tested without a
/// server, a store or a view — the filter rules are the feature.
enum CatchUpQueue {
    /// Unread workspaces you own, newest first.
    ///
    /// The rules mirror the web deck (`src/frontend/components/CatchUpDeck.tsx`)
    /// so the two clients agree about what "unread work" means:
    /// not archived, not an automation's own session, not the Desk (a
    /// summonable overlay you read as you talk to it), started by you, and
    /// carrying activity past your read mark.
    nonisolated static func build(
        sessions: [Session],
        workspaceNames: [String: String],
        viewerName: String,
        viewerLogin: String,
        isUnread: (Session) -> Bool
    ) -> [CatchUpCard] {
        let mine = sessions.filter {
            qualifies(
                $0, viewerName: viewerName, viewerLogin: viewerLogin, isUnread: isUnread
            )
        }
        // Reuse the sidebar's own grouping rather than a second one: a card has
        // to be the row you would have tapped in the list, including its
        // legacy isolated-worktree fallbacks.
        return SessionsListViewModel
            .sidebarWorkspaces(in: mine, workspaceNames: workspaceNames)
            .map(card(for:))
            .sorted { $0.lastActivity > $1.lastActivity }
    }

    /// Whether one session belongs in the deck at all — see `build` for why
    /// each clause is here.
    nonisolated static func qualifies(
        _ session: Session,
        viewerName: String,
        viewerLogin: String,
        isUnread: (Session) -> Bool
    ) -> Bool {
        guard session.archived != true,
              !session.isAutomation,
              session.desk != true,
              let owner = session.startedBy,
              !owner.isEmpty,
              MessageAttribution.isViewer(
                  owner, viewerName: viewerName, viewerLogin: viewerLogin
              )
        else { return false }
        return isUnread(session)
    }

    /// How many cards the deck would have, counted off the sessions list's
    /// ALREADY-MEMOIZED grouping rather than by grouping again.
    ///
    /// The band that offers catch-up sits in the list's body, which re-evaluates
    /// on every poll over a list that can be thousands of rows — a second
    /// grouping pass there is the exact main-thread work `sidebarWorkspaces`
    /// caches to avoid. One predicate per row is not.
    nonisolated static func unreadRowCount(
        in rows: [SidebarWorkspace],
        viewerName: String,
        viewerLogin: String,
        isUnread: (Session) -> Bool
    ) -> Int {
        rows.reduce(into: 0) { total, row in
            let hit = row.sessions.contains {
                qualifies(
                    $0, viewerName: viewerName, viewerLogin: viewerLogin,
                    isUnread: isUnread
                )
            }
            if hit { total += 1 }
        }
    }

    private nonisolated static func card(for row: SidebarWorkspace) -> CatchUpCard {
        let target = row.sessions.max {
            ($0.lastActivityDate ?? .distantPast) < ($1.lastActivityDate ?? .distantPast)
        } ?? row.mainSession
        return CatchUpCard(
            id: row.id,
            title: row.title,
            repo: row.effectiveRepo,
            sessions: row.sessions,
            target: target,
            lane: row.lane,
            isRunning: row.isRunning,
            // The earliest start among the running sessions: the row has been
            // working since the first of them began, which is what the elapsed
            // clock on the card counts.
            runStartedAt: row.sessions
                .filter { $0.isRunning == true }
                .compactMap(\.runStartedDate)
                .min(),
            lastActivity: row.lastActivityDate
        )
    }
}
