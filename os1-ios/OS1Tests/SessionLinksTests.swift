import XCTest
@testable import OS1

/// A session chip has room for about 38 characters, so what it spends them on
/// decides whether it says anything. These pin the rule that decides.
@MainActor
final class SessionLinksTests: XCTestCase {
    private let id = "bks-019fcead-adc4-7000-b0da-8a5af66819c7"

    override func setUp() async throws {
        SessionLinks.register(titles: [:])
    }

    /// The web strips this prefix wherever a title has to fit
    /// (`cleanSessionTitle`); a chip is exactly such a place.
    func testAutomationPrefixIsStripped() {
        for (title, expected) in [
            ("Simplify · PR #5517 Give floating surfaces a rounder corner",
             "Give floating surfaces a rounder corner"),
            ("Review · PR #92 Add team notes", "Add team notes"),
            ("Auto-fix · PR #5680 Retire rustls-webpki", "Retire rustls-webpki"),
            ("mention · pr #7 lowercase too", "lowercase too"),
        ] {
            XCTAssertEqual(SessionLinks.cleanTitle(title), expected, title)
        }
    }

    /// Only the automation forms go. A title that merely mentions a PR is the
    /// subject, not bookkeeping.
    func testOrdinaryTitlesAreLeftAlone() {
        for title in [
            "Give floating surfaces a rounder corner",
            "PR #5517 is failing on main",
            "Simplify the composer",
            "Rebase · resolve conflicts",
        ] {
            XCTAssertEqual(SessionLinks.cleanTitle(title), title, title)
        }
    }

    /// Stripping everything is no improvement on the boilerplate.
    func testTitleThatIsOnlyThePrefixKeepsIt() {
        XCTAssertEqual(SessionLinks.cleanTitle("Review · PR #92"), "Review · PR #92")
    }

    /// The label is what the reader sees, so the cleaning has to happen before
    /// the truncation rather than after it — otherwise the ellipsis lands
    /// inside the prefix and the chip says nothing at all.
    func testLabelCleansBeforeItTruncates() {
        SessionLinks.register(titles: [
            id: "Simplify · PR #5517 Give floating surfaces a rounder corner"
        ])
        let label = SessionLinks.label(for: id)
        XCTAssertTrue(label.hasPrefix("Give floating surfaces"), label)
        XCTAssertFalse(label.contains("#5517"), label)
    }

    /// An id we've never seen still links, labelled by its shortened id.
    func testUnknownIdFallsBackToAShortenedId() {
        XCTAssertEqual(SessionLinks.label(for: id), "bks-019fcead…")
    }
}
