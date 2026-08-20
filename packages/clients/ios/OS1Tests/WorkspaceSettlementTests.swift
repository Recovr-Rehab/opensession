import XCTest
@testable import OS1

final class WorkspaceSettlementTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 2_000_000)

    private func facts(
        activity: TimeInterval = 1_000_000,
        blocked: Bool = false,
        openPullRequest: Bool = false,
        terminalSignature: String? = nil,
        terminalAt: TimeInterval? = nil
    ) -> WorkspaceLifecycleFacts {
        WorkspaceLifecycleFacts(
            key: "workspace:one",
            createdAt: Date(timeIntervalSince1970: 500_000),
            lastActivity: Date(timeIntervalSince1970: activity),
            blocked: blocked,
            hasOpenPullRequest: openPullRequest,
            terminalPullRequestSignature: terminalSignature,
            terminalPullRequestAt: terminalAt.map(Date.init(timeIntervalSince1970:))
        )
    }

    private func record(
        _ state: WorkspaceSettlementRecord.State,
        at: TimeInterval,
        signature: String? = nil
    ) -> WorkspaceSettlementRecord {
        WorkspaceSettlementRecord(
            state: state,
            at: ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: at)),
            terminalSignature: signature
        )
    }

    func testExplicitSettlementYieldsToNewerActivity() {
        XCTAssertTrue(WorkspaceLifecycle.state(
            facts: facts(activity: 1_000),
            record: record(.settled, at: 1_100),
            now: now,
            autoSettleDays: nil,
            autoSettlePullRequests: false
        ).settled)
        XCTAssertFalse(WorkspaceLifecycle.state(
            facts: facts(activity: 1_200),
            record: record(.settled, at: 1_100),
            now: now,
            autoSettleDays: nil,
            autoSettlePullRequests: false
        ).settled)
    }

    func testAttentionPinsAndSnoozesStayActive() {
        for state in [
            WorkspaceLifecycle.state(
                facts: facts(blocked: true), record: nil, now: now,
                autoSettleDays: 1, autoSettlePullRequests: true
            ),
            WorkspaceLifecycle.state(
                facts: facts(), record: nil, now: now,
                autoSettleDays: 1, autoSettlePullRequests: true, pinned: true
            ),
            WorkspaceLifecycle.state(
                facts: facts(), record: nil, now: now,
                autoSettleDays: 1, autoSettlePullRequests: true, snoozed: true
            ),
        ] {
            XCTAssertFalse(state.settled)
        }
    }

    func testFinishedPullRequestSettlesAndUnsettleSuppressesThatTerminalSet() {
        let terminal = facts(
            activity: 1_000,
            terminalSignature: "repo#1:MERGED",
            terminalAt: 1_100
        )
        XCTAssertEqual(WorkspaceLifecycle.state(
            facts: terminal,
            record: nil,
            now: now,
            autoSettleDays: nil,
            autoSettlePullRequests: true
        ).reason, .pullRequest)
        XCTAssertFalse(WorkspaceLifecycle.state(
            facts: terminal,
            record: record(.active, at: 1_200, signature: "repo#1:MERGED"),
            now: now,
            autoSettleDays: nil,
            autoSettlePullRequests: true
        ).settled)
    }

    func testOpenPullRequestBlocksInactivityAndUnsettleRestartsItsClock() {
        XCTAssertFalse(WorkspaceLifecycle.state(
            facts: facts(openPullRequest: true),
            record: nil,
            now: now,
            autoSettleDays: 1,
            autoSettlePullRequests: false
        ).settled)
        let recentUnsettle = now.addingTimeInterval(-12 * 60 * 60)
        XCTAssertFalse(WorkspaceLifecycle.state(
            facts: facts(),
            record: record(.active, at: recentUnsettle.timeIntervalSince1970),
            now: now,
            autoSettleDays: 1,
            autoSettlePullRequests: false
        ).settled)
    }

    func testActiveOrderUsesCreationRatherThanActivity() {
        func workspace(_ id: String, created: TimeInterval, activity: TimeInterval) -> SidebarWorkspace {
            var session = Session(id: id)
            session.createdAt = ISO8601DateFormatter().string(
                from: Date(timeIntervalSince1970: created)
            )
            session.lastActivity = ISO8601DateFormatter().string(
                from: Date(timeIntervalSince1970: activity)
            )
            return SidebarWorkspace(
                id: "session:\(id)",
                title: id,
                sessions: [session],
                mainSession: session
            )
        }
        let olderButBusy = workspace("older", created: 100, activity: 900)
        let newerButQuiet = workspace("newer", created: 200, activity: 300)
        let rows = [olderButBusy, newerButQuiet]
        let facts = Dictionary(uniqueKeysWithValues: rows.map {
            let rowFacts = WorkspaceLifecycle.facts(for: $0)
            return (rowFacts.key, rowFacts)
        })

        XCTAssertEqual(
            WorkspaceLifecycle.sortActive(rows, facts: facts).map(\.title),
            ["newer", "older"]
        )
    }

    func testAssociatedPullRequestDecodesLifecycleFields() throws {
        let data = Data(#"{"repo":"api","branch":"feature","number":42,"url":"https://github.com/tellahq/api/pull/42","state":"MERGED","updatedAt":"2026-08-20T12:00:00Z"}"#.utf8)
        let pullRequest = try JSONDecoder().decode(SessionPrRef.self, from: data)

        XCTAssertEqual(pullRequest.number, 42)
        XCTAssertEqual(pullRequest.state, "MERGED")
        XCTAssertEqual(pullRequest.updatedAt, "2026-08-20T12:00:00Z")
    }
}
