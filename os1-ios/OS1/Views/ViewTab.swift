import SwiftUI

/// A tab in the session strip that isn't a conversation — a view onto one.
///
/// The strip is deliberately kind-agnostic: conversations, review, assets and
/// whatever comes next sit in one row, and a tab knows how to title and draw
/// itself. Adding a kind is a case here plus its content in `SessionTabsView`;
/// none of the strip's plumbing changes, and nothing about the pills, the
/// close gesture or the transitions has to learn what it is looking at.
///
/// Deliberately NOT sessions: only a conversation pulses while it runs, only a
/// conversation clears its unread mark, and only a conversation is archived by
/// being closed. Keeping the kinds apart is what makes those true by
/// construction rather than by remembering to check.
struct ViewTab: Identifiable, Equatable {
    enum Kind: Equatable {
        /// The session's scratch assets, optionally opened on one file.
        case assets(path: String?)
        /// The session's pull request, read-only.
        case review

        /// Stable per kind, and the tab's identity together with its session:
        /// asking for assets again is the SAME tab on a different file, not a
        /// second one.
        var slug: String {
            switch self {
            case .assets: "assets"
            case .review: "review"
            }
        }

        var title: String {
            switch self {
            case .assets: "Assets"
            case .review: "Review"
            }
        }

        var icon: String {
            switch self {
            case .assets: "folder"
            case .review: "arrow.triangle.pull"
            }
        }

        var closeLabel: String { "Close \(title.lowercased())" }
    }

    /// The conversation this is a view of — where closing the tab returns to.
    let sessionId: String
    var kind: Kind

    var id: String { "os1-tab-\(kind.slug)-\(sessionId)" }

    /// Same tab, possibly aimed at something else (another asset file).
    func isSameTab(as other: ViewTab) -> Bool {
        sessionId == other.sessionId && kind.slug == other.kind.slug
    }
}

/// Open one of those tabs for the session the caller is inside.
///
/// An environment action rather than a callback threaded down through the
/// transcript: the deepest caller is a tool-call row, several layers below the
/// session view, and none of the rows in between have any business knowing
/// that a strip exists. `isAvailable` is what a caller checks before drawing
/// a button — the Mac app installs no handler, and an entry that does nothing
/// is worse than no entry.
struct OpenViewTabAction: Equatable {
    /// The session whose tabs this opens — and the action's identity.
    ///
    /// Equatable on purpose, and keyed on something stable: the handler is a
    /// fresh closure on every parent update, and an environment value that
    /// never compares equal would re-evaluate `SessionView.body` — transcript
    /// and all — every time the sessions poll landed.
    let sessionId: String?
    fileprivate let handler: ((ViewTab.Kind) -> Void)?

    var isAvailable: Bool { handler != nil }

    /// `openViewTab(.review)`, `openViewTab(.assets(path: "report.html"))`.
    func callAsFunction(_ kind: ViewTab.Kind) { handler?(kind) }

    static let unavailable = OpenViewTabAction(sessionId: nil, handler: nil)

    static func opening(
        sessionId: String,
        _ handler: @escaping (ViewTab.Kind) -> Void
    ) -> OpenViewTabAction {
        OpenViewTabAction(sessionId: sessionId, handler: handler)
    }

    static func == (lhs: OpenViewTabAction, rhs: OpenViewTabAction) -> Bool {
        lhs.sessionId == rhs.sessionId && lhs.isAvailable == rhs.isAvailable
    }
}

private struct OpenViewTabKey: EnvironmentKey {
    static let defaultValue = OpenViewTabAction.unavailable
}

extension EnvironmentValues {
    var openViewTab: OpenViewTabAction {
        get { self[OpenViewTabKey.self] }
        set { self[OpenViewTabKey.self] = newValue }
    }
}
