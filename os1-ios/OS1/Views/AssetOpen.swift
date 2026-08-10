import SwiftUI

/// The scratch file a transcript chip is about to open over the conversation.
///
/// Identifiable so the viewer is presented with `fullScreenCover(item:)`: the
/// picture it opens with is the one that was tapped, even if the turn's chips
/// change underneath it while it is up.
struct AssetPicture: Identifiable, Equatable {
    let sessionId: String
    let path: String

    var id: String { "\(sessionId)#\(path)" }

    /// Last path component — what the file is called, without its folder.
    var name: String {
        path.split(separator: "/").last.map(String.init) ?? path
    }
}

/// What tapping a scratch file in the transcript does.
///
/// The transcript names an asset in two places — the tool row that wrote it
/// and the chip in that turn's footer — and both come through here, so the two
/// ways into one file can't drift apart. Same split the web viewer makes:
///
/// A picture opens OVER the conversation, in the viewer every other image in
/// a transcript already opens: a picture is a glance, and a swipe down puts
/// the conversation back with nothing left to navigate. Everything else — a
/// report, a page, a log — is something you read, and pushes one level
/// deeper, where an HTML artifact's relative references resolve and the folder
/// is there to browse. A clip pushes too: the pushed preview is a player
/// already, and the picture viewer isn't.
enum AssetOpen {
    /// Extensions the picture viewer can render. SVG is deliberately absent:
    /// an animated or scripted one needs the web view the push gives it.
    private static let pictureExtensions: Set<String> = [
        "png", "jpg", "jpeg", "gif", "webp", "heic", "ico",
    ]

    static func isPicture(_ path: String) -> Bool {
        let name = path.split(separator: "/").last.map(String.init) ?? path
        guard let dot = name.lastIndex(of: "."), dot != name.startIndex
        else { return false }
        return pictureExtensions.contains(
            String(name[name.index(after: dot)...]).lowercased()
        )
    }

    /// Whether this app can lift a picture over what it is showing. The Mac
    /// app has no such viewer, and no panel stack either — so there a chip of
    /// either kind stays a plain, disabled label.
    static var canShowPicture: Bool {
        #if os(iOS)
        true
        #else
        false
        #endif
    }

    /// Whether a chip for this file leads anywhere — what a caller checks
    /// before drawing one, since a button that does nothing is worse than no
    /// button.
    ///
    /// A picture needs nothing but the view holding the chip, so it stays
    /// openable on the surfaces with no stack to push onto (the sub-agent
    /// sheet). Everything else needs a panel to push onto.
    static func canOpen(_ path: String, openPanel: OpenPanelAction) -> Bool {
        isPicture(path) ? canShowPicture : openPanel.isAvailable
    }

    static func open(
        sessionId: String,
        path: String,
        openPanel: OpenPanelAction,
        picture: Binding<AssetPicture?>
    ) {
        if isPicture(path), canShowPicture {
            picture.wrappedValue = AssetPicture(sessionId: sessionId, path: path)
            return
        }
        openPanel(.asset(sessionId: sessionId, path: path))
    }
}

extension View {
    /// Hosts the viewer `AssetOpen.open` lifts a picture into. Put it on the
    /// same view that owns the state — a chip inside a lazily-built transcript
    /// row can present perfectly well, and presenting from higher up would
    /// mean threading the tapped file back down again.
    func assetPicturePreview(_ picture: Binding<AssetPicture?>) -> some View {
        #if os(iOS)
        return fullScreenCover(item: picture) { item in
            FullScreenImagePreview(
                items: [
                    PreviewImage(
                        id: item.id,
                        source: .asset(sessionId: item.sessionId, path: item.path),
                        label: item.name
                    )
                ],
                index: 0
            )
        }
        #else
        return self
        #endif
    }
}
