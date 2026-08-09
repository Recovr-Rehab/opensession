import Foundation

/// File paths inside a transcript, turned into links that open that file's
/// diff.
///
/// A turn's footer already names the files it touched, but the sentence above
/// it — "moved the guard into `src/server/pr.ts`" — is dead text, and the file
/// it names is the thing you want to look at while reading. This rewrites
/// those paths into
/// ordinary markdown links on a private scheme, which the session intercepts
/// through `openURL` and turns into a push of the Changes panel focused on
/// that file. Same mechanism as `SessionLinks`, and it runs after it.
///
/// This reaches the surfaces that render markdown — a turn's answer and its
/// narration. A user bubble and a notice body (a recap) are deliberately
/// plain `Text`, so a path written there stays text; that is a property of
/// those rows, not of this.
///
/// Only paths the session ITSELF touched are linked, registered per session
/// from the transcript's own tool calls. That is what keeps this honest in
/// both directions: a link always lands on a diff that exists, and prose that
/// merely looks like a path ("about 3/4 of the way") is never touched because
/// it was never registered.
@MainActor
enum FileLinks {
    /// Private scheme, so a link can never escape to a browser by accident.
    static let scheme = "os1file"

    /// session id → the paths that session changed, and the pattern matching
    /// them. Keyed by session because the transcript of one session must not
    /// link a path only another one touched: the link would push a Changes
    /// panel that has no diff to show.
    private struct Registry {
        var paths: Set<String>
        /// What may be WRITTEN → the full path it means. A turn touches
        /// `packages/core/webapp/src/frontend/UI__ContextMenu.res` and then
        /// writes `UI__ContextMenu.res`, which is how anyone refers to a file
        /// in a sentence — so every trailing segment run of a registered path
        /// is a way to say it, as long as it says only one of them.
        var targets: [String: String]
        var pattern: NSRegularExpression?
    }

    private static var registries: [String: Registry] = [:]

    /// A regex alternation of a thousand alternatives helps nobody; a session
    /// that large is one whose prose is not where you go looking for a file.
    /// Counted in ways-to-write-a-path, so roughly a hundred files.
    private static let maxPaths = 600

    static func register(paths next: Set<String>, for sessionId: String) {
        guard registries[sessionId]?.paths != next else { return }
        let targets = buildTargets(next)
        registries[sessionId] = Registry(
            paths: next,
            targets: targets,
            pattern: buildPattern(Set(targets.keys))
        )
    }

    /// Every trailing segment run of every path, minus the ambiguous ones.
    ///
    /// Two touched files called `index.ts` make `index.ts` mean neither, and
    /// a link that guesses which is worse than no link — so an ambiguous way
    /// of writing a path is dropped, and the longer forms that separate them
    /// (`server/index.ts`) survive.
    private static func buildTargets(_ paths: Set<String>) -> [String: String] {
        var targets: [String: String] = [:]
        var ambiguous: Set<String> = []
        for path in paths where !path.isEmpty {
            let segments = path.split(separator: "/").map(String.init)
            guard !segments.isEmpty else { continue }
            for start in segments.indices {
                let candidate = segments[start...].joined(separator: "/")
                if let existing = targets[candidate], existing != path {
                    ambiguous.insert(candidate)
                } else {
                    targets[candidate] = path
                }
            }
        }
        for candidate in ambiguous { targets.removeValue(forKey: candidate) }
        return targets
    }

    /// The file a transcript link points at, or nil for a normal URL.
    static func path(from url: URL) -> String? {
        guard url.scheme == scheme else { return nil }
        // os1file:src/a.ts — the path lands in `path` or `host` depending on
        // how the URL was spelled, so accept either.
        let candidate = url.host.map { host in
            host + url.path
        } ?? url.path
        let path = candidate.hasPrefix("/") ? String(candidate.dropFirst()) : candidate
        return path.isEmpty ? nil : path
    }

    /// Markdown with every registered path rewritten as a link. Returns the
    /// input unchanged when there is nothing to do, which is most text.
    static func linkify(_ markdown: String, sessionId: String?) -> String {
        guard let sessionId,
              let registry = registries[sessionId],
              let pattern = registry.pattern,
              !markdown.isEmpty
        else { return markdown }
        return MarkdownProse.rewrite(markdown) { line in
            linkifyLine(line, pattern: pattern, targets: registry.targets)
        }
    }

    // MARK: - Internals

    /// Skip alternatives first, so at any position an existing link wins over
    /// a path inside it — the same order (and the same reason) as
    /// `MarkdownAutolink`.
    private static func buildPattern(_ paths: Set<String>) -> NSRegularExpression? {
        // Longest first: `src/a/b.ts` must win over a registered `src/a`,
        // which would otherwise match its prefix and split the path in two.
        let alternatives = paths
            .filter { !$0.isEmpty }
            .sorted { $0.count == $1.count ? $0 < $1 : $0.count > $1.count }
            .prefix(maxPaths)
            .map { NSRegularExpression.escapedPattern(for: $0) }
        guard !alternatives.isEmpty else { return nil }
        let group = "(?:" + alternatives.joined(separator: "|") + ")"
        return try? NSRegularExpression(
            pattern:
                "(!?\\[[^\\]]*\\]\\([^)]*\\)"      // [label](destination)
                + "|<[^>\\s]+>)"                   // <https://…>
                + "|`(@?\(group))`"                // `path`, `@path`
                // A trailing "/" means the text continues into a LONGER path
                // than the one that matched — a registered directory must not
                // link the first half of the file under it. A trailing "." is
                // allowed: that is a sentence ending, not a deeper path.
                + "|(?<![\\w./~-])(@?\(group))(?![\\w/-])",
            options: []
        )
    }

    private static func linkifyLine(
        _ line: String,
        pattern: NSRegularExpression,
        targets: [String: String]
    ) -> String {
        let ns = line as NSString
        let matches = pattern.matches(
            in: line,
            range: NSRange(location: 0, length: ns.length)
        )
        guard !matches.isEmpty else { return line }

        var result = ""
        var cursor = 0
        for match in matches {
            // Group 1 matched: an existing link, copied verbatim.
            let coded = match.range(at: 2)
            let bare = match.range(at: 3)
            let target = coded.location != NSNotFound ? coded : bare
            guard target.location != NSNotFound else { continue }

            let whole = match.range
            result += ns.substring(with: NSRange(
                location: cursor,
                length: whole.location - cursor
            ))
            let text = ns.substring(with: target)
            let written = text.hasPrefix("@") ? String(text.dropFirst()) : text
            // The link goes to the full path, whatever shorthand named it.
            guard let path = targets[written],
                  let destination = destination(for: path) else {
                result += ns.substring(with: whole)
                cursor = whole.location + whole.length
                continue
            }
            // The label is the bare text even when the path was written in
            // backticks, because the renderer resolves a code span INSIDE a
            // link by keeping the link's tap and the code span's styling
            // (Markdown+InlineConvertible: InlineCode overrides .font and
            // .foregroundColor, .link survives) — a link that is tappable and
            // looks exactly like the un-tappable code around it. Dropping the
            // code voice is the smaller loss: the reader learns that a grey
            // chip is code and a coloured path is a file they can open.
            result += "[\(text)](\(destination))"
            cursor = whole.location + whole.length
        }
        result += ns.substring(from: cursor)
        return result
    }

    /// Percent-encode everything a markdown destination can't carry — a space
    /// ends the destination, and a parenthesis closes it.
    private static func destination(for path: String) -> String? {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "/._-~")
        guard let encoded = path.addingPercentEncoding(withAllowedCharacters: allowed)
        else { return nil }
        return "\(scheme):\(encoded)"
    }
}
