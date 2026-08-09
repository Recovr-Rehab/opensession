import SwiftUI

/// Who else has this session open right now, as a Figma/Notion-style stack of
/// faces — the native half of the web viewer's header facepile, fed by the
/// server's `presence` frames.
///
/// Only OTHER people appear. The web pile includes you (rightmost) because a
/// desktop header has room to spare; a phone navigation bar does not, and your
/// own face there tells you nothing you didn't know.
struct PresenceFacepile: View {
    let viewers: [String]
    var size: CGFloat = 26
    /// Overlapped pile (a toolbar, on known chrome) vs faces side by side.
    ///
    /// A stack needs an opaque ring in the colour of whatever is behind it,
    /// and a sidebar row's backdrop moves under it — plate, swipe, selection —
    /// so any fixed ring would read as a hard frame on most of them. Same call
    /// the web sidebar makes.
    var stacked: Bool = true

    /// Beyond three the pile stops being readable in a navigation bar and the
    /// rest collapse into a count.
    private let maxFaces = 3

    var body: some View {
        if viewers.isEmpty {
            EmptyView()
        } else {
            HStack(spacing: stacked ? -size / 3 : 2) {
                ForEach(shown, id: \.self) { viewer in
                    UserAvatar(person: viewer, size: size)
                        // The ring is what makes overlapping faces read as a
                        // stack rather than one smeared shape; it takes the
                        // bar's own colour so the pile sits on the chrome.
                        .overlay {
                            if stacked {
                                Circle().strokeBorder(
                                    OS1VisualStyle.background, lineWidth: 1.5
                                )
                            }
                        }
                }
                if overflow > 0 {
                    Text(verbatim: "+\(overflow)")
                        .font(.system(size: size * 0.38, weight: .semibold, design: .rounded))
                        .foregroundStyle(OS1VisualStyle.textDim)
                        .frame(width: size, height: size)
                        .background(Circle().fill(OS1VisualStyle.hover))
                        .overlay {
                            if stacked {
                                Circle().strokeBorder(
                                    OS1VisualStyle.background, lineWidth: 1.5
                                )
                            }
                        }
                }
            }
            // One label for the pile: VoiceOver reading three unlabelled
            // images as separate elements is noise, and the useful sentence is
            // who is here.
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text(label))
            #if os(macOS)
            .help(label)
            #endif
            .task(id: viewers) {
                await TeamDirectory.shared.ensureLoaded()
            }
        }
    }

    private var shown: [String] {
        Array(viewers.prefix(maxFaces))
    }

    private var overflow: Int {
        max(0, viewers.count - maxFaces)
    }

    private var label: String {
        let names = viewers.map { TeamDirectory.shared.fullName(for: $0) }
        return "Also viewing: " + ListFormatter.localizedString(byJoining: names)
    }
}
