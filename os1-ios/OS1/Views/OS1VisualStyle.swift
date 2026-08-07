import SwiftUI
import ImageIO
import Observation
#if os(macOS)
import AppKit
#else
import UIKit
#endif

enum OS1VisualStyle {
    // Use native semantic surfaces so the app follows its Settings appearance.
    #if os(iOS)
    static let background = Color(uiColor: .systemBackground)
    static let raised = Color(uiColor: .secondarySystemBackground)
    static let panel = Color(uiColor: .tertiarySystemBackground)
    static let hover = Color(uiColor: .quaternarySystemFill)
    static let border = Color(uiColor: .separator)
    static let text = Color(uiColor: .label)
    static let textDim = Color(uiColor: .secondaryLabel)
    static let textFaint = Color(uiColor: .tertiaryLabel)
    static let userMessage = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(white: 0.192, alpha: 1)
            : UIColor(white: 0.949, alpha: 1)
    })
    #else
    static let background = Color(nsColor: .windowBackgroundColor)
    static let raised = Color(nsColor: .underPageBackgroundColor)
    static let panel = Color(nsColor: .controlBackgroundColor)
    static let hover = Color(nsColor: .unemphasizedSelectedContentBackgroundColor)
    static let border = Color(nsColor: .separatorColor)
    static let text = Color(nsColor: .labelColor)
    static let textDim = Color(nsColor: .secondaryLabelColor)
    static let textFaint = Color(nsColor: .tertiaryLabelColor)
    /// Same neutral gray as the iOS user bubble, resolved per appearance,
    /// so the two apps read as one product.
    static let userMessage = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(white: 0.192, alpha: 1)
            : NSColor(white: 0.949, alpha: 1)
    })
    #endif
    /// The brand mark: black on light, white on dark. It is a FILL colour —
    /// the send disc, the app tint, an active icon — and deliberately not a
    /// text colour: at label contrast, words wearing it are indistinguishable
    /// from body copy, so inline affordances (links, fold toggles) take
    /// `link` instead.
    #if os(iOS)
    static let accent = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark ? .white : .black
    })
    /// What sits on top of an `accent` fill — its inverse, so the glyph in the
    /// send disc stays legible in either appearance.
    static let onAccent = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark ? .black : .white
    })
    /// Links and other tappable words in running text.
    static let link = Color(uiColor: .link)
    /// The settings row icons. Neutral by design: the chrome is monochrome, and
    /// a hue on every row read as decoration rather than as meaning. Sitting a
    /// step darker on light / lighter on dark than `textDim` keeps the glyph
    /// column present without competing with the row title, which owns full
    /// label contrast.
    static let iconTint = Color(uiColor: UIColor { traits in
        traits.userInterfaceStyle == .dark
            ? UIColor(white: 0.68, alpha: 1)
            : UIColor(white: 0.35, alpha: 1)
    })
    #else
    static let accent = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? .white : .black
    })
    static let onAccent = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? .black : .white
    })
    static let link = Color(nsColor: .linkColor)
    static let iconTint = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(white: 0.68, alpha: 1)
            : NSColor(white: 0.35, alpha: 1)
    })
    #endif
    // One status palette on both platforms — the Mac previously used stock
    // Color.green/.yellow/… which rendered different hues than iOS.
    static let green = Color(red: 0.247, green: 0.725, blue: 0.314)
    static let yellow = Color(red: 0.824, green: 0.600, blue: 0.133)
    static let blue = Color(red: 0.345, green: 0.651, blue: 1.0)
    static let red = Color(red: 0.973, green: 0.318, blue: 0.286)
    static let purple = Color(red: 0.639, green: 0.443, blue: 0.969)
    #if os(iOS)
    static let sessionMaxWidth: CGFloat = 780
    #else
    /// Keep 13pt desktop body copy near the comfortable 65-75 character range.
    static let sessionMaxWidth: CGFloat = 720
    #endif
}

/// The color a repo's letter tile wears.
///
/// The server assigns one per registered repo across the whole set, so no two
/// of them match — the tile can then stand in for a repo where there's no room
/// to name it, which is what the Inbox rows rely on. Those assignments arrive
/// with the repo list (`OS1API.repos()`); the palette and hash here are the
/// fallback for an id the server never listed, mirrored from
/// src/server/repo-tile-colors.ts. Keep the three copies (there, the web tile,
/// here) in step or one surface paints a repo a color the others don't.
@MainActor
@Observable
final class RepoTilePalette {
    static let shared = RepoTilePalette()

    static let colors: [UInt32] = [
        0xad6b_6d,  // brick
        0x2479_67,  // sage
        0x9f6d_96,  // rose
        0x5873_3d,  // moss
        0x7d78_b0,  // plum
        0x7f65_28,  // ochre
        0x5186_af,  // denim
        0x9257_42,  // rust
        0x3490_92,  // teal
        0x8f53_6b,  // clay
        0x568f_68,  // fern
        0x785b_8d,  // mauve
        0x8584_45,  // olive
        0x5167_9a,  // indigo
        0xa475_48,  // umber
        0x1f74_8b,  // slate
    ]

    private var assigned: [String: Color] = [:]
    /// When each repo's icon last changed. Icons are cacheable and URLCache
    /// outlives a launch, so replacing one from Settings would otherwise keep
    /// painting the old picture until the stored copy went stale.
    private(set) var iconRevisions: [String: Int] = [:]

    /// Record what the server assigned. Repos it didn't color (an older
    /// server) keep the hashed fallback rather than losing their tile.
    func remember(_ repos: [OS1API.RepoInfo]) {
        for repo in repos {
            if let hex = repo.color, let color = Self.parse(hex) {
                assigned[repo.id] = color
            }
            if let rev = repo.iconRev {
                iconRevisions[repo.id] = Int(rev)
            } else {
                iconRevisions.removeValue(forKey: repo.id)
            }
        }
    }

    func color(for name: String) -> Color {
        assigned[name] ?? Color(rgb: Self.colors[Self.hashIndex(name)])
    }

    /// FNV-1a over the lowercased id, walked as UTF-16 so it matches the
    /// JavaScript original code unit for code unit.
    private static func hashIndex(_ name: String) -> Int {
        var hash: UInt32 = 0x811c_9dc5
        for unit in name.lowercased().utf16 {
            hash ^= UInt32(unit)
            hash = hash &* 0x0100_0193
        }
        return Int(hash % UInt32(colors.count))
    }

    private static func parse(_ hex: String) -> Color? {
        var text = hex
        if text.hasPrefix("#") { text.removeFirst() }
        guard text.count == 6, let rgb = UInt32(text, radix: 16) else { return nil }
        return Color(rgb: rgb)
    }
}

extension Color {
    /// A palette entry as a Color. Not private: the repo-tile editor paints
    /// the same swatches this tile does.
    init(rgb: UInt32) {
        self.init(
            .sRGB,
            red: Double((rgb >> 16) & 0xff) / 255,
            green: Double((rgb >> 8) & 0xff) / 255,
            blue: Double(rgb & 0xff) / 255,
            opacity: 1
        )
    }
}

/// Compact repository identity used in repo headers and the conversation title.
/// Its stable single-letter swatch mirrors the web fallback tile.
struct RepoTile: View {
    let name: String
    var size: CGFloat = 18
    var round = false

    static func label(for name: String) -> String {
        name == "backstage" ? "opensession" : name  // legacy repo id on older instances
    }

    private var letter: String {
        if name == "backstage" { return "O" }
        return String(name.prefix(1)).uppercased()
    }

    private var color: Color { RepoTilePalette.shared.color(for: name) }

    @MainActor
    private var iconURL: URL? { Self.iconURL(for: name) }

    /// Bumped when the icons behind /repo-icon are redrawn — keep it in step
    /// with ICON_VERSION in the web tile. The response is cacheable and
    /// URLCache survives an app update, so without a new URL a freshly
    /// installed build would keep painting the art the old one cached. 3
    /// dropped the owner/org-avatar fallback, so a repo that was wearing its
    /// org's mark had to stop asking for the copy on disk; 4 trims the empty
    /// margin around every icon, so the copies drawn small have to go.
    private static let iconVersion = 4

    @MainActor
    private static func iconURL(for name: String) -> URL? {
        var url = ServerConfig.shared.baseURL?
            .appendingPathComponent("repo-icon")
            .appendingPathComponent("\(name).png")
        var query = [URLQueryItem(name: "v", value: "\(iconVersion)")]
        // An icon replaced from Settings is a different picture at the same
        // path; its revision is what tells the cache that.
        if let rev = RepoTilePalette.shared.iconRevisions[name] {
            query.append(URLQueryItem(name: "r", value: "\(rev)"))
        }
        url?.append(queryItems: query)
        return url
    }

    /// The icon on its own, for the one place that can't host the tile: a menu
    /// row, whose label is handed to UIKit and survives only as an image.
    /// Reads the cache without touching it — a getter that started a load
    /// would be mutating observed state from inside a view's body — so pair it
    /// with `prefetchIcon` where the rows are known ahead of time.
    @MainActor
    static func cachedIcon(for name: String) -> Image? {
        guard let url = iconURL(for: name) else { return nil }
        return RepoImageCache.shared.images[url.absoluteString]
    }

    @MainActor
    static func prefetchIcon(for name: String) {
        guard let url = iconURL(for: name) else { return }
        RepoImageCache.shared.ensureLoaded(url)
    }

    var body: some View {
        ZStack {
            // The fallback letter swatch only stands in while the real icon
            // loads: many icons (org avatars) carry transparent margins, so a
            // swatch kept underneath bleeds through as a colored border.
            // It always stands in — the sessions list wears this tile as its
            // Settings button, and suppressing the fallback there rendered an
            // invisible (though still tappable) control until the icon
            // arrived over the network.
            if let iconURL,
               let image = RepoImageCache.shared.images[iconURL.absoluteString] {
                image
                    .resizable()
                    .scaledToFill()
                    // Filling the tile is right: the server crops every icon
                    // to its artwork and re-pads it to a fixed margin, so the
                    // breathing room is already in the image. Shrinking again
                    // here would stack, and leave art reading smaller than
                    // the lettered tiles beside it (.repo-tile--img img on
                    // the web carries no inset either).
            } else {
                Text(letter)
                    .font(.system(size: size * 0.6, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .frame(width: size, height: size)
                    .background(color)
            }
        }
        .frame(width: size, height: size)
        .clipShape(
            RoundedRectangle(
                cornerRadius: round ? size / 2 : size * 0.28,
                style: .continuous
            )
        )
        .accessibilityLabel(Self.label(for: name))
        .task(id: iconURL?.absoluteString) {
            if let iconURL {
                RepoImageCache.shared.ensureLoaded(iconURL)
            }
        }
    }
}

/// Shared cache prevents scrolling a list from cancelling and restarting repo
/// image requests, which left recycled tiles on their colored fallback.
@MainActor
@Observable
final class RepoImageCache {
    static let shared = RepoImageCache()

    private(set) var images: [String: Image] = [:]
    private var loads: [String: Task<Void, Never>] = [:]
    /// URLs the server refused outright. An unregistered repo id 404s by
    /// design and its tile is meant to keep the letter swatch, so those stop
    /// asking; everything else is treated as worth another try.
    private var unavailable: Set<String> = []

    /// Owning the load rather than running it inside the caller's task is the
    /// point: `.task` is cancelled when a tile is recycled or its view
    /// rebuilt, and the request died with it. The sessions list wears one of
    /// these tiles as its Settings button, where the cancellation was
    /// systematic — its request went out alongside the first (multi-megabyte)
    /// sessions poll, and once that one attempt was lost nothing asked again,
    /// so the button had no icon for the rest of the launch.
    func ensureLoaded(_ url: URL) {
        let key = url.absoluteString
        guard images[key] == nil, loads[key] == nil, !unavailable.contains(key)
        else { return }
        loads[key] = Task { [weak self] in await self?.load(url, key: key) }
    }

    private func load(_ url: URL, key: String) async {
        defer { loads[key] = nil }

        var request = ServerConfig.shared.authorizedRequest(url)
        request.cachePolicy = .returnCacheDataElseLoad

        // URLCache's store is on disk, so every launch after the first paints
        // from it. Reading the store directly rather than through URLSession
        // keeps a relaunch off the network stack entirely — the same bytes
        // `.returnCacheDataElseLoad` would have handed back.
        if let cachedData = await Self.cachedData(request),
           let cached = await Self.decode(cachedData) {
            images[key] = cached
            // That read never expires, so a repo whose icon is redrawn on the
            // server would keep the old one for the life of the install. Look
            // for a newer one behind the paint — while the stored response is
            // fresh that costs no network at all, and once it goes stale the
            // tile updates itself.
            if let newer = await Self.changedBytes(url, since: cachedData),
               let redrawn = await Self.decode(newer) {
                images[key] = redrawn
            }
            return
        }

        // Long enough to outlast the sessions poll a cold launch competes
        // with, short enough that the tile settles while the person is still
        // looking at it.
        for delay in [0, 2, 8, 30] {
            if delay > 0 {
                try? await Task.sleep(for: .seconds(delay))
            }
            do {
                let (data, response) = try await URLSession.shared.data(for: request)
                if let http = response as? HTTPURLResponse,
                   !(200..<300).contains(http.statusCode) {
                    if (400..<500).contains(http.statusCode),
                       http.statusCode != 408, http.statusCode != 429 {
                        unavailable.insert(key)
                        return
                    }
                    continue
                }
                guard let decoded = await Self.decode(data) else {
                    unavailable.insert(key)
                    return
                }
                images[key] = decoded
                return
            } catch {
                continue
            }
        }
    }

    private static func cachedData(_ request: URLRequest) async -> Data? {
        await Task.detached(priority: .userInitiated) {
            URLCache.shared.cachedResponse(for: request)?.data
        }.value
    }

    /// Re-fetches an icon that was painted from the disk cache, on the
    /// protocol's own cache policy, and hands back its bytes only when the
    /// server has a different image than the one already on screen.
    private static func changedBytes(_ url: URL, since cached: Data) async -> Data? {
        var request = ServerConfig.shared.authorizedRequest(url)
        request.cachePolicy = .useProtocolCachePolicy
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode),
                  data != cached
            else { return nil }
            return data
        } catch {
            return nil
        }
    }

    private static func decode(_ data: Data) async -> Image? {
        await detachedDecode { data }
    }

    /// Tiles top out at 52 points, so a full-size decode of a configured repo
    /// icon (the app's own 512×512 PNG) would hold ~1 MB of bitmap for an
    /// 18-point swatch. ImageIO downsamples while decoding, and — unlike
    /// `UIImage(data:)`, which defers the pixel work to render time — does it
    /// here, off the main actor.
    private static func detachedDecode(
        _ load: @escaping @Sendable () -> Data?
    ) async -> Image? {
        let thumbnail = await Task.detached(priority: .userInitiated) { () -> CGImage? in
            guard let data = load(),
                  let source = CGImageSourceCreateWithData(data as CFData, nil)
            else { return nil }
            return CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: 192,
            ] as CFDictionary)
        }.value
        // Decorative: `RepoTile` carries the repository name as its label.
        return thumbnail.map { Image(decorative: $0, scale: 1) }
    }
}
