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
    func composerScrim() -> some View {
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
            // dissolve happens in the run-up and everything level with the
            // composer is already page colour — the web's `--chat-under`
            // overlap. Sizing the ramp itself keeps it independent of how
            // tall the bar grows.
            .padding(.top, -OS1VisualStyle.composerScrimRunUp)
            .ignoresSafeArea(edges: .bottom)
            .allowsHitTesting(false)
        }
    }
    #endif
}
