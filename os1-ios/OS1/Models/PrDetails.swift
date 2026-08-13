import Foundation

/// PR details from `GET /api/sessions/:id/pr` — a tolerant subset of the
/// server's PrDetails (src/server/pr-info.ts). The route answers a bare JSON
/// `null` when the session's branch has no PR; decoding is optional-heavy so
/// server-side additions never break the client.
struct PrDetails: Decodable, Equatable {
    var number: Int
    var title: String?
    var url: String?
    /// OPEN | MERGED | CLOSED
    var state: String?
    var isDraft: Bool?
    var baseRefName: String?
    var headRefName: String?
    var additions: Int?
    var deletions: Int?
    var changedFiles: Int?
    /// APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | ""
    var reviewDecision: String?
    var author: String?
    var checks: [PrCheck]?
    var reviewers: [PrReviewer]?
    /// MERGEABLE | CONFLICTING | UNKNOWN — the provider's conflict probe.
    var mergeable: String?
    /// CLEAN | BEHIND | BLOCKED | DIRTY | UNSTABLE | … — merge-box state.
    var mergeStateStatus: String?
}

struct PrCheck: Decodable, Equatable {
    var name: String
    /// COMPLETED, IN_PROGRESS, QUEUED… ("" for StatusContexts).
    var status: String?
    /// SUCCESS, FAILURE, NEUTRAL, PENDING…
    var conclusion: String?
    var url: String?
    var startedAt: String?
    var completedAt: String?
    /// CheckRun workflow (e.g. "CI") — StatusContexts (Vercel deploys) have none.
    var workflowName: String?

    enum Rank {
        case success, failure, pending, neutral
    }

    /// Mirrors the web PrPanel's checkClass(): anything not completed is
    /// pending, and StatusContexts report PENDING/EXPECTED as a *conclusion*
    /// with an empty status, which must not read as neutral.
    var rank: Rank {
        let liveStatus = status ?? ""
        if liveStatus != "COMPLETED" && liveStatus != "" { return .pending }
        switch conclusion ?? "" {
        case "PENDING", "EXPECTED": return .pending
        case "SUCCESS": return .success
        case "FAILURE", "TIMED_OUT", "ERROR": return .failure
        default: return .neutral
        }
    }
}

/// A person on the PR's reviewer list; `state` is the review outcome
/// (APPROVED | CHANGES_REQUESTED | COMMENTED | DISMISSED) or PENDING for a
/// requested-but-not-yet-submitted review.
struct PrReviewer: Decodable, Equatable {
    var login: String
    var state: String?
    var isTeam: Bool?
}

extension PrDetails {
    /// One-dot summary for the toolbar chip: terminal states first, then the
    /// check rollup while open (no checks at all counts as passing — "no
    /// known CI blocker", matching the web list's treatment).
    enum Summary {
        case merged, closed, draft, failing, pending, passing
    }

    /// Still actionable: not merged and not closed. A server old enough to omit
    /// `state` counts as open — the actions it gates all fail loudly server-side
    /// rather than doing the wrong thing.
    var isOpen: Bool {
        state != "MERGED" && state != "CLOSED"
    }

    var summary: Summary {
        switch state ?? "" {
        case "MERGED": return .merged
        case "CLOSED": return .closed
        default: break
        }
        if isDraft == true { return .draft }
        let ranks = (checks ?? []).map(\.rank)
        if ranks.contains(.failure) { return .failing }
        if ranks.contains(.pending) { return .pending }
        return .passing
    }
}

extension PrDetails.Summary {
    /// The chip's dot as a character, for the one surface that can't draw a
    /// view: a PR chip inside the transcript is a markdown link, and a link
    /// renders in a single colour, so the state has to ride in the text.
    /// Colour glyphs, matched to `PrChipLabel`'s dot (PrPanel.swift) — purple
    /// merged, red closed or failing, grey draft, orange running, green
    /// passing — because one PR must not read one way in the toolbar and
    /// another in the prose above it.
    var marker: String {
        switch self {
        case .merged: "\u{1F7E3}"
        case .closed, .failing: "\u{1F534}"
        case .draft: "\u{26AA}"
        case .pending: "\u{1F7E0}"
        case .passing: "\u{1F7E2}"
        }
    }
}
