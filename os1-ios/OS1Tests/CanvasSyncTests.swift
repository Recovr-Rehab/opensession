import XCTest
@testable import OS1

final class CanvasSyncTests: XCTestCase {
    func testCardRecordMatchesTheSharedShapeContract() {
        let value = CanvasWire.cardRecord(
            id: "shape:card-bks-1",
            sessionId: "bks-1",
            x: 120,
            y: 240,
            index: "a1"
        )
        let cards = CanvasWire.cards(in: ["shape:card-bks-1": value])

        XCTAssertEqual(cards, [
            CanvasCardRecord(
                id: "shape:card-bks-1",
                sessionId: "bks-1",
                x: 120,
                y: 240,
                width: CanvasWire.cardWidth,
                height: CanvasWire.cardHeight,
                index: "a1"
            )
        ])
    }

    func testApplyingNetworkDiffPreservesUnknownWebRecords() {
        let unknown: CanvasJSON = .object([
            "id": .string("shape:web-drawing"),
            "typeName": .string("shape"),
            "type": .string("draw"),
            "x": .number(10),
        ])
        let card = CanvasWire.cardRecord(
            id: "shape:card-bks-1",
            sessionId: "bks-1",
            x: 0,
            y: 0,
            index: "a1"
        )
        var records = ["shape:web-drawing": unknown, "shape:card-bks-1": card]

        CanvasWire.apply(
            diff: .object([
                "shape:card-bks-1": CanvasWire.cardPatch(x: 80, y: 40),
            ]),
            to: &records
        )

        XCTAssertEqual(records["shape:web-drawing"], unknown)
        XCTAssertEqual(CanvasWire.cards(in: records).first?.x, 80)
        XCTAssertEqual(CanvasWire.cards(in: records).first?.y, 40)
    }

    func testNestedPatchUpdatesCardSizeWithoutReplacingOtherProps() {
        let card = CanvasWire.cardRecord(
            id: "shape:card-bks-1",
            sessionId: "bks-1",
            x: 0,
            y: 0,
            index: "a1"
        )
        var records = ["shape:card-bks-1": card]
        CanvasWire.apply(
            diff: .object([
                "shape:card-bks-1": .array([
                    .string("patch"),
                    .object([
                        "props": .array([
                            .string("patch"),
                            .object(["w": .array([.string("put"), .number(520)])]),
                        ]),
                    ]),
                ]),
            ]),
            to: &records
        )

        let updated = CanvasWire.cards(in: records).first
        XCTAssertEqual(updated?.width, 520)
        XCTAssertEqual(updated?.height, CanvasWire.cardHeight)
        XCTAssertEqual(updated?.sessionId, "bks-1")
    }

    func testStringAppendUsesJavaScriptUTF16Offsets() {
        let value: CanvasJSON = .object(["label": .string("😀")])
        let result = CanvasWire.applying(
            patch: [
                "label": .array([.string("append"), .string(" done"), .number(2)]),
            ],
            to: value
        )
        XCTAssertEqual(result, .object(["label": .string("😀 done")]))
    }

    func testIndexesRemainUniqueBeyondTheInitialWorkingSet() {
        var index: String? = nil
        var seen = Set<String>()
        for _ in 0..<200 {
            index = CanvasSessionSet.index(above: index)
            XCTAssertTrue(seen.insert(index!).inserted)
        }
        XCTAssertEqual(CanvasSessionSet.index(above: "a1V"), "a2")
        XCTAssertEqual(CanvasSessionSet.index(above: "az"), "b00")
    }

    func testWorkingSetMatchesCanvasRulesAndPriority() {
        var recent = Session(id: "recent")
        recent.lastActivity = "2026-08-17T12:00:00Z"
        var waiting = Session(id: "waiting")
        waiting.waitingForInput = true
        waiting.lastActivity = "2026-08-17T10:00:00Z"
        var archived = Session(id: "archived")
        archived.archived = true
        var desk = Session(id: "desk")
        desk.desk = true
        var spawned = Session(id: "spawned")
        spawned.spawnedBy = "parent"
        var automation = Session(id: "automation")
        automation.startedBy = "timer (automation)"

        let result = CanvasSessionSet.relevant(
            [recent, archived, desk, spawned, automation, waiting],
            claims: []
        )

        XCTAssertEqual(result.map(\.id), ["waiting", "recent"])
    }

    func testGridSlotsUseTheWebCanvasGeometry() {
        XCTAssertEqual(CanvasSessionSet.slot(0), CGPoint(x: 0, y: 0))
        XCTAssertEqual(
            CanvasSessionSet.slot(CanvasWire.columns),
            CGPoint(x: 0, y: CanvasWire.cardHeight + CanvasWire.cardGap)
        )
        XCTAssertEqual(
            CanvasSessionSet.slotKey(
                x: CanvasWire.cardWidth + CanvasWire.cardGap + 2,
                y: CanvasWire.cardHeight + CanvasWire.cardGap - 2
            ),
            "1:1"
        )
    }
}
