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
/// What sits ON the accent is deliberately NOT part of that table. Every
/// chromatic accent takes white ink; `mono` alone inverts with its fill. The
/// contrast test guards that rule, so replacing either hex remains a one-line
/// change without allowing an illegible glyph to ship.
enum AccentTheme: String, CaseIterable, Identifiable, Sendable {
    case teal
    case sky
    case indigo
    case purple
    case pink
    case coral
    case orange
    case gold
    case green
    case mono

    static let `default` = AccentTheme.teal

    var id: String { rawValue }

    var title: String {
        switch self {
        case .teal: "Teal"
        case .sky: "Sky"
        case .indigo: "Indigo"
        case .purple: "Violet"
        case .pink: "Rose"
        case .coral: "Coral"
        case .orange: "Tangerine"
        case .gold: "Gold"
        case .green: "Clover"
        case .mono: "Mono"
        }
    }

    /// Most appearances use 92% of each hue's maximum sRGB chroma. Orange is
    /// deliberately brighter and more saturated, like a signal colour, while
    /// still carrying the palette's white glyph at 3:1. `mono` preserves the
    /// app's original monochrome accent.
    var fills: (light: UInt32, dark: UInt32) {
        switch self {
        case .teal: (0x20_8A_94, 0x26_9D_A9)
        case .sky: (0x1F_82_BB, 0x25_95_D5)
        case .indigo: (0x63_61_F5, 0x76_7B_F6)
        case .purple: (0xAD_26_E8, 0xBD_4B_F6)
        case .pink: (0xD1_23_8C, 0xEE_29_A1)
        case .coral: (0xDD_24_3B, 0xF7_36_48)
        case .orange: (0xE8_4F_00, 0xFF_5A_00)
        case .gold: (0x98_74_1C, 0xAE_85_21)
        case .green: (0x20_91_48, 0x26_A6_53)
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

    /// The picker presentation: barely lifted at the top-left and shaded at
    /// the bottom-right. Both stops derive from `fills`, so replacing a palette
    /// hex still changes the whole swatch in one place.
    var gradient: LinearGradient {
        let highlight = Color(platformColor: AccentTheme.dynamic(
            light: AccentTheme.platformColor(
                AccentTheme.blend(fills.light, toward: 0xFF_FF_FF, by: 0.03)
            ),
            dark: AccentTheme.platformColor(
                AccentTheme.blend(fills.dark, toward: 0xFF_FF_FF, by: 0.03)
            )
        ))
        let shade = Color(platformColor: AccentTheme.dynamic(
            light: AccentTheme.platformColor(
                AccentTheme.blend(fills.light, toward: 0x00_00_00, by: 0.06)
            ),
            dark: AccentTheme.platformColor(
                AccentTheme.blend(fills.dark, toward: 0x00_00_00, by: 0.06)
            )
        ))
        return LinearGradient(
            colors: [highlight, shade],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    /// What sits on top of the fill — the glyph in the send disc and every
    /// other prominent accent control. Chromatic accents always use white;
    /// monochrome keeps the app's original black/white inversion.
    var onAccent: Color {
        guard self == .mono else { return .white }
        return Color(platformColor: AccentTheme.dynamic(
            light: .white,
            dark: .black
        ))
    }

    /// A flat, appearance-independent swatch — for anywhere the two values have
    /// to be shown side by side rather than resolved.
    func swatch(dark: Bool) -> Color {
        Color(platformColor: AccentTheme.platformColor(dark ? fills.dark : fills.light))
    }

    /// Whether this accent's fixed glyph is white. Together with
    /// `glyphContrast` this lets the test suite reject replacement colours too
    /// pale to carry the palette's white-ink rule.
    func glyphIsWhite(dark: Bool) -> Bool {
        self != .mono || !dark
    }

    /// How much contrast the derived glyph gets on this fill.
    func glyphContrast(dark: Bool) -> Double {
        let fill = AccentTheme.luminance(dark ? fills.dark : fills.light)
        let glyph = glyphIsWhite(dark: dark) ? 1.0 : 0.0
        return (max(fill, glyph) + 0.05) / (min(fill, glyph) + 0.05)
    }

    // ── Colour maths ──────────────────────────────────────────────────────

    private static func platformColor(_ hex: UInt32) -> PlatformColor {
        PlatformColor(
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            alpha: 1
        )
    }

    private static func blend(_ hex: UInt32, toward target: UInt32, by amount: Double) -> UInt32 {
        let mixed = [16, 8, 0].map { shift -> UInt32 in
            let source = Double((hex >> shift) & 0xFF)
            let destination = Double((target >> shift) & 0xFF)
            return UInt32((source + (destination - source) * amount).rounded()) << shift
        }
        return mixed.reduce(0, |)
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
        // Cobalt briefly shipped as `blue`; Sky is its nearest successor in
        // the evenly spaced palette, so preserve the choice across the rename.
        let normalized = stored == "blue" ? AccentTheme.sky.rawValue : stored
        theme = AccentTheme(rawValue: normalized) ?? .default
        if normalized != stored {
            defaults.set(normalized, forKey: Self.defaultsKey)
        }
    }
}
