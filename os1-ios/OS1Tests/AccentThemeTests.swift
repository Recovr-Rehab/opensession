import XCTest
@testable import OS1

final class AccentThemeTests: XCTestCase {
    func testPaletteHasTenDistinctOptions() {
        XCTAssertEqual(AccentTheme.allCases.count, 10)
        XCTAssertEqual(
            Set(AccentTheme.allCases.map { "\($0.fills.light)-\($0.fills.dark)" }).count,
            AccentTheme.allCases.count
        )
    }

    /// The guard that makes adding a colour safe: whatever ends up in `fills`,
    /// the derived glyph has to be readable on it in both appearances. 3:1 is
    /// WCAG's non-text contrast, which is what an arrow in a disc is.
    func testEveryAccentCarriesALegibleGlyph() {
        for theme in AccentTheme.allCases {
            for dark in [false, true] {
                let contrast = theme.glyphContrast(dark: dark)
                XCTAssertGreaterThan(
                    contrast, 3.0,
                    "\(theme.rawValue) (\(dark ? "dark" : "light")) glyph contrast \(contrast)"
                )
            }
        }
    }

    /// The shape every pair has to keep: the light-mode fill is the deeper end
    /// of the hue and carries a white glyph the way a filled primary button
    /// does; the dark-mode fill is the lighter end and carries a dark one. A
    /// light-mode fill pale enough to flip its glyph would put a near-black
    /// arrow on a pale disc on a white page, which reads as disabled.
    func testLightFillsCarryWhiteAndDarkFillsCarryBlack() {
        for theme in AccentTheme.allCases {
            XCTAssertTrue(theme.glyphIsWhite(dark: false), "\(theme.rawValue) light fill")
            XCTAssertFalse(theme.glyphIsWhite(dark: true), "\(theme.rawValue) dark fill")
        }
    }

    /// `mono` is the accent the app had before it had a setting — black on
    /// light, white on dark. Keeping it expressible in the same table is how we
    /// know the abstraction didn't lose anything.
    func testMonoReproducesTheOriginalMonochromeAccent() {
        XCTAssertEqual(AccentTheme.mono.fills.light, 0x00_00_00)
        XCTAssertEqual(AccentTheme.mono.fills.dark, 0xFF_FF_FF)
        // Black fill takes a white glyph, white fill a black one.
        XCTAssertEqual(AccentTheme.mono.glyphContrast(dark: false), 21, accuracy: 0.01)
        XCTAssertEqual(AccentTheme.mono.glyphContrast(dark: true), 21, accuracy: 0.01)
    }

    func testDefaultsToTealWhenNothingIsStored() {
        let store = AccentStore(defaults: scratchDefaults())
        XCTAssertEqual(store.theme, .teal)
    }

    func testUnknownStoredValueFallsBackRatherThanCrashing() {
        let defaults = scratchDefaults()
        defaults.set("chartreuse", forKey: AccentStore.defaultsKey)
        XCTAssertEqual(AccentStore(defaults: defaults).theme, .default)
    }

    func testLegacyBlueSelectionMigratesToSky() {
        let defaults = scratchDefaults()
        defaults.set("blue", forKey: AccentStore.defaultsKey)
        XCTAssertEqual(AccentStore(defaults: defaults).theme, .sky)
        XCTAssertEqual(defaults.string(forKey: AccentStore.defaultsKey), "sky")
    }

    func testSelectionPersists() {
        let defaults = scratchDefaults()
        let store = AccentStore(defaults: defaults)
        store.theme = .purple
        XCTAssertEqual(defaults.string(forKey: AccentStore.defaultsKey), "purple")
        XCTAssertEqual(AccentStore(defaults: defaults).theme, .purple)
    }

    private func scratchDefaults() -> UserDefaults {
        let suite = "AccentThemeTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        addTeardownBlock { defaults.removePersistentDomain(forName: suite) }
        return defaults
    }
}
