import XCTest
@testable import OS1

@MainActor
final class PreferenceHydrationTests: XCTestCase {
    func testReadBeforeHydrationWinsOverOlderRemoteMark() {
        let store = ReadsStore()
        let session = Session(
            id: "bks-1",
            lastActivity: "2026-08-11T12:00:00.000Z"
        )

        store.markRead(session)
        store.applyHydrated(
            ["bks-1": "2026-08-11T11:00:00.000Z", "bks-2": "remote"],
            persist: false
        )

        XCTAssertTrue(store.hasHydrated)
        XCTAssertEqual(store.reads["bks-1"], "2026-08-11T12:00:00.000Z")
        XCTAssertEqual(store.reads["bks-2"], "remote")
    }

    func testUnreadIsUnknownUntilReadsHydrate() {
        let store = ReadsStore()
        let session = Session(
            id: "bks-1",
            lastActivity: "2026-08-11T12:00:00.000Z"
        )

        store.markUnread(session)
        XCTAssertFalse(store.isUnread(session))

        store.applyHydrated([:], persist: false)
        XCTAssertTrue(store.isUnread(session))
    }

    func testPinBeforeHydrationIsReplayedOverRemotePins() {
        let store = PinStore()
        let workspace = SidebarWorkspace(
            id: "session:bks-local",
            title: "Local",
            sessions: [Session(id: "bks-local")],
            mainSession: Session(id: "bks-local")
        )

        store.toggle(workspace)
        store.applyHydrated(["bks-remote"], persist: false)

        XCTAssertTrue(store.hasHydrated)
        XCTAssertEqual(store.pins, ["bks-local", "bks-remote"])
    }

    func testHideBeforeHydrationIsReplayedOverRemoteMap() {
        let store = HideStore()
        let workspace = SidebarWorkspace(
            id: "session:bks-local",
            title: "Local",
            sessions: [Session(id: "bks-local")],
            mainSession: Session(id: "bks-local")
        )

        store.hide(workspace)
        store.applyHydrated(
            ["bks-local": "remote", "bks-remote": "remote"],
            persist: false
        )

        XCTAssertTrue(store.hasHydrated)
        XCTAssertNotEqual(store.hides["bks-local"], "remote")
        XCTAssertEqual(store.hides["bks-remote"], "remote")
    }
}
