import { afterEach, describe, expect, it } from "bun:test";
import {
  renderMarkdown,
  renderPrCommentMarkdown,
  setKnownRepos,
  setSessionTitles,
} from "./markdown";

afterEach(() => {
  setSessionTitles([]);
  setKnownRepos([]);
});

describe("renderMarkdown session links", () => {
  it("turns a session-id codespan into a link", () => {
    const html = renderMarkdown(
      "Delegated to `bks-019f24b5-f31d-7000-a48f-31a9e829c4ae` reporting back.",
    );
    expect(html).toContain('class="session-link"');
    expect(html).toContain(
      'data-session-id="bks-019f24b5-f31d-7000-a48f-31a9e829c4ae"',
    );
    // not rendered as a plain <code> chip
    expect(html).not.toContain(
      "<code>bks-019f24b5-f31d-7000-a48f-31a9e829c4ae</code>",
    );
  });

  it("links a bare (un-backticked) uuidv7 session id in prose", () => {
    const html = renderMarkdown(
      "Started session bks-019f24b5-daa6-7000-8231-6c7ff13672ae as a worker.",
    );
    expect(html).toContain('class="session-link"');
    expect(html).toContain(
      'data-session-id="bks-019f24b5-daa6-7000-8231-6c7ff13672ae"',
    );
  });

  it("links an `os-` id — the prefix minted since the rename", () => {
    const codespan = renderMarkdown(
      "Delegated to `os-019fd30a-785b-7000-ad89-9c2fb5b74a19` reporting back.",
    );
    expect(codespan).toContain(
      'data-session-id="os-019fd30a-785b-7000-ad89-9c2fb5b74a19"',
    );
    const bare = renderMarkdown(
      "Started session os-019fd30a-785b-7000-ad89-9c2fb5b74a19 as a worker.",
    );
    expect(bare).toContain(
      'data-session-id="os-019fd30a-785b-7000-ad89-9c2fb5b74a19"',
    );
    const url = renderMarkdown(
      "See [it](http://127.0.0.1:3850/session/os-019fd30a-785b-7000-ad89-9c2fb5b74a19).",
    );
    expect(url).toContain(
      'data-session-id="os-019fd30a-785b-7000-ad89-9c2fb5b74a19"',
    );
    expect(url).not.toContain("target=");
  });

  it("keeps `os-` strict: only a uuid-shaped id, never a codespan that starts with it", () => {
    // `bks-` was distinctive enough for the loose slug shape; `os-` is two
    // letters, so anything but the minted `os-<uuidv7>` stays a code chip.
    const html = renderMarkdown("Tagged `os-release-2026` for the cut.");
    expect(html).toContain("<code>os-release-2026</code>");
    expect(html).not.toContain("session-link");
  });

  it("still resolves a legacy /backstage-prefixed session URL in-app", () => {
    // Pre-rename links live on in old transcripts; the server 301s them, but
    // the chip has to recognize the path to keep the click client-side.
    const html = renderMarkdown(
      "See [this](http://127.0.0.1:3850/backstage/session/bks-019f9608-ab20-7000-b98e-4de52d5fe436).",
    );
    expect(html).toContain(
      'data-session-id="bks-019f9608-ab20-7000-b98e-4de52d5fe436"',
    );
    expect(html).not.toContain("target=");
  });

  it("leaves ordinary codespans as code", () => {
    const html = renderMarkdown("Run `bun test` to check.");
    expect(html).toContain("<code>bun test</code>");
    expect(html).not.toContain("session-link");
  });

  it("does not misfire on non-session text", () => {
    const html = renderMarkdown("The bks-abbreviation is fine here.");
    expect(html).not.toContain("session-link");
  });

  it("renders an OS1 session URL as an in-app session link (no new tab)", () => {
    const html = renderMarkdown(
      "See [this session](http://127.0.0.1:3850/session/bks-019f9608-ab20-7000-b98e-4de52d5fe436).",
    );
    expect(html).toContain('class="session-link"');
    expect(html).toContain(
      'data-session-id="bks-019f9608-ab20-7000-b98e-4de52d5fe436"',
    );
    expect(html).toContain(">this session</a>");
    expect(html).not.toContain("target=");
  });

  it("labels a pasted (auto-linked) session URL with just the session id", () => {
    const url =
      "http://127.0.0.1:3850/workspace/ws-28712580-a369-4d58-996b-f8c23e523ed1/session/bks-019f9608-ab20-7000-b98e-4de52d5fe436";
    const html = renderMarkdown(`${url} shows no right sidebar.`);
    expect(html).toContain(
      'data-session-id="bks-019f9608-ab20-7000-b98e-4de52d5fe436"',
    );
    // the ~90-char URL is the href, never the chip's (nowrap) label
    expect(html).toContain(">bks-019f9608…</a>");
    expect(html).toContain(`href="${url}"`);
    expect(html).not.toContain(`>${url}</a>`);
  });

  it("keeps an explicit link label on a session URL", () => {
    const html = renderMarkdown(
      "See [the worker](http://127.0.0.1:3850/session/bks-019f9608-ab20-7000-b98e-4de52d5fe436).",
    );
    expect(html).toContain(">the worker</a>");
  });

  it("keeps other internal OS1 links same-tab without a chip", () => {
    const html = renderMarkdown(
      "Open [automations](http://127.0.0.1:3850/automations).",
    );
    expect(html).not.toContain("target=");
    expect(html).not.toContain("session-link");
  });

  it("still opens external links in a new tab", () => {
    const html = renderMarkdown("See [GitHub](https://github.com/tella/x).");
    expect(html).toContain('target="_blank"');
  });
});

describe("session chip labels", () => {
  const id = "bks-019f24b5-f31d-7000-a48f-31a9e829c4ae";

  it("labels a chip with the session's title once registered", () => {
    setSessionTitles([[id, "Fix the sidebar hover states"]]);
    const html = renderMarkdown(`Delegated to \`${id}\`.`);
    expect(html).toContain(">Fix the sidebar hover states</a>");
    expect(html).toContain(`data-session-id="${id}"`);
    // the full id stays reachable in the tooltip
    expect(html).toContain(`title="Open Fix the sidebar hover states (${id})"`);
    expect(html).not.toContain("data-session-label");
  });

  it("falls back to a shortened id, marked for monospace", () => {
    const html = renderMarkdown(`Delegated to \`${id}\`.`);
    expect(html).toContain(">bks-019f24b5…</a>");
    expect(html).toContain('data-session-label="id"');
    expect(html).toContain(`title="Open session ${id}"`);
  });

  it("cuts an `os-` id on a segment boundary, not mid-separator", () => {
    const html = renderMarkdown(
      "Delegated to `os-019fd30a-785b-7000-ad89-9c2fb5b74a19`.",
    );
    expect(html).toContain(">os-019fd30a…</a>");
  });

  it("keeps short legacy slug ids whole", () => {
    const html = renderMarkdown("Delegated to `bks-worker-two`.");
    expect(html).toContain(">bks-worker-two</a>");
  });

  it("truncates a long title", () => {
    setSessionTitles([
      [id, "A very long session title that would eat the whole sentence"],
    ]);
    const html = renderMarkdown(`Delegated to \`${id}\`.`);
    expect(html).toContain(">A very long session title that would…</a>");
  });

  it("re-labels already-rendered markdown when titles arrive", () => {
    const src = `Delegated to \`${id}\`.`;
    expect(renderMarkdown(src)).toContain(">bks-019f24b5…</a>");
    setSessionTitles([[id, "Late title"]]);
    expect(renderMarkdown(src)).toContain(">Late title</a>");
  });

  it("ignores blank titles and unrelated sessions", () => {
    setSessionTitles([
      [id, "   "],
      ["bks-someone-else", "Other"],
    ]);
    expect(renderMarkdown(`Delegated to \`${id}\`.`)).toContain(
      ">bks-019f24b5…</a>",
    );
  });
});

describe("renderMarkdown asset references", () => {
  const assets = {
    sessionId: "os-assets-test",
    assetPaths: ["report.html", "viz/index.html", "shots/before.png"],
  };

  it("links a current asset named directly in prose", () => {
    const html = renderMarkdown("Open `report.html` to inspect it.", assets);
    expect(html).toContain('class="asset-ref"');
    expect(html).toContain('data-asset-path="report.html"');
    expect(html).toContain("<code>report.html</code>");
    expect(html).toContain(
      'href="/api/sessions/os-assets-test/assets/raw/report.html"',
    );
  });

  it("resolves an unambiguous trailing filename to its nested asset", () => {
    const html = renderMarkdown("Compare before.png with the result.", assets);
    expect(html).toContain('data-asset-path="shots/before.png"');
    expect(html).toContain(">before.png</a>");
  });

  it("leaves unknown and ambiguous names as plain text", () => {
    const ambiguous = {
      sessionId: "os-assets-test",
      assetPaths: ["first/index.html", "second/index.html"],
    };
    expect(renderMarkdown("Open summary.html.", assets)).not.toContain(
      "asset-ref",
    );
    expect(renderMarkdown("Open index.html.", ambiguous)).not.toContain(
      "asset-ref",
    );
    expect(renderMarkdown("Open first/index.html.", ambiguous)).toContain(
      'data-asset-path="first/index.html"',
    );
  });

  it("keeps an explicit markdown link as the destination", () => {
    const html = renderMarkdown(
      "Read [`report.html`](https://example.com/report.html).",
      assets,
    );
    expect(html).toContain('href="https://example.com/report.html"');
    expect(html).toContain("<code>report.html</code>");
    expect(html).not.toContain("asset-ref");
  });

  it("does not link a matching filename inside a larger path or address", () => {
    const html = renderMarkdown(
      "See https://example.com/report.html or mail@report.html.",
      assets,
    );
    expect(html).not.toContain("asset-ref");
  });

  it("does not treat an @-prefixed unknown name as an asset", () => {
    expect(renderMarkdown("Ask @report.html for details.", assets)).not.toContain(
      "asset-ref",
    );
  });

  it("keeps exact asset names linkable past the former alias cap", () => {
    const paths = Array.from(
      { length: 601 },
      (_, index) => `asset-${String(index).padStart(4, "0")}.txt`,
    );
    const html = renderMarkdown("Open asset-0600.txt.", {
      sessionId: "os-many-assets",
      assetPaths: paths,
    });
    expect(html).toContain('data-asset-path="asset-0600.txt"');
  });

  it("does not reuse cached plain markdown once asset context is available", () => {
    const source = "Open report.html.";
    expect(renderMarkdown(source)).not.toContain("asset-ref");
    expect(renderMarkdown(source, assets)).toContain(
      'data-asset-path="report.html"',
    );
  });
});

describe("renderMarkdown PR mentions", () => {
  const fusion = { repo: "tella-fusion" };

  it("links a bare #number to the review page for the rendering repo", () => {
    const html = renderMarkdown("Fixed in #5528, ready to merge.", fusion);
    expect(html).toContain('class="pr-ref"');
    expect(html).toContain('href="/pr/tella-fusion/5528"');
    expect(html).toContain('data-pr-repo="tella-fusion"');
    expect(html).toContain('data-pr-number="5528"');
    expect(html).toContain(">#5528</a>");
  });

  it("carries the GitHub name for the cmd-click escape, when known", () => {
    setKnownRepos([{ id: "tella-fusion", ghRepo: "tellahq/tella-fusion" }]);
    expect(renderMarkdown("Fixed in #5528.", fusion)).toContain(
      'data-pr-gh="tellahq/tella-fusion"',
    );
    // A repo with no GitHub name still links here; there is just nowhere to
    // escape to, so the chip carries no target.
    setKnownRepos([{ id: "tella-fusion" }]);
    const local = renderMarkdown("Fixed in #5528.", fusion);
    expect(local).toContain('href="/pr/tella-fusion/5528"');
    expect(local).not.toContain("data-pr-gh");
  });

  it("leaves a mention plain when the caller renders without a repo", () => {
    const html = renderMarkdown("Fixed in #5528, ready to merge.");
    expect(html).not.toContain("pr-ref");
    expect(html).toContain("#5528");
  });

  it("places a qualified mention by its own repo, registered ones only", () => {
    setKnownRepos([
      { id: "tella-fusion", ghRepo: "tellahq/tella-fusion" },
      { id: "opensession", ghRepo: "tellahq/opensession" },
    ]);
    const qualified = renderMarkdown("See opensession#128 and #5528.", fusion);
    expect(qualified).toContain('href="/pr/opensession/128"');
    expect(qualified).toContain(">opensession#128</a>");
    // the bare one still belongs to the rendering repo
    expect(qualified).toContain('href="/pr/tella-fusion/5528"');
    // owner/repo is the same repo, addressed the GitHub way
    expect(renderMarkdown("tellahq/opensession#128", fusion)).toContain(
      'href="/pr/opensession/128"',
    );
    // a name this instance doesn't serve stays text — the route can't resolve it
    const unknown = renderMarkdown("vercel/next.js#1234 is upstream.", fusion);
    expect(unknown).not.toContain("pr-ref");
  });

  it("does not fire on the things that merely look like a PR mention", () => {
    setKnownRepos([{ id: "tella-fusion", ghRepo: "tellahq/tella-fusion" }]);
    for (const src of [
      "the colour is #123456 in both themes", // 6+ digits: never a mention
      "em dash entity &#8212; here",
      "issue ##12 double hash",
      "`#5528` stays a code chip",
      "    #5528 in an indented code block",
      "# 5528 is a heading",
    ]) {
      expect(renderMarkdown(src, fusion)).not.toContain("pr-ref");
    }
  });

  it("reads mentions as they are actually written in prose", () => {
    // Sentence-final, parenthesised, inside emphasis, at the start of a line,
    // and in a list — all the same reference.
    for (const src of [
      "Shipped in #5528.",
      "Shipped (#5528) yesterday",
      "**#5528** is the one",
      "#5528 is the one",
      "- reverts #5528\n- keeps #42",
    ]) {
      expect(renderMarkdown(src, fusion)).toContain('data-pr-number="');
    }
  });

  it("leaves a URL fragment alone", () => {
    const html = renderMarkdown(
      "https://github.com/tellahq/tella-fusion/pull/5528#issuecomment-12345",
      fusion,
    );
    expect(html).not.toContain("pr-ref");
  });

  it("keeps a mention inside a link's text as text (no nested anchor)", () => {
    const html = renderMarkdown(
      "[PR #5528](https://github.com/tellahq/tella-fusion/pull/5528)",
      fusion,
    );
    expect(html).toContain(
      '<a href="https://github.com/tellahq/tella-fusion/pull/5528"',
    );
    expect(html).toContain(">PR #5528</a>");
    expect(html).not.toContain("pr-ref");
  });

  it("renders the same source differently per repo (cache is repo-keyed)", () => {
    const src = "Landed #42.";
    expect(renderMarkdown(src, { repo: "tella-fusion" })).toContain(
      'href="/pr/tella-fusion/42"',
    );
    expect(renderMarkdown(src, { repo: "opensession" })).toContain(
      'href="/pr/opensession/42"',
    );
  });
});

describe("renderMarkdown strikethrough (double-tilde only)", () => {
  it("does not strike through single tildes in code-ish content", () => {
    // ReScript labeled args, approximate numbers, home paths — all bare tildes.
    for (const src of [
      "updateUpdatedAt(~storyID=query.id, ~sceneID=scene.id)",
      "call foo(~storyID) then bar(~sceneID) next",
      "That leaves ~352 across ~165 files",
      "edit ~/.config and ~/.bashrc",
    ]) {
      expect(renderMarkdown(src)).not.toContain("<del>");
    }
  });

  it("still renders real ~~strikethrough~~", () => {
    expect(renderMarkdown("this is ~~struck~~ text")).toContain("<del>struck</del>");
  });
});

describe("renderPrCommentMarkdown GitHub details", () => {
  it("renders collapsible reviews and subtext", () => {
    const html = renderPrCommentMarkdown(`<details> <summary>Outdated review</summary>
**Ada review** · request changes

<sub>Reviewed 3147253 · open session</sub>
</details>`);

    expect(html).toContain('<details class="md-details">');
    expect(html).toContain("<summary>Outdated review</summary>");
    expect(html).toContain("<strong>Ada review</strong>");
    expect(html).toContain("<sub>Reviewed 3147253 · open session</sub>");
  });

  it("continues to escape untrusted HTML", () => {
    const html = renderPrCommentMarkdown(
      "<details><summary>Safe</summary><script>alert(1)</script></details>",
    );
    expect(html).toContain('<details class="md-details">');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("does not allow attributes on whitelisted tags", () => {
    const html = renderPrCommentMarkdown(
      '<details open onclick="alert(1)"><summary>Unsafe</summary>Body</details>',
    );
    expect(html).toContain("&lt;details open onclick=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain('<details open onclick="alert(1)">');
  });
});
