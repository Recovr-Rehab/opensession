import XCTest
@testable import OS1

/// What belongs in the catch-up deck, and in what order.
///
/// These are the rules a screenshot can't check: every one of them is a session
/// that should NOT have been put in front of you (someone else's work, an
/// automation's own run, the Desk, something already read) or an ordering that
/// would send you through your inbox backwards.
final class CatchUpQueueTests: XCTestCase {
    private func session(
        _ id: String,
        startedBy: String? = "Kent",
        workspace: String? = nil,
        title: String = "A piece of work",
        lastActivity: String = "2026-08-10T10:00:00.000Z",
        createdAt: String = "2026-08-10T09:00:00.000Z"
    ) -> Session {
        var session = Session(id: id)
        session.title = title
        session.repo = "opensession"
        session.startedBy = startedBy
        session.workspaceId = workspace
        session.createdAt = createdAt
        session.lastActivity = lastActivity
        return session
    }

    private func build(
        _ sessions: [Session],
        names: [String: String] = [:],
        unread: Set<String>,
        viewer: String = "Kent",
        login: String = "kentdebruin"
    ) -> [CatchUpCard] {
        CatchUpQueue.build(
            sessions: sessions,
            workspaceNames: names,
            viewerName: viewer,
            viewerLogin: login,
            isUnread: { unread.contains($0.id) }
        )
    }

    /// The four exclusions, each of which would otherwise hand someone a card
    /// they can't or shouldn't act on.
    func testOnlyYourOwnUnreadWorkMakesTheDeck() {
        var archived = session("archived")
        archived.archived = true
        var automation = session("automation")
        automation.startedBy = "triage (automation)"
        var desk = session("desk")
        desk.desk = true
        let teammate = session("teammate", startedBy: "Michiel")
        let read = session("read")
        let mine = session("mine")

        let cards = build(
            [archived, automation, desk, teammate, read, mine],
            unread: ["archived", "automation", "desk", "teammate", "mine"]
        )

        XCTAssertEqual(cards.map(\.target.id), ["mine"])
    }

    /// A session you have never opened is not unread — `isUnread` is the
    /// store's judgement, and the queue must not second-guess it.
    func testNothingIsUnreadWithoutAMark() {
        XCTAssertTrue(build([session("a"), session("b")], unread: []).isEmpty)
    }

    /// One card per workspace, and the card acts on the freshest session in it:
    /// that is the one carrying the part you haven't seen.
    func testAWorkspaceCollapsesToOneCardTargetingItsFreshestSession() {
        let old = session(
            "old", workspace: "ws-1",
            lastActivity: "2026-08-10T09:30:00.000Z",
            createdAt: "2026-08-10T09:00:00.000Z"
        )
        let fresh = session(
            "fresh", workspace: "ws-1",
            lastActivity: "2026-08-10T11:00:00.000Z",
            createdAt: "2026-08-10T09:15:00.000Z"
        )

        let cards = build(
            [old, fresh],
            names: ["ws-1": "Catch up on iOS"],
            unread: ["old", "fresh"]
        )

        XCTAssertEqual(cards.count, 1)
        XCTAssertEqual(cards[0].title, "Catch up on iOS")
        XCTAssertEqual(cards[0].sessionCount, 2)
        XCTAssertEqual(cards[0].target.id, "fresh")
    }

    /// Newest first. An inbox you work top-down should hand you what moved most
    /// recently, not whatever order the list happened to arrive in.
    func testCardsRunNewestFirst() {
        let stale = session(
            "stale", workspace: "ws-stale",
            lastActivity: "2026-08-08T10:00:00.000Z"
        )
        let recent = session(
            "recent", workspace: "ws-recent",
            lastActivity: "2026-08-10T12:00:00.000Z"
        )
        let middle = session(
            "middle", workspace: "ws-middle",
            lastActivity: "2026-08-09T12:00:00.000Z"
        )

        let cards = build(
            [stale, recent, middle], unread: ["stale", "recent", "middle"]
        )

        XCTAssertEqual(cards.map(\.target.id), ["recent", "middle", "stale"])
    }

    /// One person arrives as several names. The deck has to credit them all to
    /// the same viewer or a teammate's sessions leak in — or, worse, your own
    /// stop showing up at all.
    func testOwnershipMatchesTheViewersOtherNames() {
        let byFullName = session("full", startedBy: "Kent de Bruin", workspace: "a")
        let byLogin = session("login", startedBy: "kentdebruin", workspace: "b")
        let byFirstName = session("first", startedBy: "Kent", workspace: "c")

        let cards = build(
            [byFullName, byLogin, byFirstName],
            unread: ["full", "login", "first"]
        )

        XCTAssertEqual(cards.count, 3)
    }

    /// The band's count and the deck's length are the same number, computed two
    /// different ways — the band counts rows to stay off the list's hot path.
    func testBandCountAgreesWithTheDeck() {
        let sessions = [
            session("a", workspace: "ws-1"),
            session("b", workspace: "ws-1"),
            session("c", workspace: "ws-2"),
            session("d", startedBy: "Michiel", workspace: "ws-3"),
        ]
        let unread: Set<String> = ["a", "b", "c", "d"]
        let rows = SessionsListViewModel.sidebarWorkspaces(
            in: sessions, workspaceNames: [:]
        )

        let counted = CatchUpQueue.unreadRowCount(
            in: rows,
            viewerName: "Kent",
            viewerLogin: "kentdebruin",
            isUnread: { unread.contains($0.id) }
        )

        XCTAssertEqual(counted, build(sessions, unread: unread).count)
        XCTAssertEqual(counted, 2)
    }
}

/// What a card SHOWS. The glance is derived from the transcript, and both ends
/// of it are easy to get wrong: a slash command reads as an opening prompt, and
/// "latest" is the last assistant message rather than the last entry.
final class CatchUpPreviewTests: XCTestCase {
    /// Decoded rather than constructed: `TranscriptEntry` is the wire shape,
    /// and the preview has to survive the wire.
    private func entry(_ id: String, _ type: String, _ content: String) -> TranscriptEntry {
        let object: [String: Any] = ["id": id, "type": type, "content": content]
        let data = try! JSONSerialization.data(withJSONObject: object)
        return try! JSONDecoder().decode(TranscriptEntry.self, from: data)
    }

    func testPreviewSkipsSlashCommandsAndTakesTheLastAssistantMessage() {
        let preview = CatchUpViewModel.preview(from: [
            entry("1", "user", "/model claude-opus-5"),
            entry("2", "user", "Make catch up good on iOS"),
            entry("3", "assistant", "Looking at the deck now."),
            entry("4", "tool_use", "bash"),
            entry("5", "assistant", "Done — the deck ships with undo."),
            entry("6", "tool_result", "ok"),
        ])

        XCTAssertEqual(preview.prompt, "Make catch up good on iOS")
        XCTAssertEqual(preview.latest, "Done — the deck ships with undo.")
        XCTAssertFalse(preview.failed)
    }

    /// A conversation with only an ask still has something worth showing.
    func testPreviewSurvivesAConversationWithNoReplyYet() {
        let preview = CatchUpViewModel.preview(from: [
            entry("1", "user", "Start on the widget"),
        ])

        XCTAssertEqual(preview.prompt, "Start on the widget")
        XCTAssertNil(preview.latest)
    }

    /// A long answer is cut on a line break, not mid-word — the card fades the
    /// tail out, and a fade over half a word reads as a rendering bug.
    func testLongTextIsClampedOnALineBreak() {
        let long = String(repeating: "a line of an answer\n", count: 200)
        let preview = CatchUpViewModel.preview(from: [
            entry("1", "assistant", long),
        ])

        let latest = try? XCTUnwrap(preview.latest)
        XCTAssertNotNil(latest)
        XCTAssertLessThan(latest?.count ?? .max, 1_300)
        XCTAssertFalse(latest?.hasSuffix("\n") ?? true)
        XCTAssertTrue(latest?.hasSuffix("answer") ?? false)
    }
}
