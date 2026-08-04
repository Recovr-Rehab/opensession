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
    /// iOS drops the bottom edge effect: `chatFadesUnderComposer()` already
    /// dissolves the transcript there, and blurring what is on its way to
    /// fully transparent only muddies the last visible line.
    func softScrollEdges() -> some View {
        #if os(iOS)
        scrollEdgeEffectStyle(.soft, for: .top)
        #else
        scrollEdgeEffectStyle(.soft, for: [.top, .bottom])
        #endif
    }

    #if os(iOS)
    /// Backdrop for the floating composer that dissolves the transcript as it
    /// scrolls underneath: transparent where the newest message comes to rest,
    /// ramping to the page color by the time a row has travelled behind the
    /// input. Mirrors the web viewer's `.viewer-input` gradient backdrop.
    ///
    /// It rides the composer's own layout — the bar IS the fade — so it stays
    /// aligned as the bar grows with a multi-line draft, the run chip or the
    /// queue flap, with no height plumbed back into the transcript's body and
    /// no safe-area arithmetic. The transcript itself stays unmasked, so the
    /// newest message is never dimmed at rest.
    ///
    /// `topInset` is the bar's own top padding, so the ramp finishes level
    /// with the composer card rather than with the bar: a row stays readable
    /// right up to the input's edge and disappears as it goes behind it. End
    /// the ramp higher and the last line dissolves in open space above the
    /// composer, which reads as ghosting rather than as sliding underneath.
    func composerScrim(topInset: CGFloat = 0) -> some View {
        background {
            VStack(spacing: 0) {
                LinearGradient(
                    colors: [
                        OS1VisualStyle.background.opacity(0),
                        OS1VisualStyle.background,
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: OS1VisualStyle.composerScrimRunUp)
                OS1VisualStyle.background
            }
            // Negative padding runs the scrim up past the bar, so the whole
            // dissolve happens above the composer card and everything level
            // with it is already page colour — the web's `--chat-under`
            // overlap. Sizing the ramp itself keeps it independent of how
            // tall the bar grows.
            .padding(.top, -(OS1VisualStyle.composerScrimRunUp - topInset))
            .ignoresSafeArea(edges: .bottom)
            .allowsHitTesting(false)
        }
    }
    #endif
}
