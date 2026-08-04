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
            ? UIColor(red: 0.149, green: 0.192, blue: 0.259, alpha: 1)
            : UIColor(red: 0.933, green: 0.949, blue: 0.969, alpha: 1)
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
    /// Same blue-gray tint as the iOS user bubble, resolved per appearance,
    /// so the two apps read as one product.
    static let userMessage = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
            ? NSColor(red: 0.149, green: 0.192, blue: 0.259, alpha: 1)
            : NSColor(red: 0.933, green: 0.949, blue: 0.969, alpha: 1)
    })
    #endif
    static let accent = Color(red: 1.0, green: 0.231, blue: 0.231)
    // One status palette on both platforms — the Mac previously used stock
    // Color.green/.yellow/… which rendered different hues than iOS.
    static let green = Color(red: 0.247, green: 0.725, blue: 0.314)
    static let yellow = Color(red: 0.824, green: 0.600, blue: 0.133)
    static let blue = Color(red: 0.345, green: 0.651, blue: 1.0)
    static let red = Color(red: 0.973, green: 0.318, blue: 0.286)
    static let purple = Color(red: 0.639, green: 0.443, blue: 0.969)
    #if os(iOS)
    static let chatMaxWidth: CGFloat = 780
    #else
    /// Keep 13pt desktop body copy near the comfortable 65-75 character range.
    static let chatMaxWidth: CGFloat = 720
    #endif
}

/// Compact repository identity used in repo headers and the conversation title.
/// Its stable single-letter swatch mirrors the web fallback tile.
struct RepoTile: View {
    let name: String
    var size: CGFloat = 18
    var round = false

    static func label(for name: String) -> String {
        name == "backstage" ? "opensession" : name
    }

    private var letter: String {
        if name == "backstage" { return "O" }
        return String(name.prefix(1)).uppercased()
    }

    private var color: Color {
        let palette: [Color] = [
            Color(red: 0.91, green: 0.51, blue: 0.42),
            Color(red: 0.42, green: 0.65, blue: 0.91),
            Color(red: 0.56, green: 0.85, blue: 0.61),
            Color(red: 0.91, green: 0.77, blue: 0.42),
            Color(red: 0.75, green: 0.42, blue: 0.91),
            Color(red: 0.42, green: 0.91, blue: 0.82),
            Color(red: 0.91, green: 0.42, blue: 0.61),
            Color(red: 0.64, green: 0.72, blue: 0.42),
        ]
        let hash = name.lowercased().unicodeScalars.reduce(Int32(0)) {
            $0 &* 31 &+ Int32($1.value)
        }
        return palette[Int(hash.magnitude) % palette.count]
    }

    private var iconURL: URL? {
        ServerConfig.shared.baseURL?
            .appendingPathComponent("repo-icon")
            .appendingPathComponent("\(name).png")
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
        if let cached = await Self.decodeCached(request) {
            images[key] = cached
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

    private static func decodeCached(_ request: URLRequest) async -> Image? {
        await detachedDecode { URLCache.shared.cachedResponse(for: request)?.data }
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
