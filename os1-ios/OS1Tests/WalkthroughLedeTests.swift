import XCTest
@testable import OS1

/// The line a folded walkthrough says above its pictures. The rules are the web
/// card's (`walkthroughLede` in src/frontend/lib/walkthrough-lede.ts), so the
/// same writeup reads the same in both clients.
final class WalkthroughLedeTests: XCTestCase {
    private func lede(_ summary: String) -> String {
        SessionWalkthrough(summary: summary).lede
    }

    func testTakesTheFirstParagraph() {
        XCTAssertEqual(
            lede(
                """
                The composer now keeps its draft.
                Switching sessions no longer loses it.

                Verified at phone width.
                """
            ),
            "The composer now keeps its draft. Switching sessions no longer loses it."
        )
    }

    func testSkipsAHeadingAndAFenceBeforeTheProse() {
        XCTAssertEqual(
            lede(
                """
                ## What changed

                ```sh
                bun test
                ```

                The fold opens.
                """
            ),
            "The fold opens."
        )
    }

    func testReadsMarkupAsTheTextItRenders() {
        XCTAssertEqual(
            lede(
                "- **Sessions** now show a [walkthrough](https://os.tella.dev) "
                    + "with `--session-col` ![shot](/a.png) width."
            ),
            "Sessions now show a walkthrough with --session-col width."
        )
    }

    func testKeepsUnderscoresInsideAnIdentifier() {
        XCTAssertEqual(
            lede("Renamed publish_walkthrough to publish_demo."),
            "Renamed publish_walkthrough to publish_demo."
        )
    }

    func testHasNothingToSayAboutAnEmptyWriteup() {
        XCTAssertEqual(lede(""), "")
        XCTAssertEqual(lede("### Only a heading"), "")
    }
}
