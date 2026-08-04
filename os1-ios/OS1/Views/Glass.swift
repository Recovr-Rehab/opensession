import SwiftUI

// Shared Liquid Glass styling for floating chrome — the composer, status
// chips, banners, the ask card. The app targets iOS 26 / macOS 26, so these
// use the real glass APIs directly.

extension View {
    /// Glass surface for floating chrome. `interactive` opts into the
    /// touch-responsive glass variant (for tappable surfaces).
    func glassSurface<S: Shape>(in shape: S, interactive: Bool = false) -> some View {
        glassEffect(interactive ? .regular.interactive() : .regular, in: shape)
    }

    /// Tinted glass surface (e.g. the ask-question card).
    func glassSurface<S: Shape>(tint: Color, in shape: S) -> some View {
        glassEffect(.regular.tint(tint.opacity(0.35)), in: shape)
    }

    /// Soft progressive fade where transcript content scrolls under the
    /// transparent navigation bar and the floating composer. The default
    /// hard edge blurs content into an opaque-looking band; soft keeps the
    /// chat visible through both edges.
    ///
    /// The bottom edge only fades if the composer is attached as a *bar*
    /// (`safeAreaBar`, not `safeAreaInset`) — that is what tells the scroll
    /// view content travels behind it.
    func softScrollEdges() -> some View {
        scrollEdgeEffectStyle(.soft, for: [.top, .bottom])
    }

    #if os(iOS)
    /// Extra wash under the floating composer, on top of the soft scroll edge
    /// effect. That effect fades a row as it travels behind the bar, but the
    /// rows that end up BELOW and beside the pill stay legible all the way to
    /// the home indicator; this ramps them into the page colour so the chat
    /// visibly ends at the screen edge instead of running off it.
    ///
    /// It hangs off the COMPOSER, not the scroll view: an overlay on the
    /// scroll view is laid out inside its safe area, which `safeAreaBar` has
    /// already inset by the bar's height — so the gradient painted above the
    /// composer instead of below it (measured: rows under the pill byte
    /// identical, rows above it lightened).
    ///
    /// - Parameters:
    ///   - ramp: how far up from the bar's bottom edge the dissolve runs. It
    ///     has to stay inside the bar's own height (a taller value overflows
    ///     upward and dims content well above the composer).
    ///   - tail: solid page colour hung BELOW the bar. `ignoresSafeArea` does
    ///     not extend a `safeAreaBar` background into the home-indicator strip
    ///     — measured: rows there stayed ~50% legible — so the tail is what
    ///     covers it, and the negative padding is what lets it hang out.
    func composerBottomWash(ramp: CGFloat = 56, tail: CGFloat = 72) -> some View {
        background(alignment: .bottom) {
            VStack(spacing: 0) {
                // Clear down to where the ramp begins — roughly the middle of
                // the resting pill, so nothing above the composer is touched.
                Color.clear
                // Weighted stops, not a plain two-colour ramp: opacity climbs
                // faster than linear and reaches the page colour before the
                // bar's bottom edge, so the chat is already gone by the time it
                // meets the tail. A linear ramp only hits solid on its very
                // last row, which left rows readable right down to the strip.
                LinearGradient(
                    stops: [
                        .init(color: OS1VisualStyle.background.opacity(0), location: 0),
                        .init(color: OS1VisualStyle.background.opacity(0.55), location: 0.4),
                        .init(color: OS1VisualStyle.background, location: 0.8),
                        .init(color: OS1VisualStyle.background, location: 1),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: ramp)
                OS1VisualStyle.background
                    .frame(height: tail)
            }
            .padding(.bottom, -tail)
            .allowsHitTesting(false)
        }
    }
    #endif
}
