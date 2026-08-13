import XCTest
import CoreGraphics
@testable import OS1

/// The folded card's tile shapes, which decide whether a picture is cropped to
/// the strip or shown whole. The numbers are the web card's (`tileBox` in
/// WalkthroughCard.tsx), so a walkthrough looks the same in both.
final class WalkthroughTileTests: XCTestCase {
    private let strip = WalkthroughTile.Metrics(width: 168, tallHeight: 105)
    private let shared = WalkthroughTile.Metrics(width: 330, tallHeight: 320)

    func testCropsMediaCloseToTheTileShape() {
        XCTAssertTrue(WalkthroughTile.crops(16 / 10))
        XCTAssertTrue(WalkthroughTile.crops(16 / 9))
        // A landscape screenshot keeps three quarters of itself down to about
        // 1.2, and a wide strip of UI up to about 2.13.
        XCTAssertTrue(WalkthroughTile.crops(1.21))
        XCTAssertTrue(WalkthroughTile.crops(2.12))
    }

    func testShowsMediaTheTileWouldCutTooMuchOfWhole() {
        // A phone screenshot: the crop would leave a status bar and a header.
        XCTAssertFalse(WalkthroughTile.crops(0.46))
        XCTAssertFalse(WalkthroughTile.crops(1.19))
        XCTAssertFalse(WalkthroughTile.crops(2.2))
        // Nothing is known about a picture that hasn't loaded, and a zero-sized
        // one is not a shape — both take the tile's own.
        XCTAssertTrue(WalkthroughTile.crops(0))
    }

    func testUnknownShapeTakesTheTileShape() {
        let box = WalkthroughTile.size(ratio: nil, in: strip)
        XCTAssertEqual(box.width, 168, accuracy: 0.01)
        XCTAssertEqual(box.height, 105, accuracy: 0.01)
    }

    func testCroppedTileKeepsItsWidth() {
        let box = WalkthroughTile.size(ratio: 16 / 9, in: strip)
        XCTAssertEqual(box.width, 168, accuracy: 0.01)
        XCTAssertEqual(box.height, 105, accuracy: 0.01)
    }

    func testWideMediaKeepsItsWidthAndIsShorter() {
        let box = WalkthroughTile.size(ratio: 9.23, in: strip)
        XCTAssertEqual(box.width, 168, accuracy: 0.01)
        XCTAssertEqual(box.height, 168 / 9.23, accuracy: 0.01)
    }

    func testTallMediaIsSizedByHeightSoItKeepsItsNeighboursScale() {
        let box = WalkthroughTile.size(ratio: 0.46, in: strip)
        XCTAssertEqual(box.height, 105, accuracy: 0.01)
        XCTAssertEqual(box.width, 105 * 0.46, accuracy: 0.01)
        // Sharing the card, the same picture gets the room the card has.
        let large = WalkthroughTile.size(ratio: 0.46, in: shared)
        XCTAssertEqual(large.height, 320, accuracy: 0.01)
        XCTAssertEqual(large.width, 320 * 0.46, accuracy: 0.01)
    }

    func testTallMediaNeverGrowsWiderThanTheRoomItHas() {
        // At 1.19 the tall height would be 380pt wide in a 330pt card, which
        // would run past the card's edge; the height gives way instead.
        let box = WalkthroughTile.size(ratio: 1.19, in: shared)
        XCTAssertLessThanOrEqual(box.width, 330)
        XCTAssertEqual(box.width, 330, accuracy: 0.01)
        XCTAssertEqual(box.height, 330 / 1.19, accuracy: 0.01)
    }

    func testEveryTileFitsTheRoomItWasGiven() {
        for ratio in stride(from: 0.2, through: 12.0, by: 0.05) {
            for metrics in [strip, shared] {
                let box = WalkthroughTile.size(ratio: CGFloat(ratio), in: metrics)
                XCTAssertLessThanOrEqual(
                    box.width, metrics.width + 0.01,
                    "ratio \(ratio) overflows its tile"
                )
                XCTAssertGreaterThan(box.width, 0)
                XCTAssertGreaterThan(box.height, 0)
            }
        }
    }
}
