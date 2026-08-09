import XCTest
@testable import OS1

/// The sidebar half of presence: `global_presence` → who shows on which row.
@MainActor
final class PresenceStoreTests: XCTestCase {
    override func tearDown() async throws {
        PresenceStore.shared.stop()
    }

    private func entry(_ user: String, _ sessionId: String) -> PresenceEntry {
        PresenceEntry(user: user, sessionId: sessionId)
    }

    /// A row stands for a whole workspace, so it asks about every session it
    /// holds — and a teammate sitting in two of them is still one face.
    func testRowViewersSpanTheWorkspaceAndDeduplicate() {
        let store = PresenceStore.shared
        store.apply([
            entry("Zzz Tester", "os-1"),
            entry("Qqq Tester", "os-2"),
            entry("Zzz Tester", "os-2"),
        ])

        XCTAssertEqual(
            store.viewers(of: [Session(id: "os-1"), Session(id: "os-2")]),
            ["Zzz Tester", "Qqq Tester"]
        )
        XCTAssertEqual(store.viewers(of: [Session(id: "os-2")]), ["Qqq Tester", "Zzz Tester"])
        XCTAssertTrue(store.viewers(of: [Session(id: "os-3")]).isEmpty)
    }

    /// Our own face never appears on a row — we know where we are.
    func testOurOwnPresenceIsFilteredOut() {
        let store = PresenceStore.shared
        let me = ServerConfig.shared.userName
        store.apply([entry(me, "os-1"), entry("Zzz Tester", "os-1")])

        XCTAssertEqual(store.viewers(of: [Session(id: "os-1")]), ["Zzz Tester"])
    }

    /// Stale faces are worse than none: dropping the socket empties the map.
    func testStopClearsEveryone() {
        let store = PresenceStore.shared
        store.apply([entry("Zzz Tester", "os-1")])
        XCTAssertFalse(store.viewers(of: [Session(id: "os-1")]).isEmpty)

        store.stop()
        XCTAssertTrue(store.viewers(of: [Session(id: "os-1")]).isEmpty)
    }

    func testGlobalPresenceFrameDecodes() {
        let json = #"""
        {"type":"global_presence","viewing":[
          {"user":"Kent","sessionId":"os-1"},
          {"user":"Michiel","sessionId":"os-2"}
        ]}
        """#
        guard case .globalPresence(let viewing) = ServerEvent.parse(Data(json.utf8)) else {
            return XCTFail("expected .globalPresence")
        }
        XCTAssertEqual(viewing, [
            PresenceEntry(user: "Kent", sessionId: "os-1"),
            PresenceEntry(user: "Michiel", sessionId: "os-2"),
        ])
    }

    /// A malformed entry is dropped rather than taking the frame with it.
    func testGlobalPresenceSkipsIncompleteEntries() {
        let json = #"""
        {"type":"global_presence","viewing":[{"user":"Kent"},{"sessionId":"os-2"},
          {"user":"Jaap","sessionId":"os-3"}]}
        """#
        guard case .globalPresence(let viewing) = ServerEvent.parse(Data(json.utf8)) else {
            return XCTFail("expected .globalPresence")
        }
        XCTAssertEqual(viewing, [PresenceEntry(user: "Jaap", sessionId: "os-3")])
    }
}
