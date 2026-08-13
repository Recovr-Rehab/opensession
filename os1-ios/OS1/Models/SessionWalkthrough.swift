import Foundation

/// The demo an agent publishes when it finishes a user-visible change: a short
/// screen recording, before/after stills, and a writeup. Mirrors the server's
/// `SessionWalkthrough` (src/server/types.ts) — every field but the timestamp
/// is optional, since a walkthrough can be writeup-only.
///
/// It rides on the session row rather than the transcript, and is placed into
/// the transcript by `TranscriptGrouping` at the point where it was published.
struct SessionWalkthrough: Decodable, Equatable, Hashable {
    /// Markdown: what changed, root cause for a fix, how it was verified.
    var summary: String = ""
    /// Absolute server-side path to the demo recording, if there is one.
    var video: String?
    var videoTitle: String?
    var shots: [WalkthroughShot]?
    var publishedAt: String = ""
    var publishedBy: String?
    /// Transcript entry of the `publish_walkthrough` call that produced this.
    /// The server records it at publish time — the one moment anything knows
    /// where the card belongs — so placement is a lookup rather than a scan.
    /// Absent on walkthroughs published before that field existed.
    var publishedEntryId: String?

    var publishedDate: Date? { Session.parseISO(publishedAt) }

    var stills: [WalkthroughShot] {
        (shots ?? []).filter { $0.before != nil || $0.after != nil }
    }

    /// The line the FOLDED card says above its pictures: the first paragraph of
    /// the writeup, as plain text.
    ///
    /// The publish contract asks for a writeup whose first paragraph says what
    /// changed and why it matters, so that paragraph is the whole point of the
    /// card and the one thing worth reading without opening it. Folded, the
    /// card used to be a strip of thumbnails with nothing saying what they were
    /// of.
    ///
    /// Markdown is reduced to text rather than rendered: the lede is clamped to
    /// a few lines inside a card that is itself a fold, and a heading or a code
    /// fence at the top of a writeup is skipped for a second reason: "What
    /// changed" is not a lede. Same rules as the web card's `walkthroughLede`
    /// (src/frontend/lib/walkthrough-lede.ts), kept here as plain string work
    /// so it can be tested.
    var lede: String {
        var block: [String] = []
        for line in summary.components(separatedBy: .newlines) {
            guard line.trimmingCharacters(in: .whitespaces).isEmpty else {
                block.append(line)
                continue
            }
            if let text = Self.lede(of: block), !text.isEmpty { return text }
            block = []
        }
        return Self.lede(of: block) ?? ""
    }

    /// One paragraph, flattened: its lines joined, its markup taken off. `nil`
    /// for a block that is not prose at all.
    private static func lede(of block: [String]) -> String? {
        guard let first = block.first?.trimmingCharacters(in: .whitespaces) else { return nil }
        guard !first.hasPrefix("#"), !first.hasPrefix("```"), !first.hasPrefix("~~~") else {
            return nil
        }
        var text = block
            // A quote, a bullet or a number is punctuation of the block, not of
            // the sentence: the words after it are what the paragraph says.
            .map {
                $0.replacing(/^[ \t]{0,3}(>[ ]?|[-*+][ ]+|[0-9]+[.)][ ]+)/, with: "")
                    .trimmingCharacters(in: .whitespaces)
            }
            .joined(separator: " ")
        text = text.replacing(/!\[[^\]]*\]\([^)]*\)/, with: "")
        text = text.replacing(/\[([^\]]*)\]\([^)]*\)/) { $0.output.1 }
        text = text.replacing(/`([^`]+)`/) { $0.output.1 }
        text = text.replacing(/\*\*(.+?)\*\*/) { $0.output.1 }
        text = text.replacing(/__(.+?)__/) { $0.output.1 }
        // Single-marker emphasis only where a marker opens and closes a run, so
        // an identifier like some_field_name keeps its underscores.
        text = text.replacing(/\*([^*\s][^*\n]*?)\*/) { $0.output.1 }
        return text.replacing(/[ \t]+/, with: " ").trimmingCharacters(in: .whitespaces)
    }
}

/// One before/after pair. Either side may be missing — an "after only" shot is
/// how a brand-new surface gets illustrated.
struct WalkthroughShot: Decodable, Equatable, Hashable, Identifiable {
    var before: String?
    var after: String?
    var caption: String?

    /// Stable within one walkthrough: the paths are distinct staged files.
    var id: String { "\(before ?? "")|\(after ?? "")" }
}
