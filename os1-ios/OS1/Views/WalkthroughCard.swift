import AVKit
import SwiftUI
#if canImport(UIKit)
import UIKit
#else
import AppKit
#endif

/// The agent's demo of a user-visible change, inline in the transcript where
/// it was published: a short screen recording, the writeup, and before/after
/// stills. The web viewer renders the same card in the session — until now the
/// walkthroughs an agent published from the phone were only visible from a
/// browser, which is a strange thing for the app the work was done in.
///
/// It reads as a raised card rather than a message, because it summarizes a
/// stretch of the conversation rather than continuing it.
///
/// It folds, like a work turn does, and arrives folded. A walkthrough is a
/// screenful of video and a screenful per before/after pair, and on a phone
/// that is a long way to drag past to reach what was said after it — in a
/// session that published several, the conversation is mostly walkthrough.
///
/// Folded is not hidden: the card keeps a sideways strip of its stills, and a
/// tap on one opens the same full-screen viewer the open card does. Checking
/// what changed should not require unfolding the whole walkthrough.
struct WalkthroughCard: View {
    let walkthrough: SessionWalkthrough
    let state: TurnFoldState

    /// The card's own inset — and the amount its pictures give back. Text is
    /// read at the card's margin; the media runs to its edges, because on a
    /// phone the walkthrough is already the narrowest thing on the narrowest
    /// screen (the transcript's margin, then the card's, then a letterbox) and
    /// every inset comes off the one screenshot the reader opened it for.
    fileprivate static let padding: CGFloat = 14

    /// How tall one piece of media may get before it stops being part of a
    /// conversation and becomes a page of its own. Shared by the video and the
    /// stills so a before/after pair and the demo of the same screen come out
    /// the same size.
    fileprivate static let mediaHeightCap: CGFloat = 640

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif
    /// The card's outer width, which the folded tiles divide between them.
    /// Measured rather than assumed: a tile that is a fraction of the card is
    /// the only size that never cuts the next one off.
    @State private var cardWidth: CGFloat = 0
    @State private var playingDemo = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation(.snappy(duration: 0.22, extraBounce: 0)) {
                    state.toggle()
                }
            } label: {
                header
            }
            .buttonStyle(.plain)
            .accessibilityLabel(accessibilityLabel)
            .accessibilityHint(state.expanded ? "Hide the walkthrough" : "Show the demo and writeup")

            if state.expanded {
                if let video = walkthrough.video, let url = OS1API.mediaURL(path: video) {
                    WalkthroughVideo(url: url)
                        .padding(.horizontal, -Self.padding)
                }
                if !walkthrough.summary.isEmpty {
                    MarkdownBody(walkthrough.summary)
                }
                ForEach(walkthrough.stills) { shot in
                    WalkthroughShotView(shot: shot, gallery: gallery)
                }
            } else if hasFoldedMedia {
                WalkthroughThumbnailStrip(
                    video: walkthrough.video,
                    stills: walkthrough.stills,
                    gallery: gallery,
                    contentWidth: max(120, cardWidth - Self.padding * 2),
                    compact: isCompact,
                    onPlayDemo: { playingDemo = true }
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(Self.padding)
        .background(OS1VisualStyle.panel, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(OS1VisualStyle.border, lineWidth: 0.5)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { cardWidth = $0 }
        // Opening the card also widens it. Folded it is a line in the
        // conversation and is read at the conversation's margin; open it is
        // the thing you are looking at, and a pair of screenshots wants every
        // point it can get. Taking the margin back is the whole of the room
        // the transcript has, and it is there at every width — which is what
        // makes it safe to reach into.
        .padding(.horizontal, state.expanded ? -Self.transcriptMargin(compact: isCompact) : 0)
        // Media needs more room after it than ordinary transcript text. A
        // writeup-only walkthrough still folds to the normal one-line rhythm.
        .padding(.bottom, state.expanded || hasFoldedMedia ? 6 : 0)
        #if os(iOS)
        .fullScreenCover(isPresented: $playingDemo) { demoScreen }
        #else
        .sheet(isPresented: $playingDemo) {
            demoScreen.frame(minWidth: 640, minHeight: 420)
        }
        #endif
    }

    private var isCompact: Bool {
        #if os(iOS)
        sizeClass == .compact
        #else
        false
        #endif
    }

    /// The margin the transcript is read at — `SessionView.contentInset`,
    /// which is the room an opened card reaches into.
    private static func transcriptMargin(compact: Bool) -> CGFloat {
        compact ? 16 : 20
    }

    /// Folded, the card keeps a strip of what it holds: the demo and the
    /// stills, which is the part a reader usually wants.
    private var hasFoldedMedia: Bool {
        walkthrough.video != nil || !gallery.isEmpty
    }

    @ViewBuilder private var demoScreen: some View {
        if let video = walkthrough.video, let url = OS1API.mediaURL(path: video) {
            WalkthroughDemoScreen(url: url)
        }
    }

    /// Every still in the card, in reading order, so opening one pages
    /// before → after → the next pair. Comparing the two is the whole point of
    /// a walkthrough, and a viewer that shows one picture makes you close it to
    /// see the other.
    private var gallery: [PreviewImage] {
        walkthrough.stills.flatMap { shot in
            [
                (PreviewImage.WalkthroughLabel.before, shot.before),
                (.after, shot.after),
            ].compactMap { side, path in
                guard let path else { return nil }
                return PreviewImage(
                    id: path,
                    source: .media(path: path),
                    label: shot.caption?.isEmpty == false ? shot.caption : nil,
                    walkthroughLabel: side
                )
            }
        }
    }

    private var header: some View {
        HStack(spacing: 6) {
            Image(systemName: "chevron.down")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(OS1VisualStyle.textFaint)
                .rotationEffect(.degrees(state.expanded ? 0 : -90))
            Image(systemName: "play.rectangle")
                .font(.system(size: 11, weight: .semibold))
            Text("Walkthrough")
                .font(.caption.weight(.semibold))
                .lineLimit(1)
            Spacer(minLength: 4)
            // Folded, what the card holds — the one thing a reader needs to
            // decide whether to open it. Open, they can see that for
            // themselves, so the slot goes back to saying when it was
            // published (the same trade the work fold's header makes).
            Text(state.expanded ? publishedLabel : contentsLabel)
                .font(.caption2)
                .foregroundStyle(OS1VisualStyle.textFaint)
                .lineLimit(1)
                .fixedSize()
        }
        .foregroundStyle(OS1VisualStyle.textDim)
        .padding(.vertical, 1)
        .contentShape(Rectangle())
    }

    /// "Demo · 2 stills" — omitted pieces collapse rather than leaving a
    /// stray separator, and a writeup-only walkthrough says so instead of
    /// looking empty.
    private var contentsLabel: String {
        var parts: [String] = []
        if walkthrough.video != nil { parts.append("Demo") }
        let stills = walkthrough.stills.reduce(0) { count, shot in
            count + [shot.before, shot.after].compactMap { $0 }.count
        }
        if stills > 0 { parts.append("\(stills) still\(stills == 1 ? "" : "s")") }
        if parts.isEmpty, !walkthrough.summary.isEmpty { parts.append("Writeup") }
        return parts.joined(separator: " · ")
    }

    private var publishedLabel: String {
        guard let published = walkthrough.publishedDate else { return "" }
        return published.formatted(.dateTime.month(.abbreviated).day().hour().minute())
    }

    private var accessibilityLabel: String {
        var parts = ["Walkthrough"]
        let contents = contentsLabel
        if !contents.isEmpty { parts.append(contents.replacingOccurrences(of: " · ", with: ", ")) }
        return parts.joined(separator: ", ")
    }
}

/// What a piece of walkthrough media is, worn as a pill in the corner of its
/// tile. Demo is the video's, so the folded strip is captioned one way rather
/// than two — the web card labels the same three the same way (see
/// `lib/walkthrough-label.ts`).
enum WalkthroughMediaLabel: String {
    case before = "Before"
    case after = "After"
    case demo = "Demo"

    var color: Color {
        switch self {
        case .before: OS1VisualStyle.red
        case .after: OS1VisualStyle.green
        case .demo: OS1VisualStyle.blue
        }
    }
}

/// The shape of a folded tile: what it crops, and what it shows whole.
///
/// Cropping to 16/10 is honest for a landscape screenshot and useless for a
/// phone one — cropped that way it is a status bar and a header, and at the
/// size one or two tiles get, that sliver is blown up to the width of the
/// card. So a tile crops only while it still shows three quarters of the
/// picture; outside that the media keeps its own ratio. The same rule as the
/// web card's `tileBox`, kept here as plain arithmetic so it can be tested.
enum WalkthroughTile {
    /// The tile's own shape.
    static let ratio: CGFloat = 16 / 10

    /// The room one tile has, and what a picture too tall for it is sized by.
    struct Metrics: Equatable {
        var width: CGFloat
        var tallHeight: CGFloat
    }

    /// Whether a picture of this shape still shows three quarters of itself
    /// inside the tile — true from 1.2 (a portrait shot) to 2.13 (a wide strip
    /// of UI).
    static func crops(_ ratio: CGFloat) -> Bool {
        guard ratio > 0 else { return true }
        let shown = ratio < Self.ratio ? ratio / Self.ratio : Self.ratio / ratio
        return shown >= 0.75
    }

    /// The box a tile draws in. A picture the tile suits fills it and is
    /// cropped; a wide one keeps the width it was given and is simply shorter;
    /// a tall one is sized off a height, which is what keeps it at the scale
    /// of its neighbours instead of running the card, and never grows wider
    /// than the room it has.
    ///
    /// The box is always the picture's exact ratio when it is shown whole,
    /// which is what makes `scaledToFill` behave as fit — the renderer crops
    /// to whatever box it lands in, so the box is the crop.
    static func size(ratio: CGFloat?, in metrics: Metrics) -> CGSize {
        guard let ratio, ratio > 0, !crops(ratio) else {
            return CGSize(width: metrics.width, height: metrics.width / Self.ratio)
        }
        if ratio > Self.ratio {
            return CGSize(width: metrics.width, height: metrics.width / ratio)
        }
        let height = min(metrics.tallHeight, metrics.width / ratio)
        return CGSize(width: height * ratio, height: height)
    }
}

/// The folded card's media in reading order: the demo, then every still. A tap
/// on a still opens the full-screen gallery at that image, so Before and After
/// can be compared without opening the walkthrough first; a tap on the demo
/// plays it.
private struct WalkthroughThumbnailStrip: View {
    let video: String?
    let stills: [WalkthroughShot]
    let gallery: [PreviewImage]
    /// The card's width inside its padding: what the tiles divide when there
    /// are few enough of them to share it.
    let contentWidth: CGFloat
    let compact: Bool
    let onPlayDemo: () -> Void

    /// Tight within a pair, looser between changes: the relationship reads
    /// from the spacing without either side changing scale.
    private static let pairGap: CGFloat = 4
    private static let groupGap: CGFloat = 14

    private var count: Int { (video == nil ? 0 : 1) + gallery.count }

    /// How big a folded tile gets, set by how many there are. A thumbnail of a
    /// UI is a picture of small things, so a tile only answers "what changed"
    /// once it is big enough to read — and a card with one or two pieces of
    /// media has the whole card to give them. There it stops being a strip at
    /// all: the tiles divide the card's width, which is both the largest they
    /// can be and the only size that never cuts the second one off. Past that
    /// the card has more than it can show at once, so the tiles go back to a
    /// scrolling strip at a fixed size, stepping down as the count goes up.
    /// The phone keeps the small tile throughout — the card is narrow enough
    /// there that a wide one shows a picture and a half.
    private var fill: Bool { count <= 2 }

    private var tileWidth: CGFloat {
        guard !fill else {
            return max(80, (contentWidth - gapTotal) / CGFloat(max(1, count)))
        }
        if compact { return 168 }
        return count <= 4 ? 256 : 224
    }

    /// What a picture too tall to crop is sized by. In the strip that is the
    /// height its cropped neighbours already stand at, so a phone screenshot
    /// keeps their scale instead of running the card; sharing the card, it is
    /// the room the card has, because a tall picture shown small is the one
    /// thing the folded card cannot answer "what changed" with.
    private var tallHeight: CGFloat {
        fill ? (compact ? 320 : 384) : tileWidth / WalkthroughTile.ratio
    }

    /// Every gap the row spends, so the tiles divide what is left of the card.
    private var gapTotal: CGFloat {
        var total: CGFloat = 0
        var groups = video == nil ? 0 : 1
        for shot in stills {
            groups += 1
            if shot.before != nil && shot.after != nil { total += Self.pairGap }
        }
        return total + CGFloat(max(0, groups - 1)) * Self.groupGap
    }

    private var metrics: WalkthroughTile.Metrics {
        WalkthroughTile.Metrics(width: tileWidth, tallHeight: tallHeight)
    }

    /// The sides a shot actually has, labelled — an "after only" shot is how a
    /// brand-new surface gets illustrated.
    private static func sides(
        of shot: WalkthroughShot
    ) -> [(label: WalkthroughMediaLabel, path: String)] {
        var sides: [(label: WalkthroughMediaLabel, path: String)] = []
        if let before = shot.before { sides.append((.before, before)) }
        if let after = shot.after { sides.append((.after, after)) }
        return sides
    }

    var body: some View {
        if fill {
            row
        } else {
            ScrollView(.horizontal, showsIndicators: false) {
                row
            }
            // A clipped next tile communicates that the strip continues.
            .padding(.horizontal, -WalkthroughCard.padding)
            .contentMargins(.horizontal, WalkthroughCard.padding, for: .scrollContent)
        }
    }

    private var row: some View {
        HStack(alignment: .top, spacing: Self.groupGap) {
            if let video, let url = OS1API.mediaURL(path: video) {
                WalkthroughVideoTile(url: url, tile: metrics, onPlay: onPlayDemo)
            }
            ForEach(stills) { shot in
                HStack(spacing: Self.pairGap) {
                    ForEach(Array(Self.sides(of: shot).enumerated()), id: \.offset) { _, item in
                        MediaImage(
                            path: item.path,
                            gallery: gallery,
                            galleryIndex: gallery.firstIndex { $0.id == item.path } ?? 0,
                            label: item.label,
                            tile: metrics
                        )
                    }
                }
            }
            if fill { Spacer(minLength: 0) }
        }
        .padding(.vertical, 1)
    }
}

/// The demo in the folded strip: a frame of the recording, wearing the same
/// pill in the same corner every still does, and sized by the same rules — a
/// phone recording is shown whole rather than cropped to a landscape tile.
///
/// A tap plays it, rather than opening the card and asking for a second one.
private struct WalkthroughVideoTile: View {
    let url: URL
    let tile: WalkthroughTile.Metrics
    let onPlay: () -> Void

    /// The frame the tile shows, and the recording's shape. Both come from the
    /// same generated image, which is turned by the track's transform — a
    /// phone recording is stored landscape with a rotation on it.
    @State private var poster: CGImage?
    @State private var ratio: CGFloat?

    var body: some View {
        let box = WalkthroughTile.size(ratio: ratio, in: tile)
        Button(action: onPlay) {
            ZStack {
                Color.black
                if let poster {
                    Image(decorative: poster, scale: 1)
                        .resizable()
                        .scaledToFill()
                }
                // The badge reads as "this one plays" on a still frame that may
                // itself be a screenshot of the app — and never grows past the
                // tile, which a wide recording can leave very short.
                let badge = min(32, max(14, box.height * 0.45))
                Image(systemName: "play.fill")
                    .font(.system(size: badge * 0.42, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: badge, height: badge)
                    .background(.black.opacity(0.45), in: Circle())
            }
            .frame(width: box.width, height: box.height)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(OS1VisualStyle.border, lineWidth: 0.5)
            }
            .overlay(alignment: .topLeading) {
                WalkthroughLabelPill(label: .demo, fits: box.height)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Play the demo")
        .task(id: url) {
            guard poster == nil else { return }
            let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
            generator.appliesPreferredTrackTransform = true
            generator.maximumSize = CGSize(width: 1200, height: 1200)
            guard let image = try? await generator.image(
                at: CMTime(seconds: 0.1, preferredTimescale: 600)
            ).image else {
                ratio = await WalkthroughVideo.displayRatio(of: url)
                return
            }
            ratio = image.height > 0 ? CGFloat(image.width) / CGFloat(image.height) : nil
            poster = image
        }
    }
}

/// The demo, full screen, playing. The tap that opened it was the play button,
/// so it starts rather than waiting for a second one.
private struct WalkthroughDemoScreen: View {
    let url: URL

    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            VideoPlayer(player: player)
                .ignoresSafeArea()
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(.black.opacity(0.55), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Close the demo")
            .padding(16)
        }
        .onAppear {
            guard player == nil else { return }
            let player = AVPlayer(url: url)
            self.player = player
            player.play()
        }
        .onDisappear { player?.pause() }
    }
}

/// What the media under it is: the app's own status pill, resting in the
/// tile's top left, in the tone of what it labels.
///
/// A folded tile shown whole can be shorter than the pill — a 9:1 recording of
/// one band of UI comes out a sliver — and a pill hanging out of the picture it
/// labels is a sticker rather than a caption, so below that it is left off.
/// Nothing is lost: the header still says what the card holds, and the full
/// screen the tile opens carries the label again.
private struct WalkthroughLabelPill: View {
    let label: WalkthroughMediaLabel
    /// The tile's height, when it is one of the folded card's.
    var fits: CGFloat?

    private var visible: Bool { (fits ?? .infinity) >= 34 }

    var body: some View {
        if visible { pill }
    }

    private var pill: some View {
        Text(label.rawValue)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(label.color)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(label.color.opacity(0.14), in: Capsule())
            .shadow(color: .black.opacity(0.12), radius: 1, y: 1)
            .padding(8)
            .allowsHitTesting(false)
    }
}

/// The demo recording. `VideoPlayer` streams it over the same range-enabled
/// media route the web `<video>` uses, so it seeks without downloading first.
///
/// Sized to the recording's own shape, not to a fixed box. A player is a black
/// rectangle that letterboxes whatever it is given: at the 200pt height this
/// started at, a landscape demo lost the card's width to bars down both sides
/// and a PORTRAIT one — a phone recording, which is most of what the app's own
/// walkthroughs show — played as a sliver about a fifth the size of the room
/// the card had for it.
private struct WalkthroughVideo: View {
    let url: URL

    @State private var player: AVPlayer?
    /// The recording's display ratio, once the asset says what it is. 16:9
    /// until then, so the row doesn't resize under a reader who is already
    /// watching — landscape is the common case and the cheap guess.
    @State private var ratio: CGFloat?

    var body: some View {
        VideoPlayer(player: player)
            .aspectRatio(ratio ?? 16 / 9, contentMode: .fit)
            // A tall recording would otherwise fill the screen and bury the
            // writeup under it; the same ceiling the stills use.
            .frame(maxWidth: .infinity, maxHeight: WalkthroughCard.mediaHeightCap)
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            .task {
                guard ratio == nil else { return }
                ratio = await Self.displayRatio(of: url)
            }
            .onAppear {
                guard player == nil else { return }
                player = AVPlayer(url: url)
            }
            // Deliberately not autoplaying: a transcript that starts talking
            // at you while you scroll past is worse than a tap.
            .onDisappear { player?.pause() }
    }

    /// Width over height as the recording is MEANT to be shown — the natural
    /// size turned by the track's transform, since a phone recording is stored
    /// landscape with a rotation on it and its raw size claims the opposite
    /// shape of what plays.
    fileprivate static func displayRatio(of url: URL) async -> CGFloat? {
        let asset = AVURLAsset(url: url)
        guard let track = try? await asset.loadTracks(withMediaType: .video).first,
              let size = try? await track.load(.naturalSize),
              let transform = try? await track.load(.preferredTransform)
        else { return nil }
        let shown = size.applying(transform)
        let width = abs(shown.width), height = abs(shown.height)
        guard width > 0, height > 0 else { return nil }
        return width / height
    }
}

/// One before/after pair, stacked rather than side by side — at phone width
/// two half-width screenshots are too small to show what changed.
private struct WalkthroughShotView: View {
    let shot: WalkthroughShot
    /// All the card's stills; each still finds itself in it by path.
    let gallery: [PreviewImage]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let caption = shot.caption, !caption.isEmpty {
                Text(caption)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(OS1VisualStyle.textDim)
            }
            if let before = shot.before {
                labelled(.before, path: before)
            }
            if let after = shot.after {
                labelled(.after, path: after)
            }
        }
    }

    private func labelled(_ label: WalkthroughMediaLabel, path: String) -> some View {
        MediaImage(
            path: path,
            gallery: gallery,
            galleryIndex: gallery.firstIndex { $0.id == path } ?? 0,
            label: label
        )
        .padding(.horizontal, -WalkthroughCard.padding)
    }
}

/// A staged still, fetched with the session's credentials and tappable into
/// the same full-screen viewer transcript images use.
private struct MediaImage: View {
    let path: String
    var gallery: [PreviewImage] = []
    var galleryIndex: Int = 0
    var label: WalkthroughMediaLabel? = nil
    /// Set to render as one of the folded card's tiles, which takes its shape
    /// from the room it has and the picture's own (see `WalkthroughTile`).
    /// Unset, the still is shown whole at the card's width.
    var tile: WalkthroughTile.Metrics?

    @State private var data: Data?
    /// The still's own aspect ratio. `DataImage` renders `scaledToFill`, which
    /// crops a wide screenshot to whatever box it lands in — sizing the box to
    /// the image's ratio is what makes fill behave as fit, so a walkthrough
    /// shot is shown whole rather than with its right edge cut off.
    @State private var ratio: CGFloat?
    @State private var failed = false
    @State private var retryCount = 0

    var body: some View {
        Group {
            if let data {
                let image = ExpandableDataImage(
                    data: data, gallery: gallery, galleryIndex: galleryIndex
                )
                if let tile {
                    let box = WalkthroughTile.size(ratio: ratio, in: tile)
                    image
                        .frame(width: box.width, height: box.height)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        // Most of what these show is a screenshot of a light
                        // UI on a light card, which without an edge dissolves
                        // into the card instead of reading as a picture.
                        .overlay {
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(OS1VisualStyle.border, lineWidth: 0.5)
                        }
                } else {
                    image
                        .aspectRatio(ratio ?? 16 / 9, contentMode: .fit)
                        // A tall screenshot would otherwise take the whole
                        // screen and bury the rest of the walkthrough under
                        // it. The cap is what a PHONE shot runs into — at the
                        // card's width one wants ~780pt of height — and it is
                        // a ceiling on HEIGHT, so it costs a portrait shot
                        // width too: every point taken off the cap narrows the
                        // picture by about half a point. 640 keeps the card's
                        // bottom edge and the start of the next block in view
                        // on the shortest phone this app runs on.
                        .frame(maxWidth: .infinity, maxHeight: WalkthroughCard.mediaHeightCap)
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            } else {
                Button { retryCount += 1 } label: {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(.fill.tertiary)
                        .frame(
                            width: tile?.width,
                            height: tile.map { $0.width / WalkthroughTile.ratio } ?? 120
                        )
                        .overlay {
                            if failed {
                                Image(systemName: "arrow.clockwise")
                                    .foregroundStyle(.tertiary)
                            } else {
                                ProgressView().controlSize(.small)
                            }
                        }
                }
                .buttonStyle(.plain)
                .disabled(!failed)
            }
        }
        .overlay(alignment: .topLeading) {
            if let label {
                WalkthroughLabelPill(label: label, fits: tileHeight)
            }
        }
        .task(id: "\(path)#\(retryCount)") {
            guard data == nil else { return }
            failed = false
            do {
                let loaded = try await OS1API.media(path: path)
                ratio = Self.aspectRatio(of: loaded)
                data = loaded
            } catch {
                failed = true
            }
        }
    }

    /// How tall this still is drawn, when it is one of the folded tiles —
    /// which is what decides whether its label fits inside it.
    private var tileHeight: CGFloat? {
        tile.map { WalkthroughTile.size(ratio: ratio, in: $0).height }
    }

    private static func aspectRatio(of data: Data) -> CGFloat? {
        #if canImport(UIKit)
        let size = UIImage(data: data)?.size
        #else
        let size = NSImage(data: data)?.size
        #endif
        guard let size, size.width > 0, size.height > 0 else { return nil }
        return size.width / size.height
    }
}
