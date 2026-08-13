import Foundation

/// Session ids inside agent output, turned into links you can follow.
///
/// An orchestrator says "delegated to `bks-019f…`" constantly, and on the web
/// that renders as the worker's own title and navigates in-app. Natively it was
/// dead text — forty characters of noise you could not act on. The transcript's
/// markdown is rewritten just before rendering so those ids become ordinary
/// markdown links on a private scheme, which the transcript intercepts through
/// `openURL` (SwiftStreamingMarkdown routes taps through that environment
/// value) and turns into a push.
///
/// The rewrite is deliberately conservative: fenced and indented code stays
/// untouched, and an id already inside a URL is left alone so link targets
/// can't be corrupted.
@MainActor
enum SessionLinks {
    /// Private scheme, so a link can never escape to a browser by accident.
    static let scheme = "os1session"

    /// id → title, refreshed from the polled sessions list. A title is only
    /// ever a nicety: an id we've never seen still links, labelled by its
    /// shortened id.
    private static var titles: [String: String] = [:]

    static func register(titles next: [String: String]) {
        if next != titles { titles = next }
    }

    static func title(for id: String) -> String? { titles[id] }

    /// The session id a transcript link points at, or nil for a normal URL.
    static func sessionId(from url: URL) -> String? {
        guard url.scheme == scheme else { return nil }
        // os1session:bks-… — the id lands in `path` or `host` depending on
        // how the URL was spelled, so accept either.
        let candidate = url.host ?? url.path
        let id = candidate.hasPrefix("/") ? String(candidate.dropFirst()) : candidate
        return id.hasPrefix("bks-") ? id : nil
    }

    // A codespan'd id (`bks-…`), which is how agents usually write one, or a
    // bare uuidv7-shaped one in prose. The bare form is strict on purpose so
    // it can't misfire on ordinary words.
    private static let pattern = try! NSRegularExpression(
        pattern:
            "`(bks-[a-z0-9][a-z0-9-]{5,})`"
            + "|(?<![\\w/-])(bks-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
        options: [.caseInsensitive]
    )

    private static let shortIdLength = 12
    private static let titleMaxLength = 38

    /// Markdown with every session id rewritten as a link. Returns the input
    /// unchanged when there is nothing to do, which is the common case.
    static func linkify(_ markdown: String) -> String {
        guard markdown.contains("bks-") else { return markdown }
        return MarkdownProse.rewrite(markdown) { line in
            // A line with no id is most lines.
            line.contains("bks-") ? linkifyLine(line) : line
        }
    }

    private static func linkifyLine(_ line: String) -> String {
        let ns = line as NSString
        var result = ""
        var cursor = 0
        for match in pattern.matches(in: line, range: NSRange(location: 0, length: ns.length)) {
            let idRange = match.range(at: 1).location != NSNotFound
                ? match.range(at: 1)
                : match.range(at: 2)
            guard idRange.location != NSNotFound else { continue }
            let id = ns.substring(with: idRange)
            result += ns.substring(with: NSRange(
                location: cursor,
                length: match.range.location - cursor
            ))
            result += "[\(escaped(label(for: id)))](\(scheme):\(id))"
            cursor = match.range.location + match.range.length
        }
        guard cursor > 0 else { return line }
        result += ns.substring(from: cursor)
        return result
    }

    /// The chip's text: the referenced session's title when we know it,
    /// otherwise a shortened id. Both are lossy, which is fine — the link
    /// itself carries the full id.
    static func label(for id: String) -> String {
        if let title = titles[id], !title.isEmpty {
            let title = cleanTitle(title)
            return title.count > titleMaxLength
                ? String(title.prefix(titleMaxLength - 1)).trimmingCharacters(in: .whitespaces) + "…"
                : title
        }
        // Legacy `bks-<slug>` ids are already short, and cutting one mid-word
        // reads worse than showing all of it.
        return id.count <= 20 ? id : String(id.prefix(shortIdLength)) + "…"
    }

    /// A session an automation opened names itself after the job that opened
    /// it: "Simplify · PR #5517 Give floating surfaces a rounder corner". That
    /// prefix is bookkeeping rather than subject, and on a chip clipped at 38
    /// characters it eats the readable half. The web strips it wherever a
    /// title is shown at a width that has to choose (`cleanSessionTitle` in
    /// src/frontend/lib/session-title.ts); this is the same rule, so the same
    /// session reads the same way in both clients. Stripping everything is no
    /// improvement on the boilerplate, so a title that is only a prefix keeps it.
    private static let automationPrefix = try! NSRegularExpression(
        pattern: "^(Review|Auto-fix|Mention|Simplify|Fix)\\s*·\\s*PR\\s*#\\d+\\s*",
        options: [.caseInsensitive]
    )

    static func cleanTitle(_ title: String) -> String {
        let ns = title as NSString
        let stripped = automationPrefix.stringByReplacingMatches(
            in: title,
            range: NSRange(location: 0, length: ns.length),
            withTemplate: ""
        ).trimmingCharacters(in: .whitespaces)
        return stripped.isEmpty ? title : stripped
    }

    /// A title is arbitrary text landing in a markdown link label, so the
    /// characters that would end that label early have to be escaped.
    private static func escaped(_ label: String) -> String {
        label
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "[", with: "\\[")
            .replacingOccurrences(of: "]", with: "\\]")
    }
}
