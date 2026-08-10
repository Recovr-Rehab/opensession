import SwiftUI
import Observation
#if os(macOS)
import AppKit
#else
import UIKit
#endif

/// The app's primary colour, as data.
///
/// Every accent surface reads `OS1VisualStyle.accent` / `.onAccent`, and those
/// read the case selected here — the composer's send disc, the new-session
/// start disc, the app-wide `.tint` that colours system controls, an active
/// glyph. Changing the whole app's primary colour is therefore one value, and
/// ADDING a colour is one line in `fills`: a name, and the two hexes it wears
/// in light and dark.
///
/// What sits ON the accent is deliberately NOT part of that table. It is
/// derived from the fill's own luminance — whichever of black or white
/// contrasts more — so a colour can never ship with an illegible glyph, and
/// nobody adding one has to remember to pick its counterpart. The light values
/// are the deeper end of each hue so a white glyph clears ~3.5:1 (about where
/// Apple's own tinted fills sit); the dark values are the lighter end so the
/// fill reads against a black page, and they take a near-black glyph.
enum AccentTheme: String, CaseIterable, Identifiable, Sendable {
    case teal
    case sky
    case blue
    case indigo
    case purple
    case pink
    case coral
    case orange
    case green
    case mono

    static let `default` = AccentTheme.teal

    var id: String { rawValue }

    var title: String {
        switch self {
        case .teal: "Teal"
        case .sky: "Sky"
        case .blue: "Cobalt"
        case .indigo: "Indigo"
        case .purple: "Violet"
        case .pink: "Rose"
        case .coral: "Coral"
        case .orange: "Tangerine"
        case .green: "Clover"
        case .mono: "Mono"
        }
    }

    /// The one table. `mono` is the app's original monochrome accent — black on
    /// light, white on dark — expressed as just another entry, which is the
    /// check that this abstraction didn't lose anything.
    var fills: (light: UInt32, dark: UInt32) {
        switch self {
        case .teal: (0x14_8F_A3, 0x4F_C9_DE)
        case .sky: (0x24_7C_CB, 0x72_C3_FF)
        case .blue: (0x31_5D_C6, 0x7D_A3_FF)
        case .indigo: (0x52_46_C7, 0xA4_99_FF)
        case .purple: (0x7D_3D_BA, 0xC9_9B_FF)
        case .pink: (0xBE_32_6A, 0xFF_8C_B6)
        case .coral: (0xC9_4F_45, 0xFF_98_8A)
        case .orange: (0xB6_5A_00, 0xFF_A2_4D)
        case .green: (0x24_7A_49, 0x59_D2_8D)
        case .mono: (0x00_00_00, 0xFF_FF_FF)
        }
    }

    /// The fill itself, resolved per appearance.
    var accent: Color {
        Color(platformColor: AccentTheme.dynamic(
            light: AccentTheme.platformColor(fills.light),
            dark: AccentTheme.platformColor(fills.dark)
        ))
    }

    /// What sits on top of the fill — the glyph in the send disc. Derived, not
    /// chosen: white, the way a filled primary button reads everywhere, unless
    /// the fill is pale enough that white drops under the 3:1 that non-text
    /// contrast asks for (`whiteGlyphCeiling`) — which is exactly the case for
    /// the lighter value each colour wears in dark mode.
    var onAccent: Color {
        Color(platformColor: AccentTheme.dynamic(
            light: AccentTheme.contrasting(fills.light),
            dark: AccentTheme.contrasting(fills.dark)
        ))
    }

    /// A flat, appearance-independent swatch — for anywhere the two values have
    /// to be shown side by side rather than resolved.
    func swatch(dark: Bool) -> Color {
        Color(platformColor: AccentTheme.platformColor(dark ? fills.dark : fills.light))
    }

    /// Whether the derived glyph on this fill is white. Together with
    /// `glyphContrast` this is what the test suite holds every case to, so
    /// adding a colour to `fills` cannot quietly ship a send disc whose arrow
    /// can't be read, or a light-mode fill so pale the arrow turns dark.
    func glyphIsWhite(dark: Bool) -> Bool {
        AccentTheme.luminance(dark ? fills.dark : fills.light) <= AccentTheme.whiteGlyphCeiling
    }

    /// How much contrast the derived glyph gets on this fill.
    func glyphContrast(dark: Bool) -> Double {
        let fill = AccentTheme.luminance(dark ? fills.dark : fills.light)
        let glyph = glyphIsWhite(dark: dark) ? 1.0 : 0.0
        return (max(fill, glyph) + 0.05) / (min(fill, glyph) + 0.05)
    }

    /// The fill luminance at which a white glyph lands on exactly 3:1.
    static let whiteGlyphCeiling = 1.05 / 3.0 - 0.05

    // ── Colour maths ──────────────────────────────────────────────────────

    private static func platformColor(_ hex: UInt32) -> PlatformColor {
        PlatformColor(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            alpha: 1
        )
    }

    private static func contrasting(_ hex: UInt32) -> PlatformColor {
        luminance(hex) <= whiteGlyphCeiling ? .white : .black
    }

    /// WCAG relative luminance.
    private static func luminance(_ hex: UInt32) -> Double {
        let channels = [(hex >> 16) & 0xFF, (hex >> 8) & 0xFF, hex & 0xFF]
            .map { component -> Double in
                let c = Double(component) / 255
                return c <= 0.03928 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4)
            }
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
    }

    private static func dynamic(light: PlatformColor, dark: PlatformColor) -> PlatformColor {
        #if os(macOS)
        NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? dark : light
        }
        #else
        UIColor { traits in
            traits.userInterfaceStyle == .dark ? dark : light
        }
        #endif
    }
}

#if os(macOS)
typealias PlatformColor = NSColor
#else
typealias PlatformColor = UIColor
#endif

extension Color {
    init(platformColor: PlatformColor) {
        #if os(macOS)
        self.init(nsColor: platformColor)
        #else
        self.init(uiColor: platformColor)
        #endif
    }
}

/// The selected accent, and the reason `OS1VisualStyle.accent` is a computed
/// property rather than the `static let` it used to be: a view that reads the
/// accent inside its `body` reads `theme` through it, so Observation registers
/// the dependency and every accent surface in the app repaints the moment the
/// picker changes — no relaunch, no notification plumbing, no environment key
/// threaded through a hundred views.
@Observable
final class AccentStore {
    static let shared = AccentStore()

    /// Shares the `os1.appearance.*` namespace with the light/dark setting it
    /// sits beside; like that one, it is this device's choice rather than
    /// account state, so it stays in `UserDefaults` and is not mirrored into
    /// the server's ui-prefs.
    static let defaultsKey = "os1.appearance.accent"

    @ObservationIgnored private let defaults: UserDefaults

    var theme: AccentTheme {
        didSet {
            guard theme != oldValue else { return }
            defaults.set(theme.rawValue, forKey: Self.defaultsKey)
        }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let stored = defaults.string(forKey: Self.defaultsKey) ?? ""
        theme = AccentTheme(rawValue: stored) ?? .default
    }
}
