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

    /// The guard that makes replacing a colour safe: the palette's fixed glyph
    /// has to be readable on it in both appearances. 3:1 is WCAG's non-text
    /// contrast, which is what an arrow in a disc is.
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

    /// Most jewel tones carry white; bright lime deliberately carries black.
    func testChromaticFillsUseTheirExpectedGlyphInk() {
        for theme in AccentTheme.allCases where theme != .mono {
            let expectsWhite = theme != .lime
            XCTAssertEqual(theme.glyphIsWhite(dark: false), expectsWhite, "\(theme.rawValue) light fill")
            XCTAssertEqual(theme.glyphIsWhite(dark: true), expectsWhite, "\(theme.rawValue) dark fill")
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

    func testRemovedGoldSelectionMigratesToLime() {
        let defaults = scratchDefaults()
        defaults.set("gold", forKey: AccentStore.defaultsKey)
        XCTAssertEqual(AccentStore(defaults: defaults).theme, .lime)
        XCTAssertEqual(defaults.string(forKey: AccentStore.defaultsKey), "lime")
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
