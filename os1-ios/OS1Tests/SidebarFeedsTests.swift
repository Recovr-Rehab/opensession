import XCTest
@testable import OS1

final class SidebarFeedsTests: XCTestCase {
    func testHidingKeepsSourcesThisBuildDoesNotRender() {
        // The list is the account's, and the browser has bands the phone has
        // never heard of. Rewriting it must not quietly restore them.
        let stored = #"["loom","linear"]"#
        let next = SidebarFeeds.setting(SidebarFeeds.plain, hidden: true, in: stored)

        XCTAssertEqual(SidebarFeeds.decode(next), ["loom", "linear", "plain"])
    }

    func testShowingRemovesOnlyThatSource() {
        let stored = #"["loom","plain","linear"]"#
        let next = SidebarFeeds.setting(SidebarFeeds.plain, hidden: false, in: stored)

        XCTAssertEqual(SidebarFeeds.decode(next), ["loom", "linear"])
        XCTAssertFalse(SidebarFeeds.isHidden(SidebarFeeds.plain, in: next))
    }

    /// Both directions are no-ops when the value is already right — what lets
    /// `setVisible` skip the write (and the PUT behind it) on a repeat.
    func testSettingAnUnchangedValueLeavesTheListAlone() {
        let hidden = #"["plain"]"#
        XCTAssertEqual(
            SidebarFeeds.setting(SidebarFeeds.plain, hidden: true, in: hidden),
            hidden
        )
        let shown = #"["loom"]"#
        XCTAssertEqual(
            SidebarFeeds.setting(SidebarFeeds.plain, hidden: false, in: shown),
            shown
        )
    }

    /// A stored value we can't read means nothing hidden: a missing source
    /// with no way to explain it is worse than one that came back.
    func testMalformedStorageReadsAsNothingHidden() {
        for junk in ["", "null", "{}", "[1,2]", "not json"] {
            XCTAssertEqual(SidebarFeeds.decode(junk), [], junk)
            XCTAssertFalse(SidebarFeeds.isHidden(SidebarFeeds.plain, in: junk), junk)
        }
        XCTAssertEqual(
            SidebarFeeds.decode(
                SidebarFeeds.setting(SidebarFeeds.plain, hidden: true, in: "nonsense")
            ),
            ["plain"]
        )
    }

    func testDecodeTrimsBlanksAndDuplicates() {
        XCTAssertEqual(
            SidebarFeeds.decode(#"[" plain ","","plain","loom"]"#),
            ["plain", "loom"]
        )
    }
}
