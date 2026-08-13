import XCTest
@testable import OS1

/// A PR chip is a claim about which pull request a sentence means, so the
/// rewrite has to be as timid as the ones around it: a reference it cannot
/// place stays exactly as the agent wrote it, and anything quoted as code
/// survives byte for byte.
///
/// The rules being pinned here are the web's (src/frontend/lib/markdown.ts) —
/// a reference has to mean the same PR in both clients.
@MainActor
final class PrLinksTests: XCTestCase {
    private let session = "os-test"

    override func setUp() async throws {
        PrLinks.register(repos: [
            "opensession": "tellahq/opensession",
            "tella-fusion": "tellahq/tella-fusion",
            // A repo the server serves without a GitHub name: it still chips,
            // it just has nowhere external to fall back to.
            "notes": nil,
        ])
        PrLinks.register(index: PrLinks.Index.build(try sessions(
            """
            [{"id":"os-test","repo":"opensession"},
             {"id":"os-other","repo":"opensession","prNumber":92,"prState":"MERGED"}]
            """
        )))
    }

    private func sessions(_ json: String) throws -> [Session] {
        try JSONDecoder().decode([Session].self, from: Data(json.utf8))
    }

    private func linkify(_ markdown: String) -> String {
        PrLinks.linkify(markdown, sessionId: session)
    }

    // MARK: - The forms a PR is written in

    func testFullPrUrlBecomesAChip() {
        XCTAssertEqual(
            linkify("opened https://github.com/tellahq/opensession/pull/5528 for review"),
            "opened [PR #5528](os1pr:opensession/5528) for review"
        )
    }

    func testQualifiedMentionBecomesAChip() {
        XCTAssertEqual(
            linkify("landed in tella-fusion#5528 today"),
            "landed in [tella-fusion#5528](os1pr:tella-fusion/5528) today"
        )
        // `owner/repo#123` names the same repo: the id is instance-local and
        // the owner is noise we already know.
        XCTAssertEqual(
            linkify("see tellahq/opensession#128"),
            "see [tellahq/opensession#128](os1pr:opensession/128)"
        )
    }

    /// A qualified mention always links, however short its number — which is
    /// the whole reason the qualifier is matched rather than left dangling.
    func testShortQualifiedMentionStillLinks() {
        XCTAssertEqual(
            linkify("backported to tella-fusion#14"),
            "backported to [tella-fusion#14](os1pr:tella-fusion/14)"
        )
    }

    // MARK: - What must stay plain text

    /// The rule the repo convention asks for: short bare `#numbers` in prose
    /// are steps, hex colours and rankings far more often than they are PRs.
    func testBareShortNumberIsNotLinked() {
        for text in ["step #3 of the plan", "color: #333 on the panel", "ranked #29"] {
            XCTAssertEqual(linkify(text), text, text)
        }
    }

    /// Long enough to be a PR rather than prose.
    func testBareLongNumberLinksAgainstTheSessionsRepo() {
        XCTAssertEqual(
            linkify("rebased #5528 on main"),
            "rebased [#5528](os1pr:opensession/5528) on main"
        )
    }

    /// A short number links when something other than its digits says PR: the
    /// word in front of it, or a PR the sessions list already knows there.
    func testShortNumberLinksOnACue() {
        XCTAssertEqual(
            linkify("PR #14 is next"),
            "PR [#14](os1pr:opensession/14)"  + " is next"
        )
    }

    func testShortNumberLinksWhenTheListKnowsThatPr() {
        // os-other owns opensession#92, merged — so it chips, with its dot.
        XCTAssertEqual(
            linkify("shipped in #92"),
            "shipped in [\u{1F7E3} #92](os1pr:opensession/92)"
        )
    }

    /// A repo this instance doesn't serve must never be pointed at one of
    /// ours: the mention stays text, and the URL stays a plain link for
    /// `MarkdownAutolink` to open in the browser.
    func testUnknownRepoIsLeftAlone() {
        for text in [
            "see vercel/next.js#1234 for the bug",
            "see https://github.com/vercel/next.js/pull/1234 for the bug",
        ] {
            XCTAssertEqual(linkify(text), text, text)
        }
    }

    /// Nothing to place a bare mention against — a card outside a session, or
    /// a session with no repo.
    func testBareMentionWithoutARepoIsLeftAlone() {
        let text = "rebased #5528 on main"
        XCTAssertEqual(PrLinks.linkify(text, sessionId: nil), text)
    }

    /// A word glued to the `#` is a qualified mention by that word, not a bare
    /// one — so an unknown qualifier can't leave its digits behind to be read
    /// as a PR of the session's own repo. Entities stay entities.
    func testGluedAndEntityFormsAreLeftAlone() {
        for text in ["abc#5528 in the log", "an &#8212; dash", "issue-#5528"] {
            XCTAssertEqual(linkify(text), text, text)
        }
    }

    // MARK: - Code survives

    func testNumberInACodeSpanIsLeftAlone() {
        let text = "the header said `#5528` verbatim"
        XCTAssertEqual(linkify(text), text)
    }

    func testNumberInAFenceIsLeftAlone() {
        let text = """
        Run it:

        ```sh
        git show #5528
        curl https://github.com/tellahq/opensession/pull/5528
        ```

        then read #5528
        """
        let out = linkify(text)
        XCTAssertTrue(out.contains("git show #5528\n"), out)
        XCTAssertTrue(
            out.contains("curl https://github.com/tellahq/opensession/pull/5528\n"),
            out
        )
        XCTAssertTrue(out.contains("then read [#5528](os1pr:opensession/5528)"), out)
    }

    func testIndentedCodeIsLeftAlone() {
        let text = "    git show #5528"
        XCTAssertEqual(linkify(text), text)
    }

    // MARK: - Links

    /// `[PR #5528](https://github.com/…)` is everyday agent output. The label
    /// the agent chose stays; only where it goes changes.
    func testExplicitLinkToAPrIsRetargeted() {
        XCTAssertEqual(
            linkify("see [the PR](https://github.com/tellahq/opensession/pull/5528)"),
            "see [the PR](os1pr:opensession/5528)"
        )
    }

    /// A chip inside a link would nest one link in another. The skip
    /// alternatives are what stop that.
    func testMentionInsideALinkLabelIsLeftAlone() {
        let text = "[opensession#5528](https://example.com/x)"
        XCTAssertEqual(linkify(text), text)
    }

    func testImageDestinationIsNotRetargeted() {
        let text = "![shot](https://github.com/tellahq/opensession/pull/5528)"
        XCTAssertEqual(linkify(text), text)
    }

    // MARK: - Where a chip points

    func testReferenceRoundTripsThroughItsUrl() {
        let url = URL(string: "os1pr:opensession/5528")!
        XCTAssertEqual(
            PrLinks.reference(from: url),
            PrLinks.Reference(repo: "opensession", number: 5528)
        )
        XCTAssertNil(PrLinks.reference(from: URL(string: "https://tella.tv")!))
    }

    func testGithubFallbackNeedsAGithubName() {
        XCTAssertEqual(
            PrLinks.githubURL(for: .init(repo: "opensession", number: 5528)),
            URL(string: "https://github.com/tellahq/opensession/pull/5528")
        )
        XCTAssertNil(PrLinks.githubURL(for: .init(repo: "notes", number: 5528)))
    }

    func testOwnPrIsTheOneThisAppCanOpenInPlace() throws {
        let session = try sessions(
            """
            [{"id":"os-1","repo":"opensession","prNumber":5528}]
            """
        )[0]
        XCTAssertTrue(
            PrLinks.isOwnPr(.init(repo: "opensession", number: 5528), of: session)
        )
        XCTAssertFalse(
            PrLinks.isOwnPr(.init(repo: "opensession", number: 92), of: session)
        )
        XCTAssertFalse(
            PrLinks.isOwnPr(.init(repo: "tella-fusion", number: 5528), of: session)
        )
    }

    // MARK: - Live state

    /// The dot mirrors `PrChipLabel`'s, so a PR reads the same in the prose
    /// and in the toolbar. A PR no session in the list owns has no state to
    /// show and draws none.
    func testStateRidesOnTheChipOnlyWhenTheListKnowsIt() {
        XCTAssertEqual(
            linkify("opensession#92"),
            "[\u{1F7E3} opensession#92](os1pr:opensession/92)"
        )
        XCTAssertEqual(
            linkify("opensession#5528"),
            "[opensession#5528](os1pr:opensession/5528)"
        )
    }

    func testListStateIsRankedLikeTheFetchedPr() throws {
        let index = PrLinks.Index.build(try sessions(
            """
            [{"id":"a","repo":"opensession","prNumber":1,"prState":"OPEN",
              "prChecks":{"total":3,"passed":2,"failed":1,"pending":0}},
             {"id":"b","repo":"opensession","prNumber":2,"prState":"OPEN",
              "prChecks":{"total":3,"passed":2,"failed":0,"pending":1}},
             {"id":"c","repo":"opensession","prNumber":3,"prState":"OPEN","prIsDraft":true},
             {"id":"d","repo":"opensession","prNumber":4,"prState":"OPEN"},
             {"id":"e","repo":"opensession","prNumber":5,"prState":"CLOSED"},
             {"id":"f","repo":"opensession","prNumber":6}]
            """
        ))
        let key = PrLinks.Index.key
        XCTAssertEqual(index.states[key("opensession", 1)], .failing)
        XCTAssertEqual(index.states[key("opensession", 2)], .pending)
        XCTAssertEqual(index.states[key("opensession", 3)], .draft)
        XCTAssertEqual(index.states[key("opensession", 4)], .passing)
        XCTAssertEqual(index.states[key("opensession", 5)], .closed)
        // A row with a number but no state at all says nothing about it.
        XCTAssertNil(index.states[key("opensession", 6)])
    }

    // MARK: - Living beside the other rewrites

    /// The order `MarkdownBody` uses. A PR URL has to become a chip before
    /// autolinking claims it, and what it produces has to survive every
    /// rewrite that runs after it.
    func testChipSurvivesTheRestOfThePipeline() {
        let out = SessionLinks.linkify(
            MarkdownAutolink.linkify(
                linkify("opened https://github.com/tellahq/opensession/pull/5528 · docs at https://tella.tv")
            )
        )
        XCTAssertEqual(
            out,
            "opened [PR #5528](os1pr:opensession/5528) · docs at [https://tella.tv](https://tella.tv)"
        )
    }
}
