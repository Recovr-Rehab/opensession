#if os(iOS)
import SwiftUI

/// The session's own actions, as one floating glass capsule directly above
/// the composer: archive, the ⋯ menu, a new session, the next chat. The web
/// client's phone layout puts them in the same place, and for the same
/// reason. On a phone the navigation bar is the far corner of the screen,
/// while this sits under the thumb that is already on the composer.
///
/// It hides while you write. The keyboard leaves a single row of screen
/// between the field and the transcript, and a row of buttons is not what
/// that space is for. Rather than cutting out, the capsule contracts into a
/// short glass line: the bar stays on screen as an object, so dismissing the
/// keyboard reads as the same thing coming back rather than as new chrome
/// arriving.
///
/// The glass is a background SIBLING of the row, not an ancestor of it. A
/// `Menu` whose label sits INSIDE a glass subtree makes the system treat that
/// glass as the menu's morph source, which takes the whole bar off screen for
/// as long as the menu is open. The composer learned this the hard way. See
/// `SessionInputBar.composer`.
struct SessionActionBar: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// Contracted to a line. Driven by composer focus.
    let collapsed: Bool
    /// Archive this workspace. Absent where there is nothing to archive.
    var onArchive: (() -> Void)?
    var onNewSession: (() -> Void)?
    var onNextChat: (() -> Void)?
    /// The ⋯ menu, built by the session view that owns its state.
    var menu: AnyView?

    /// Matches the composer's round controls, so the two read as one system.
    private static let control: CGFloat = 44
    /// Thin enough to be a line rather than a squashed bar, thick enough to
    /// keep the glass's own highlight.
    private static let lineHeight: CGFloat = 5
    private static let lineWidth: CGFloat = 52

    var body: some View {
        HStack(spacing: 2) {
            if let onArchive {
                iconButton("archivebox", label: "Archive", action: onArchive)
            }
            if let menu {
                menu
                    .font(.system(size: 19))
                    .frame(width: Self.control, height: Self.control)
            }
            if (onArchive != nil || menu != nil) && (onNewSession != nil || onNextChat != nil) {
                Rectangle()
                    .fill(OS1VisualStyle.border)
                    .frame(width: 1, height: 20)
                    .padding(.horizontal, 2)
                    .accessibilityHidden(true)
            }
            if let onNewSession {
                iconButton("plus", label: "New session", action: onNewSession)
            }
            if let onNextChat {
                iconButton("arrow.right", label: "Next chat", action: onNextChat)
            }
        }
        .padding(.horizontal, 2)
        // Intrinsic size, then clipped by the frame below: the row keeps its
        // real layout through the whole contraction, so nothing reflows on
        // the way in or out.
        .fixedSize()
        .opacity(collapsed ? 0 : 1)
        .blur(radius: collapsed ? 6 : 0)
        .frame(
            width: collapsed ? Self.lineWidth : expandedWidth,
            height: collapsed ? Self.lineHeight : Self.control
        )
        .clipShape(Capsule())
        .background { Color.clear.glassSurface(in: Capsule()) }
        .frame(maxWidth: .infinity)
        .allowsHitTesting(!collapsed)
        .accessibilityHidden(collapsed)
        // A touch of bounce on the way back out: the bar returns as the
        // keyboard leaves, and the keyboard's own curve settles rather than
        // stopping dead. Reduce Motion keeps the same states without moving
        // the capsule between them.
        .animation(
            reduceMotion ? nil : .smooth(duration: 0.3, extraBounce: 0.12),
            value: collapsed
        )
    }

    /// Keep both endpoints concrete so SwiftUI can interpolate the capsule's
    /// width rather than swapping an intrinsic width for a fixed one.
    private var expandedWidth: CGFloat {
        let buttonCount = [
            onArchive != nil,
            menu != nil,
            onNewSession != nil,
            onNextChat != nil,
        ].count(where: { $0 })
        let hasDivider = (onArchive != nil || menu != nil)
            && (onNewSession != nil || onNextChat != nil)
        let childCount = buttonCount + (hasDivider ? 1 : 0)
        let controlsWidth = CGFloat(buttonCount) * Self.control
        let dividerWidth: CGFloat = hasDivider ? 5 : 0
        let spacing = CGFloat(max(0, childCount - 1)) * 2
        return controlsWidth + dividerWidth + spacing + 4
    }

    private func iconButton(
        _ symbol: String,
        label: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                // Weight from the font, never `.resizable()`, so this sits at
                // the same stroke as the composer's controls.
                .font(.system(size: 19))
                .foregroundStyle(OS1VisualStyle.textDim)
                .frame(width: Self.control, height: Self.control)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}
#endif
