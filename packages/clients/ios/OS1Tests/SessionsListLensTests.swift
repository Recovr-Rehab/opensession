import XCTest
@testable import OS1

/// The three list rules this app shares with the web sidebar: which spawned
/// workers earn a row, what grouping an unconfigured list starts on, and who
/// the Archived screen's Owner lens offers.
final class SessionsListLensTests: XCTestCase {
    private func sessions(_ json: String) throws -> [Session] {
        try JSONDecoder().decode([Session].self, from: Data(json.utf8))
    }

    // MARK: - Spawned workers

    func testSpawnedWorkerStaysOutOfTheListUntilItNeedsSomeone() throws {
        let all = try sessions(
            """
            [{"id":"os-plain"},
             {"id":"os-worker","spawnedBy":"os-plain"},
             {"id":"os-blocked","spawnedBy":"os-plain","waitingForInput":true},
             {"id":"os-claimed","spawnedBy":"os-plain"}]
            """
        )

        XCTAssertEqual(
            SessionsListViewModel.listedSessions(in: all, claimed: []).map(\.id),
            ["os-plain", "os-blocked"]
        )
        // Claiming one is the other way in — the same per-user triage that
        // pulls an automation's run into your list.
        XCTAssertEqual(
            SessionsListViewModel.listedSessions(in: all, claimed: ["os-claimed"]).map(\.id),
            ["os-plain", "os-blocked", "os-claimed"]
        )
    }

    func testAWorkerGetsNoRowButKeepsItsSession() throws {
        // The rule is applied while BUILDING rows, so a `@session:` link in a
        // transcript can still open the worker the run spawned.
        let all = try sessions(
            """
            [{"id":"os-parent","workspaceId":"ws-1"},
             {"id":"os-worker","workspaceId":"ws-2","spawnedBy":"os-parent"}]
            """
        )
        let prepared = SessionsListViewModel.prepared(all, hiding: [], restoring: [])

        XCTAssertEqual(prepared.active.map(\.id).sorted(), ["os-parent", "os-worker"])
        let rows = SessionsListViewModel.sidebarWorkspaces(
            in: SessionsListViewModel.listedSessions(in: prepared.active, claimed: [])
        )
        XCTAssertEqual(rows.map(\.id), ["workspace:ws-1"])
    }

    // MARK: - Default grouping

    func testOneProjectDefaultsToTheActivityBands() {
        XCTAssertEqual(SidebarGroupBy.fallback(repoCount: 1), .activity)
        XCTAssertEqual(SidebarGroupBy.fallback(repoCount: 4), .project)
        // Unknown until `/api/repos` answers: assume several, so an instance
        // that has them doesn't paint a flat list and re-band a moment later.
        XCTAssertEqual(
            SidebarGroupBy.fallback(repoCount: RepoCount.unknown), .project
        )
    }

    /// Six groupings became three, so every value this app has ever written
    /// has to still name one. Reading the old value IS the migration: nothing
    /// is rewritten until the next pick.
    func testEveryGroupingThisAppEverStoredStillNamesOne() {
        XCTAssertEqual(SidebarGroupBy.stored("inbox"), .activity)
        XCTAssertEqual(SidebarGroupBy.stored("recent"), .activity)
        XCTAssertEqual(SidebarGroupBy.stored("repo"), .project)
        XCTAssertEqual(SidebarGroupBy.stored("repo-inbox"), .project)
        // The default of every multi-project phone. Its repo bands are what
        // people are looking at, so it keeps them and takes the activity bands
        // in place of its status lanes.
        XCTAssertEqual(SidebarGroupBy.stored("repo-status"), .project)
        XCTAssertEqual(SidebarGroupBy.stored("status"), .status)
        // Unpicked, and anything a later version writes: the default decides,
        // and keeps deciding.
        XCTAssertNil(SidebarGroupBy.stored(""))
        XCTAssertNil(SidebarGroupBy.stored("repo-something-new"))
    }

    // MARK: - The person lens

    func testTheTwoLensValuesThisAppWroteBeforeReadAsTheirNewSpelling() {
        XCTAssertEqual(SidebarPersonLens.stored("mine"), SidebarPersonLens.me)
        XCTAssertEqual(SidebarPersonLens.stored("all"), SidebarPersonLens.everyone)
        XCTAssertEqual(SidebarPersonLens.stored(""), SidebarPersonLens.me)
        // A person key is already what it means.
        XCTAssertEqual(SidebarPersonLens.stored("Kent"), "kent")
    }

    /// One teammate reaches us as "Kent", "Kent de Bruin" and "kentdebruin"
    /// depending on where the name came from, so all three answer to one
    /// option — the web's `ownerMatchesPerson` rule.
    func testOnePersonAnswersToEverySpellingOfTheirName() {
        XCTAssertTrue(SidebarPersonLens.nameMatches("Kent de Bruin", key: "kent"))
        XCTAssertTrue(SidebarPersonLens.nameMatches("Kent", key: "kent de bruin"))
        XCTAssertFalse(SidebarPersonLens.nameMatches("Michiel", key: "kent"))
        XCTAssertFalse(SidebarPersonLens.nameMatches("", key: "kent"))
    }

    // MARK: - Auto-created rows

    @MainActor
    func testAgentsOwnWorkspaceIsAutoCreatedUntilAPersonJoinsIt() throws {
        let machine = try sessions(
            #"[{"id":"os-1","workspaceId":"ws-1","startedBy":"Automation"}]"#
        )
        let shared = try sessions(
            """
            [{"id":"os-1","workspaceId":"ws-1","startedBy":"Automation"},
             {"id":"os-2","workspaceId":"ws-1","startedBy":"Kent"}]
            """
        )

        let machineRow = SessionsListViewModel.sidebarWorkspaces(in: machine)[0]
        XCTAssertTrue(AutoCreatedOrigin.wasAutoCreated(machineRow))
        // Once a person joins it is shared work, not machine clutter: hiding
        // the row would hide that person's session too.
        let sharedRow = SessionsListViewModel.sidebarWorkspaces(in: shared)[0]
        XCTAssertFalse(AutoCreatedOrigin.wasAutoCreated(sharedRow))
    }

    @MainActor
    func testAnAutomationsRunIsNotAnAutoCreatedRow() throws {
        // An automation is a job somebody configured, and its runs carry that
        // name. These are one-off workspaces an agent opened for itself.
        let run = try sessions(
            #"[{"id":"os-1","workspaceId":"ws-1","startedBy":"Automation","automation":"nightly-triage"}]"#
        )
        let row = SessionsListViewModel.sidebarWorkspaces(in: run)[0]

        XCTAssertFalse(AutoCreatedOrigin.wasAutoCreated(row))
    }

    // MARK: - Archived owners

    private let roster = ["kent": "Kent", "michiel": "Michiel"]

    func testOwnerOptionsMergeBothSpellingsOfOnePerson() throws {
        let archive = try sessions(
            """
            [{"id":"a","startedBy":"Kent"},
             {"id":"b","startedBy":"Kent de Bruin"},
             {"id":"c","startedBy":"Michiel"},
             {"id":"d","startedBy":"worker os-019fe"},
             {"id":"e","startedBy":"Kent","automation":"nightly-triage"}]
            """
        )

        let owners = ArchivedOwners.options(in: archive, roster: roster, excluding: "")
        // One option per person, busiest first — never one per spelling, and
        // never the session ids the archive is otherwise full of.
        XCTAssertEqual(owners.map(\.label), ["Kent", "Michiel"])
        XCTAssertEqual(owners.map(\.key), ["kent", "michiel"])

        // Both spellings answer to the same option; an automation's run is
        // nobody's, however it was signed.
        XCTAssertTrue(ArchivedOwners.session(archive[0], hasOwner: "kent", roster: roster))
        XCTAssertTrue(ArchivedOwners.session(archive[1], hasOwner: "kent", roster: roster))
        XCTAssertFalse(ArchivedOwners.session(archive[4], hasOwner: "kent", roster: roster))
    }

    func testTheSignedInPersonIsNotOfferedAsATeammate() throws {
        let archive = try sessions(
            """
            [{"id":"a","startedBy":"Kent de Bruin"},{"id":"b","startedBy":"Michiel"}]
            """
        )

        XCTAssertEqual(
            ArchivedOwners.options(in: archive, roster: roster, excluding: "kent").map(\.label),
            ["Michiel"]
        )
    }

    func testSomeoneOutsideTheRosterStillFiltersUnderTheirRawName() throws {
        let archive = try sessions(#"[{"id":"a","startedBy":"Ada"}]"#)

        XCTAssertEqual(ArchivedOwners.ownerKey(of: archive[0], roster: roster), "ada")
        XCTAssertTrue(ArchivedOwners.session(archive[0], hasOwner: "ada", roster: roster))
        // …but is not offered as an option: an unfiltered list is mostly
        // spawned workers and integration senders.
        XCTAssertTrue(ArchivedOwners.options(in: archive, roster: roster, excluding: "").isEmpty)
    }
}
