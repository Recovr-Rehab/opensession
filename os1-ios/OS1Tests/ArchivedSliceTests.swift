import XCTest
@testable import OS1

/// The sessions list arrives in two pieces: a live slice on the 5s poll and an
/// archived index on its own, slower request. These pin the parts of that
/// split which are easy to get wrong in a way no screen would show — a
/// summary row mistaken for a whole session, and an older server whose one
/// response has to keep standing in for both.
final class ArchivedSliceTests: XCTestCase {
    private func sessions(_ json: String) throws -> [Session] {
        try JSONDecoder().decode([Session].self, from: Data(json.utf8))
    }

    /// A summary row says so. Without this the app can't tell one from a real
    /// session, and an archived session opens missing everything the index
    /// doesn't carry.
    func testIndexRowsDeclareThemselvesSummaries() throws {
        let rows = try sessions(
            """
            [{"id":"os-1","archived":true,"slim":true},
             {"id":"os-2","archived":true}]
            """
        )

        XCTAssertEqual(rows[0].slim, true)
        XCTAssertNil(rows[1].slim)
    }

    /// What the Archived screen renders has to survive the trip: an index row
    /// missing its repo or its author would filter wrong under the screen's
    /// own "mine" and repo lenses.
    func testIndexRowCarriesWhatTheArchivedScreenFiltersBy() throws {
        let row = try sessions(
            """
            [{"id":"os-1","archived":true,"slim":true,"title":"Sliced the list",
              "startedBy":"Kent","repo":"opensession","lastActivity":"2026-08-10T05:43:54.116Z"}]
            """
        )[0]

        XCTAssertEqual(row.displayTitle, "Sliced the list")
        XCTAssertEqual(row.startedBy, "Kent")
        XCTAssertEqual(row.effectiveRepo, "opensession")
        XCTAssertNotNil(row.lastActivityDate)
    }

    /// A server that predates `?archived=exclude` answers with the whole list.
    /// `prepared` still splits it, which is what keeps an older server on the
    /// old behaviour instead of an Archived screen that is permanently empty.
    func testAnOlderServersWholeListStillSplits() throws {
        let all = try sessions(
            """
            [{"id":"os-1"},
             {"id":"os-2","archived":true},
             {"id":"os-3","desk":true,"archived":true}]
            """
        )

        let prepared = SessionsListViewModel.prepared(
            all,
            hiding: [],
            restoring: [],
            hidden: []
        )

        XCTAssertEqual(prepared.active.map(\.id), ["os-1"])
        XCTAssertEqual(prepared.archived.map(\.id), ["os-2"])
    }

    /// A session restored on this device is held out of the archived list it
    /// just left, so a not-yet-refetched index can't flash it back.
    func testARestoredSessionLeavesTheArchivedSide() throws {
        let all = try sessions(#"[{"id":"os-1","archived":true}]"#)

        let prepared = SessionsListViewModel.prepared(
            all,
            hiding: [],
            restoring: ["os-1"],
            hidden: []
        )

        XCTAssertTrue(prepared.archived.isEmpty)
        XCTAssertEqual(prepared.active.map(\.id), ["os-1"])
        XCTAssertEqual(prepared.active[0].archived, false)
    }

    func testArchivedRowsSortNewestFirstAndUndatedRowsLast() throws {
        let rows = try sessions(
            """
            [{"id":"older","lastActivity":"2026-08-01T10:00:00.000Z"},
             {"id":"undated"},
             {"id":"newer","lastActivity":"2026-08-09T10:00:00.000Z"}]
            """
        )

        XCTAssertEqual(
            SessionsListViewModel.byRecency(rows).map(\.id),
            ["newer", "older", "undated"]
        )
    }
}
