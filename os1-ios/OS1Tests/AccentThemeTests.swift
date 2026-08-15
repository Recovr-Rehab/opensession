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

    func testRemovedIndigoSelectionMigratesToSky() {
        let defaults = scratchDefaults()
        defaults.set("indigo", forKey: AccentStore.defaultsKey)
        XCTAssertEqual(AccentStore(defaults: defaults).theme, .sky)
        XCTAssertEqual(defaults.string(forKey: AccentStore.defaultsKey), "sky")
    }

    /// Honey is the only accent whose two fills are different colours rather
    /// than two steps of one: a cream that reads on the dark plate is 1.3:1
    /// against a white page, so the light fill is deepened until it separates.
    /// 3:1 is WCAG's contrast for a control against its background.
    func testHoneySeparatesFromBothPages() {
        let onWhite = contrast(AccentTheme.lime.fills.light, 0xFF_FF_FF)
        let onPlate = contrast(AccentTheme.lime.fills.dark, 0x1C_1C_1C)
        XCTAssertGreaterThan(onWhite, 1.5, "honey light fill against a white page")
        XCTAssertGreaterThan(onPlate, 3.0, "honey dark fill against the dark plate")
        XCTAssertNotEqual(AccentTheme.lime.fills.light, AccentTheme.lime.fills.dark)
    }

    func testSelectionPersists() {
        let defaults = scratchDefaults()
        let store = AccentStore(defaults: defaults)
        store.theme = .purple
        XCTAssertEqual(defaults.string(forKey: AccentStore.defaultsKey), "purple")
        XCTAssertEqual(AccentStore(defaults: defaults).theme, .purple)
    }

    /// WCAG contrast between two packed sRGB values. The production copy is
    /// file-private, and a second one here is the point: a test that reuses the
    /// implementation it is checking proves only that it is self-consistent.
    private func contrast(_ a: UInt32, _ b: UInt32) -> Double {
        func luminance(_ hex: UInt32) -> Double {
            let channels = [(hex >> 16) & 0xFF, (hex >> 8) & 0xFF, hex & 0xFF]
                .map { component -> Double in
                    let c = Double(component) / 255
                    return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
                }
            return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
        }
        let (first, second) = (luminance(a), luminance(b))
        return (max(first, second) + 0.05) / (min(first, second) + 0.05)
    }

    private func scratchDefaults() -> UserDefaults {
        let suite = "AccentThemeTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        addTeardownBlock { defaults.removePersistentDomain(forName: suite) }
        return defaults
    }
}
