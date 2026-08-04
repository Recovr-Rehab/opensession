import XCTest
@testable import OS1

/// Sidebar hides are shared with the web client through `/api/hides`, so the
/// keys this app writes must be exactly the ones the web sidebar uses.
final class HideStoreTests: XCTestCase {
    private func sessions(_ json: String) throws -> [Session] {
        try JSONDecoder().decode([Session].self, from: Data(json.utf8))
    }

    func testRowKeyUsesTheWebKeyForEachRowShape() throws {
        let rows = SessionsListViewModel.sidebarWorkspaces(
            in: try sessions(
                """
                [{"id":"bks-1","projectId":"prj-1"},
                 {"id":"bks-2","worktreeDir":"/home/u/worktrees/feature"},
                 {"id":"bks-3"}]
                """
            )
        )

        XCTAssertEqual(rows.map(HideStore.rowKey(for:)), [
            "workspace:prj-1",
            "wt:/home/u/worktrees/feature",
            "bks-3",
        ])
    }

    func testCandidateKeysCoverEveryRowAChatCanSitUnder() throws {
        let session = try sessions(
            #"[{"id":"bks-1","projectId":"prj-1","worktreeDir":"/home/u/worktrees/feature"}]"#
        )[0]

        XCTAssertEqual(HideStore.candidateKeys(for: session), [
            "bks-1",
            "workspace:prj-1",
            "wt:/home/u/worktrees/feature",
        ])
    }

    func testBlockedChatResurfacesItsHiddenRow() throws {
        let all = try sessions(
            """
            [{"id":"bks-1","projectId":"prj-1","waitingForInput":true},
             {"id":"bks-2","projectId":"prj-2"}]
            """
        )

        let prepared = SessionsListViewModel.prepared(
            all,
            hiding: [],
            restoring: [],
            hidden: ["workspace:prj-1", "workspace:prj-2"]
        )

        XCTAssertEqual(prepared.resurfacedHideKeys, ["workspace:prj-1"])
    }

    func testQuietChatsResurfaceNothing() throws {
        let all = try sessions(#"[{"id":"bks-1","projectId":"prj-1","isRunning":true}]"#)

        let prepared = SessionsListViewModel.prepared(
            all,
            hiding: [],
            restoring: [],
            hidden: ["workspace:prj-1"]
        )

        XCTAssertTrue(prepared.resurfacedHideKeys.isEmpty)
    }

    func testArchivedBlockedChatDoesNotResurfaceItsRow() throws {
        let all = try sessions(
            #"[{"id":"bks-1","projectId":"prj-1","waitingForInput":true,"archived":true}]"#
        )

        let prepared = SessionsListViewModel.prepared(
            all,
            hiding: [],
            restoring: [],
            hidden: ["workspace:prj-1"]
        )

        XCTAssertTrue(prepared.resurfacedHideKeys.isEmpty)
    }
}
