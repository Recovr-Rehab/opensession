import Foundation

/// Scratch files named in a transcript, turned into links that open them.
///
/// A turn that writes an artifact says so — "saved the chart as
/// `queue-depth.html`" — and that sentence is where the reader is when they
/// want to look. The chip under the answer already offers the same file, but
/// the chip is a footer: on a phone it is below the fold of a long answer, and
/// on a turn that wrote several files it is one of a row. The name in the
/// prose is the thing being pointed at, so make it the thing you tap.
///
/// Same mechanism as `FileLinks` — a markdown link on a private scheme,
/// intercepted through `openURL` — and it runs after it, so a repo path that
/// is also an asset name keeps its diff. Where a tap lands is `AssetOpen`'s
/// decision, exactly as it is for a chip: a picture lifts over the
/// conversation, everything else pushes.
@MainActor
enum AssetLinks {
    /// Private scheme, so a link can never escape to a browser by accident.
    static let scheme = "os1asset"

    private static let links = PathLinks(
        scheme: scheme,
        acceptsMentionPrefix: false,
        chipKind: .asset
    )

    static func register(paths next: Set<String>, for sessionId: String) {
        links.register(paths: next, for: sessionId)
    }

    /// The scratch file a transcript link points at, or nil for a normal URL.
    static func path(from url: URL) -> String? {
        links.path(from: url)
    }

    /// Markdown with every asset this session wrote rewritten as a link.
    static func linkify(_ markdown: String, sessionId: String?) -> String {
        links.linkify(markdown, sessionId: sessionId)
    }
}
