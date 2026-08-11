import { Marked } from "marked";
import { BASE_PATH } from "./base";
import { PUBLIC_BASE_URL } from "./brand";
import { repoLabel } from "./repo-label";
import { sessionAssetRawUrl } from "./api/sessions";

// Dedicated marked instance for session messages so this config doesn't leak
// into other markdown (wiki, etc.). Two customisations:
//  - external links open in a new tab (target=_blank + safe rel); links into
//    OS1 itself navigate in place — session URLs become session-link
//    chips handled client-side, other internal paths load in the same tab
//  - images/videos render inline, capped in size; clicks open the media
//    lightbox (see MediaLightbox.tsx)
const md = new Marked({ async: false, breaks: true });

function attr(v: string | null | undefined): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

type AssetReferenceRegistry = {
  key: string;
  targets: Map<string, string>;
  start: RegExp;
  exact: RegExp;
};

const assetReferenceCache = new Map<string, AssetReferenceRegistry>();
const ASSET_REFERENCE_MAX_SHORT_ALIASES = 600;
let renderAssetReferences: AssetReferenceRegistry | null = null;
let renderAssetSessionId: string | undefined;

function regexEscape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build the names a session's scratch files may be called in prose. A nested
 * `shots/before.png` may be named by its full path or `before.png`; when two
 * files share that suffix, the ambiguous short form links neither.
 */
function assetReferenceRegistry(
  paths: readonly string[] | undefined,
): AssetReferenceRegistry | null {
  const unique = [...new Set((paths ?? []).filter(Boolean))].sort();
  if (unique.length === 0) return null;
  const key = unique.join("\u0000");
  const cached = assetReferenceCache.get(key);
  if (cached) return cached;

  const targets = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const path of unique) {
    const segments = path.split("/").filter(Boolean);
    for (let start = 0; start < segments.length; start++) {
      const name = segments.slice(start).join("/");
      const existing = targets.get(name);
      if (existing && existing !== path) ambiguous.add(name);
      else targets.set(name, path);
    }
  }
  for (const name of ambiguous) targets.delete(name);

  // Every unambiguous full path remains linkable. Cap only shorthand suffixes:
  // one deeply nested 2,000-file artifact can otherwise create tens of
  // thousands of regex alternatives for every markdown parser invocation.
  const fullPaths = unique.filter((path) => targets.has(path));
  const fullPathSet = new Set(unique);
  const shortAliases = [...targets.keys()]
    .filter((name) => !fullPathSet.has(name))
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, ASSET_REFERENCE_MAX_SHORT_ALIASES);
  const aliases = [...fullPaths, ...shortAliases].sort(
    (a, b) => b.length - a.length || a.localeCompare(b),
  );
  const selected = new Set(aliases);
  for (const name of targets.keys()) {
    if (!selected.has(name)) targets.delete(name);
  }
  if (aliases.length === 0) return null;
  const group = aliases.map(regexEscape).join("|");
  // Either the whole code span (`report.html`) or a bare path. The trailing
  // guard stops a registered directory from linking the first half of a
  // longer path; sentence punctuation remains allowed.
  const candidate = "(?:`(" + group + ")`|(" + group + ")(?![\\w/-]))";
  const registry = {
    key,
    targets,
    exact: new RegExp(`^${candidate}`),
    // `start` is only marked's fast-forward hint. Return the position after
    // the guard character so tokenizer sees the complete candidate.
    start: new RegExp("(?:^|[^\\w./~`@-])(?=" + candidate + ")"),
  };
  assetReferenceCache.set(key, registry);
  if (assetReferenceCache.size > 32) {
    const oldest = assetReferenceCache.keys().next().value;
    if (oldest !== undefined) assetReferenceCache.delete(oldest);
  }
  return registry;
}

/** The chip itself: file glyph plus already-rendered label HTML. */
function assetChip(sessionId: string, path: string, label: string): string {
  const href = sessionAssetRawUrl(sessionId, path);
  return (
    `<a href="${attr(href)}" class="asset-ref" data-asset-path="${attr(path)}"` +
    ` title="${attr(`Open ${path}`)}" target="_blank" rel="noopener noreferrer">` +
    `<span class="asset-ref-icon" aria-hidden="true">` +
    `<svg viewBox="0 0 24 24" fill="none"><path d="M7.75 19.25H16.25C17.3546 19.25 18.25 18.3546 18.25 17.25V9L14 4.75H7.75C6.64543 4.75 5.75 5.64543 5.75 6.75V17.25C5.75 18.3546 6.64543 19.25 7.75 19.25Z"/><path d="M18 9.25H13.75V5"/><path d="M9 12.5H15M9 15.5H13"/></svg>` +
    `</span><span class="asset-ref-label">${label}</span></a>`
  );
}

function assetReferenceLink(
  path: string,
  label: string,
  coded: boolean,
): string {
  if (!renderAssetSessionId)
    return coded ? `<code>${attr(label)}</code>` : attr(label);
  const text = coded ? `<code>${attr(label)}</code>` : attr(label);
  return assetChip(renderAssetSessionId, path, text);
}

function decodeUriComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The scratch file an explicit markdown link points at, if any. Agents name an
 * artifact both ways — bare in prose and as `[label](report.html)` — and only
 * the first was ever a chip, so the explicit form rendered as an ordinary link:
 * it looked like a web link and, being same-origin, navigated the app off the
 * session instead of opening the file over it.
 */
function assetLinkTarget(href: string | null | undefined): string | null {
  const registry = renderAssetReferences;
  if (!registry || !renderAssetSessionId || !href) return null;
  const raw = String(href).trim();
  if (!raw || raw.startsWith("#")) return null;
  // A relative href is written the way prose names the file, so it resolves
  // through the same alias table (`before.png` → `shots/before.png`).
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith("/")) {
    const name = decodeUriComponentSafe(
      raw.replace(/^\.\//, "").split(/[?#]/)[0],
    );
    return registry.targets.get(name) ?? null;
  }
  // Or the raw-file URL this renderer itself hands out, pasted back verbatim.
  let url: URL;
  try {
    url = new URL(
      raw,
      typeof location !== "undefined" ? location.href : "http://127.0.0.1:3850/",
    );
  } catch {
    return null;
  }
  const sameOrigin =
    typeof location !== "undefined" && url.origin === location.origin;
  if (!sameOrigin && !INTERNAL_HOSTS.has(url.hostname)) return null;
  const match = /\/api\/sessions\/([^/]+)\/assets\/raw\/(.+)$/.exec(url.pathname);
  if (!match) return null;
  // Another session's scratch folder is not this session's to open over.
  if (decodeUriComponentSafe(match[1]) !== renderAssetSessionId) return null;
  const path = match[2].split("/").map(decodeUriComponentSafe).join("/");
  return registry.targets.get(path) ?? null;
}

// Open Session session ids (`os-<uuidv7>`, and the pre-rename `bks-<uuidv7>` +
// legacy `bks-<slug>`), as they appear in agent output — usually in a codespan,
// e.g. a create_session result or an orchestrator saying "delegated to `os-…`".
// Rendered as a clickable link so you can jump from an orchestrator into the
// worker it spawned (and back). A container-level click handler (SessionViewer)
// navigates on data-session-id, since dangerouslySetInnerHTML can't carry React
// handlers.
const UUIDV7 = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// Every minted id is `<prefix>-<uuidv7>`; only the pre-rename `bks-` prefix also
// covers hand-made slug ids (`bks-ghpr-5099-review`), so it alone keeps the
// looser shape — `os-` is short enough that a loose form would turn ordinary
// codespans like `os-release` into session links.
const SESSION_ID_EXACT = new RegExp(
  `^(?:os-${UUIDV7}|bks-[a-z0-9][a-z0-9-]{5,})$`,
  "i",
);
// Bare (non-code) uuidv7-shaped ids in prose — strict so it can't misfire on
// ordinary text.
const SESSION_ID_BARE = new RegExp(`(?:os|bks)-${UUIDV7}`, "i");

// Chip labels. A raw `bks-<uuid>` is 40 characters of noise in the middle of a
// sentence, so a chip shows the referenced session's own title when we know it.
// The app shell registers the titles it already polls (App.tsx); anything not in
// that list — archived, deleted, not yet polled — falls back to a shortened id.
let sessionTitles = new Map<string, string>();
const SESSION_TITLE_MAX = 38;
const SESSION_ID_SHORT = 12; // `os-019fb3ad2` / `bks-019fb3ad`

/** Register id → title for session chips. Cheap no-op when nothing changed. */
export function setSessionTitles(
  entries: Iterable<readonly [string, string | null | undefined]>,
): void {
  const next = new Map<string, string>();
  for (const [id, title] of entries) {
    const t = String(title ?? "").trim();
    if (id && t) next.set(id, t);
  }
  if (next.size === sessionTitles.size) {
    let same = true;
    for (const [id, t] of next) {
      if (sessionTitles.get(id) !== t) {
        same = false;
        break;
      }
    }
    if (same) return; // the common case: a poll that only moved lastActivity
  }
  sessionTitles = next;
  // Labels are baked into the cached HTML, so it has to go when they change.
  mdCache.clear();
}

function shortSessionId(id: string): string {
  // Legacy `bks-<slug>` ids are already short and cutting them mid-word reads
  // worse than showing the whole thing; only uuid-shaped ids get abbreviated.
  // The trailing-dash trim keeps the cut off a segment boundary — the two
  // prefixes differ in length, so a fixed cut lands mid-separator for one.
  return id.length <= 20
    ? id
    : `${id.slice(0, SESSION_ID_SHORT).replace(/-+$/, "")}…`;
}

function sessionLink(id: string, href?: string): string {
  const title = sessionTitles.get(id);
  const label = title
    ? title.length > SESSION_TITLE_MAX
      ? `${title.slice(0, SESSION_TITLE_MAX - 1).trimEnd()}…`
      : title
    : shortSessionId(id);
  // The label is lossy either way (truncated title, abbreviated id), so the
  // full id always stays in the tooltip. data-session-label marks the id
  // fallback for the monospace treatment.
  const tip = title ? `Open ${title} (${id})` : `Open session ${id}`;
  // With an href it's a real link (cmd/middle-click open a tab); without one
  // the delegated click handler is the only way in, so it needs the button role
  // and a tab stop.
  const anchor = href
    ? `href="${attr(href)}" `
    : `role="button" tabindex="0" `;
  return (
    `<a ${anchor}class="session-link" data-session-id="${attr(id)}"` +
    `${title ? "" : ' data-session-label="id"'} title="${attr(tip)}">` +
    `${attr(label)}</a>`
  );
}

// Agents write pull requests the GitHub way — a bare `#5528`, sometimes
// qualified (`tella-fusion#5528`, `tellahq/tella-fusion#5528`) — and those
// references are the most-followed link in a transcript. They render as chips
// into OS1's OWN review surface (`/pr/<repo>/<number>`, which resolves to the
// PR's workspace Review tab), not to github.com: the review is here.
//
// A bare `#5528` says nothing about its repo, so it only links when the caller
// renders with one (`renderMarkdown(src, { repo })` — the session's repo in a
// transcript). A qualified mention carries its own, but only links when that
// name is a repo this instance actually has: `getRepo` throws on an unknown id
// server-side, and a chip pointing at a repo we can't resolve is worse than
// plain text.
const PR_NUMBER_MAX_DIGITS = 5;
// The qualifier is part of the match so it can be vetted (or rejected) rather
// than left dangling in front of a chip — that also means a word glued to the
// `#` can never be mistaken for a bare mention (`abc#1` is a qualified
// mention by `abc`, not PR #1). 6+ digit runs and `&#8212;`-style entities
// fall out of the pattern instead of needing their own guard.
const PR_MENTION_SRC =
  `((?:[A-Za-z0-9][\\w.-]*/)?[A-Za-z0-9][\\w.-]*)?` +
  `#(\\d{1,${PR_NUMBER_MAX_DIGITS}})(?!\\w)`;
const PR_MENTION_EXACT = new RegExp(`^${PR_MENTION_SRC}`);
// Where a mention may START in a run of text. The leading guard is only
// expressible here (a tokenizer is handed the source from the match position
// on, with no view of what precedes it), and marked cuts the text token at
// exactly the index this returns — so an unguarded `#` stays plain text.
const PR_MENTION_START = new RegExp(`(?:^|[^\\w#&/])(?=${PR_MENTION_SRC})`);

/**
 * The repos this instance serves, id → `owner/name` on GitHub. The ids decide
 * which qualified mentions can link at all; the GitHub names ride along on the
 * chip so a cmd/ctrl-click can leave for github.com (App.tsx) without a
 * second lookup at click time.
 */
let knownRepos = new Map<string, string | undefined>();

type PrStateInput = {
  repo?: string;
  number?: number;
  state?: "OPEN" | "MERGED" | "CLOSED";
  isDraft?: boolean;
};

type PrDisplayState = {
  label: "Open" | "Draft" | "Merged" | "Closed";
  tone: "open" | "draft" | "merged" | "closed";
};

let knownPrStates = new Map<string, PrDisplayState>();

function prStateKey(repo: string, number: string | number): string {
  return `${repo}\u0000${number}`;
}

function displayPrState(pr: PrStateInput): PrDisplayState | null {
  if (pr.state === "MERGED") return { label: "Merged", tone: "merged" };
  if (pr.state === "CLOSED") return { label: "Closed", tone: "closed" };
  if (pr.state === "OPEN" && pr.isDraft)
    return { label: "Draft", tone: "draft" };
  if (pr.state === "OPEN") return { label: "Open", tone: "open" };
  return null;
}

function prRefTitle(repo: string, number: string, state?: PrDisplayState): string {
  return `Open the review for ${repoLabel(repo)} #${number}${
    state ? ` · ${state.label}` : ""
  }`;
}

/** Keep already-rendered transcript chips in sync with the bulk PR cache. */
function syncRenderedPrStates(): void {
  if (typeof document === "undefined") return;
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>(
    "a.pr-ref[data-pr-repo][data-pr-number]",
  )) {
    const repo = anchor.dataset.prRepo;
    const number = anchor.dataset.prNumber;
    if (!repo || !number) continue;
    const state = knownPrStates.get(prStateKey(repo, number));
    let label = anchor.querySelector<HTMLElement>(".pr-ref-state");
    if (!state) {
      delete anchor.dataset.prState;
      label?.remove();
      anchor.title = prRefTitle(repo, number);
      continue;
    }
    anchor.dataset.prState = state.tone;
    if (!label) {
      label = document.createElement("span");
      label.className = "pr-ref-state";
      anchor.append(label);
    }
    label.textContent = state.label;
    anchor.title = prRefTitle(repo, number, state);
  }
}

/** Register live PR state from the session list for transcript references. */
export function setKnownPrStates(prs: Iterable<PrStateInput>): void {
  const next = new Map<string, PrDisplayState>();
  for (const pr of prs) {
    if (!pr.repo || !pr.number) continue;
    const state = displayPrState(pr);
    const key = prStateKey(pr.repo, pr.number);
    if (state && !next.has(key)) next.set(key, state);
  }
  if (
    next.size === knownPrStates.size &&
    [...next].every(
      ([key, state]) =>
        knownPrStates.get(key)?.label === state.label &&
        knownPrStates.get(key)?.tone === state.tone,
    )
  )
    return;
  knownPrStates = next;
  mdCache.clear();
  syncRenderedPrStates();
}

/** Register the repos, so `<repo>#123` mentions link and chips know GitHub. */
export function setKnownRepos(
  repos: Iterable<{ id: string; ghRepo?: string }>,
): void {
  const next = new Map<string, string | undefined>();
  for (const repo of repos) if (repo.id) next.set(repo.id, repo.ghRepo);
  if (
    next.size === knownRepos.size &&
    [...next].every(([id, gh]) => knownRepos.has(id) && knownRepos.get(id) === gh)
  )
    return;
  knownRepos = next;
  mdCache.clear(); // repo ids are baked into the cached HTML
}

/**
 * The repo a bare `#5528` belongs to, for the duration of one `md.parse()`.
 * Parsing is synchronous (`async: false`), so a module variable is the whole
 * mechanism a renderer needs to see its caller's context.
 */
let renderRepo: string | undefined;

/** The repo a mention points at, or null when it can't be placed. */
function prMentionRepo(qualifier: string | undefined): string | null {
  if (!qualifier) return renderRepo ?? null;
  // `owner/repo` and a bare `repo` both identify the repo by its last segment:
  // ids are instance-local, and the owner is noise we already know.
  const id = qualifier.slice(qualifier.lastIndexOf("/") + 1);
  return knownRepos.has(id) ? id : null;
}

function prMentionLink(repo: string, number: string, label: string): string {
  const href = `${BASE_PATH}/pr/${encodeURIComponent(repo)}/${number}`;
  // `data-pr-gh` is the escape hatch, not the destination: a plain click
  // stays in the review here, cmd/ctrl-click leaves for github.com.
  const ghRepo = knownRepos.get(repo);
  const state = knownPrStates.get(prStateKey(repo, number));
  return (
    `<a href="${attr(href)}" class="pr-ref" data-pr-repo="${attr(repo)}"` +
    ` data-pr-number="${attr(number)}"` +
    (ghRepo ? ` data-pr-gh="${attr(ghRepo)}"` : "") +
    (state ? ` data-pr-state="${state.tone}"` : "") +
    ` title="${attr(prRefTitle(repo, number, state))}">` +
    `<span class="pr-ref-icon" aria-hidden="true">` +
    `<svg viewBox="0 0 24 24" fill="none">` +
    `<circle cx="7" cy="6.5" r="1.75"/><circle cx="7" cy="17.5" r="1.75"/>` +
    `<circle cx="17" cy="17.5" r="1.75"/><path d="M7 8.25V15.75"/>` +
    `<path d="M12.25 6.5H15C16.1046 6.5 17 7.39543 17 8.5V15.75"/>` +
    `</svg></span><span class="pr-ref-label">${attr(label)}</span>` +
    (state ? `<span class="pr-ref-state">${state.label}</span>` : "") +
    `</a>`
  );
}

/** A GitHub PR page that belongs to a repo this instance serves. */
function githubPrTarget(
  href: string | null | undefined,
): { repo: string; number: string } | null {
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(String(href));
  } catch {
    return null;
  }
  if (
    !["github.com", "www.github.com"].includes(url.hostname.toLowerCase()) ||
    url.search ||
    url.hash
  )
    return null;
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d{1,5})\/?$/.exec(url.pathname);
  if (!match) return null;
  const githubRepo = `${match[1]}/${match[2]}`.toLowerCase();
  for (const [repo, configuredGithubRepo] of knownRepos) {
    if (configuredGithubRepo?.toLowerCase() === githubRepo)
      return { repo, number: match[3] };
  }
  return null;
}

// Links into OS1 itself must not open a new window — it's the same app. Known
// public hosts cover links pasted as absolute URLs viewed from another origin
// (e.g. the ts.net entry); same-origin covers everything else, prefix included
// (stripBasePath-style legacy /opensession + /backstage forms).
const INTERNAL_HOSTS = new Set(
  [
    typeof location === "undefined" ? "" : location.hostname,
    (() => {
      try {
        return new URL(PUBLIC_BASE_URL).hostname;
      } catch {
        return "";
      }
    })(),
  ].filter(Boolean),
);

/**
 * Turn chip tokens back into the literal text they were written as, in place.
 * Only used inside an explicit link, where a chip would nest an anchor; the
 * raw text of all chip kinds is plain (ids, digits, `#`, `/`, `.`, `-`), so
 * it needs no escaping the text renderer wouldn't already skip.
 */
function flattenChips(tokens: any[] | undefined): void {
  for (const token of tokens ?? []) {
    if (token.type === "assetPath") {
      token.type = token.coded ? "codespan" : "text";
      token.text = token.label;
      token.raw = token.coded ? `\`${token.label}\`` : token.label;
      token.tokens = undefined;
    } else if (token.type === "prMention" || token.type === "sessionId") {
      token.type = "text";
      token.text = token.raw;
      token.tokens = undefined;
    } else if (Array.isArray(token.tokens)) flattenChips(token.tokens);
  }
}

// An auto-linked (or <bracketed>) bare URL: marked hands the raw URL over as
// the link text. Trailing-slash tolerant so `…/session/bks-x/` still counts.
function isBareUrlLink(token: any): boolean {
  const strip = (v: string) => String(v ?? "").replace(/\/+$/, "");
  const text = strip(token.text);
  return text.length > 0 && text === strip(token.href);
}

function internalHref(href: string | null | undefined): {
  sessionId?: string;
} | null {
  if (!href) return null;
  const loc =
    typeof location !== "undefined" ? location.href : "http://127.0.0.1:3850/";
  let url: URL;
  try {
    url = new URL(String(href), loc);
  } catch {
    return null;
  }
  const sameOrigin =
    typeof location !== "undefined" && url.origin === location.origin;
  if (!sameOrigin && !INTERNAL_HOSTS.has(url.hostname)) return null;
  const path = url.pathname.replace(/^\/(?:opensession|backstage)(?=\/)/, "");
  // The path already says "session", so both prefixes take the loose shape here.
  const m =
    path.match(/^\/session\/((?:os|bks)-[a-z0-9][a-z0-9-]{5,})\/?$/i) ??
    path.match(
      /^\/workspace\/[^/]+\/session\/((?:os|bks)-[a-z0-9][a-z0-9-]{5,})\/?$/i,
    );
  return { sessionId: m ? decodeURIComponent(m[1]) : undefined };
}

md.use({
  tokenizer: {
    // Strikethrough requires DOUBLE tildes (~~text~~). GFM also accepts a
    // single ~, but session content is full of bare tildes that are NOT
    // strikethrough — ReScript labeled args (`foo(~storyID=…, ~error)`),
    // approximate numbers (`~350 files`), home paths (`~/.config`) — and two of
    // them on a line struck everything between. Returning undefined on a
    // single tilde lets marked fall through to plain text.
    del(this: any, src: string) {
      const m = /^~~(?=\S)([\s\S]*?\S)~~/.exec(src);
      if (!m) return undefined;
      return {
        type: "del",
        raw: m[0],
        text: m[1],
        tokens: this.lexer.inlineTokens(m[1]),
      };
    },
  },
  renderer: {
    // Session content is untrusted (assistant output, tool results, pasted
    // text). marked passes raw HTML through verbatim by default, and we inject
    // the result with dangerouslySetInnerHTML — so an embedded <script> or
    // <img onerror=…> would execute. Escape every raw-HTML token (this method
    // handles both block- and inline-level HTML) so it renders as literal text.
    // All the formatting we actually want (links, images, code) is generated by
    // marked from markdown syntax, not from raw tags, so nothing is lost.
    html(token: any) {
      return attr(token.text ?? token.raw ?? "");
    },
    link(token: any) {
      // `[PR #5528](https://github.com/…)` is everyday agent output, and the
      // chip extensions fire inside a link's own text just as they do in
      // prose — which would nest an <a> inside an <a>, markup the HTML parser
      // silently tears apart. The explicit link wins: inside it, chips degrade
      // back to the text they were written as.
      flattenChips(token.tokens);
      const githubPr = githubPrTarget(token.href);
      if (githubPr) {
        const label = isBareUrlLink(token)
          ? `PR #${githubPr.number}`
          : String(token.text || `PR #${githubPr.number}`);
        return prMentionLink(githubPr.repo, githubPr.number, label);
      }
      const text = this.parser.parseInline(token.tokens);
      // A link to one of this session's scratch files is an asset, however it
      // was written: same chip, same overlay, so the two forms are one thing.
      const asset = assetLinkTarget(token.href);
      if (asset && renderAssetSessionId)
        return assetChip(renderAssetSessionId, asset, text);
      const title = token.title ? ` title="${attr(token.title)}"` : "";
      const internal = internalHref(token.href);
      if (internal) {
        // A pasted session URL auto-links with the whole ~90-char URL as
        // its text, which ran straight past the message bubble's edge inside
        // the nowrap chip. Label it like a bare `bks-…` in prose instead.
        if (internal.sessionId && isBareUrlLink(token)) {
          return sessionLink(internal.sessionId, token.href);
        }
        // Same app: navigate in place. Session URLs get the session-link
        // chip + data-session-id so the delegated handler (SessionViewer)
        // navigates client-side; href stays for middle/cmd-click and for
        // surfaces without the handler (full-page load, same tab).
        const chip = internal.sessionId
          ? ` class="session-link" data-session-id="${attr(internal.sessionId)}"`
          : "";
        return `<a href="${attr(token.href)}"${title}${chip}>${text}</a>`;
      }
      return `<a href="${attr(token.href)}"${title} target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
    codespan(token: any) {
      const t = token.text ?? "";
      // A codespan that is exactly a session id becomes a link into that session.
      if (SESSION_ID_EXACT.test(t)) return sessionLink(t);
      return `<code>${attr(t)}</code>`;
    },
    image(token: any) {
      const title = token.title ? ` title="${attr(token.title)}"` : "";
      // Video files pasted with image syntax would render as a broken <img>
      // linking to a new tab — play them inline instead. Clicks on .md-image
      // open the media lightbox (delegated handler in MediaLightbox.tsx); the
      // wrapping <a> stays for cmd/middle-click open-in-tab.
      if (/\.(mp4|webm|mov|m4v)([?#]|$)/i.test(token.href ?? "")) {
        return `<video class="md-video" src="${attr(token.href)}"${title} controls playsinline preload="metadata"></video>`;
      }
      return (
        `<a href="${attr(token.href)}" target="_blank" rel="noopener noreferrer" class="md-image-link">` +
        `<img class="md-image" src="${attr(token.href)}" alt="${attr(token.text)}"${title} loading="lazy" />` +
        `</a>`
      );
    },
  },
  // Bare session ids in prose (not wrapped in backticks) also link. Strict
  // uuidv7 shape so it only fires on real ids.
  extensions: [
    {
      name: "assetPath",
      level: "inline",
      start(src: string) {
        const match = renderAssetReferences?.start.exec(src);
        return match ? match.index + match[0].length : undefined;
      },
      tokenizer(src: string) {
        const registry = renderAssetReferences;
        const match = registry?.exact.exec(src);
        if (!registry || !match) return undefined;
        const label = match[1] ?? match[2];
        const path = registry.targets.get(label);
        if (!path) return undefined;
        return {
          type: "assetPath",
          raw: match[0],
          label,
          path,
          coded: match[1] !== undefined,
        };
      },
      renderer(token: any) {
        return assetReferenceLink(token.path, token.label, token.coded);
      },
    },
    {
      name: "sessionId",
      level: "inline",
      start(src: string) {
        const m = SESSION_ID_BARE.exec(src);
        return m ? m.index : undefined;
      },
      tokenizer(src: string) {
        const m = new RegExp(`^(?:os|bks)-${UUIDV7}`, "i").exec(src);
        if (m) return { type: "sessionId", raw: m[0], id: m[0] };
      },
      renderer(token: any) {
        return sessionLink(token.id);
      },
    },
    {
      name: "prMention",
      level: "inline",
      start(src: string) {
        const m = PR_MENTION_START.exec(src);
        // `start` reports where the mention itself begins, not the guard char
        // in front of it — a text token cut one character early would swallow
        // that character into this token's slot.
        return m ? m.index + m[0].length : undefined;
      },
      tokenizer(src: string) {
        const m = PR_MENTION_EXACT.exec(src);
        if (!m) return undefined;
        const repo = prMentionRepo(m[1]);
        // Nowhere to point: emit the mention as the text it is. Declining the
        // match instead would hand `vercel/next.js#1234` back to the text
        // tokenizer, which walks forward a character at a time until the
        // rejected qualifier is behind it and `#1234` reads as a BARE mention —
        // linking a third party's PR number into one of our own repos.
        if (!repo) return { type: "text", raw: m[0], text: m[0] };
        return { type: "prMention", raw: m[0], repo, number: m[2] };
      },
      renderer(token: any) {
        return prMentionLink(token.repo, token.number, token.raw);
      },
    },
  ],
});

// Rendered-HTML cache: every session open/switch re-renders all visible
// bubbles, and marked is the dominant cost of showing a transcript
// (superlinear on input size). Keyed by the source string, LRU-bounded, and
// only for small-to-medium inputs so a day of big transcripts can't pin
// unbounded HTML in memory (callers clamp giant contents before rendering).
const mdCache = new Map<string, string>();
const MD_CACHE_MAX = 500;
const MD_CACHE_INPUT_MAX = 32 * 1024;

export interface MarkdownContext {
  /**
   * The repo a bare `#5528` refers to — the session's repo in a transcript,
   * the PR's repo on a review surface. Without it those mentions stay plain
   * text rather than guessing a destination.
   */
  repo?: string;
  /** Session whose prose this is, used to build safe raw-file fallbacks for
   * asset links when the transcript's delegated preview handler is absent. */
  sessionId?: string;
  /** Files that currently exist in this session's scratch folder. Only these
   * names become links; file-looking prose is otherwise left untouched. */
  assetPaths?: readonly string[];
}

/** Render session markdown to HTML (links open in a new tab, images inline). */
export function renderMarkdown(src: string, ctx?: MarkdownContext): string {
  const cacheable = src.length <= MD_CACHE_INPUT_MAX;
  const assets = assetReferenceRegistry(ctx?.assetPaths);
  // Same source, different repo/session/assets, different links. Null bytes
  // cannot occur in a repo id, session id or filesystem path.
  const contextKey = [ctx?.repo ?? "", ctx?.sessionId ?? "", assets?.key ?? ""].join(
    "\u0000",
  );
  const cacheKey = contextKey === "\u0000\u0000" ? src : `${contextKey}\u0000${src}`;
  if (cacheable) {
    const hit = mdCache.get(cacheKey);
    if (hit !== undefined) {
      // Refresh LRU position
      mdCache.delete(cacheKey);
      mdCache.set(cacheKey, hit);
      return hit;
    }
  }
  let out: string;
  const previousRepo = renderRepo;
  const previousAssets = renderAssetReferences;
  const previousAssetSessionId = renderAssetSessionId;
  renderRepo = ctx?.repo;
  renderAssetReferences = assets;
  renderAssetSessionId = ctx?.sessionId;
  try {
    out = md.parse(src) as string;
  } catch {
    out = src;
  } finally {
    renderRepo = previousRepo;
    renderAssetReferences = previousAssets;
    renderAssetSessionId = previousAssetSessionId;
  }
  if (cacheable) {
    mdCache.set(cacheKey, out);
    if (mdCache.size > MD_CACHE_MAX) {
      const oldest = mdCache.keys().next().value;
      if (oldest !== undefined) mdCache.delete(oldest);
    }
  }
  return out;
}

function withoutSingleParagraph(html: string): string {
  const trimmed = html.trim();
  const match = /^<p>([\s\S]*)<\/p>$/.exec(trimmed);
  return match ? match[1] : trimmed;
}

function renderPrMarkdownWithSub(src: string, ctx?: MarkdownContext): string {
  const subs: string[] = [];
  const prepared = src.replace(/<sub>([\s\S]*?)<\/sub>/gi, (_match, content) => {
    const token = `OPENSESSIONSUBTOKEN${subs.length}END`;
    subs.push(content);
    return token;
  });
  let html = renderMarkdown(prepared, ctx);
  subs.forEach((content, index) => {
    const token = `OPENSESSIONSUBTOKEN${index}END`;
    html = html.replaceAll(
      token,
      `<sub>${withoutSingleParagraph(renderMarkdown(content, ctx))}</sub>`,
    );
  });
  return html;
}

/**
 * Render GitHub PR prose while preserving its common collapsible-review markup.
 * The whitelist is deliberately exact and attribute-free; all other HTML still
 * goes through renderMarkdown's escaping renderer.
 */
export function renderPrCommentMarkdown(
  src: string,
  ctx?: MarkdownContext,
): string {
  const details: Array<{ summary: string; body: string }> = [];
  const prepared = src.replace(
    /<details>\s*<summary>([\s\S]*?)<\/summary>\s*([\s\S]*?)<\/details>/gi,
    (_match, summary, body) => {
      const token = `OPENSESSIONDETAILSTOKEN${details.length}END`;
      details.push({ summary, body });
      return `\n\n${token}\n\n`;
    },
  );
  let html = renderPrMarkdownWithSub(prepared, ctx);
  details.forEach(({ summary, body }, index) => {
    const token = `OPENSESSIONDETAILSTOKEN${index}END`;
    const rendered =
      `<details class="md-details">` +
      `<summary>${withoutSingleParagraph(renderPrMarkdownWithSub(summary, ctx))}</summary>` +
      `<div class="md-details-body">${renderPrMarkdownWithSub(body, ctx)}</div>` +
      `</details>`;
    html = html
      .replace(`<p>${token}</p>`, rendered)
      .replace(token, rendered);
  });
  return html;
}
