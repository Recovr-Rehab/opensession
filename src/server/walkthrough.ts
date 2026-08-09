/**
 * Session walkthroughs — the Cursor-cloud-agents-style PR walkthrough: a demo
 * video, before/after screenshots, and a writeup the agent publishes when it
 * finishes a user-visible change (via opensession-walkthrough's
 * publish_walkthrough tool).
 *
 * Media the agent recorded lives in its worktree or /tmp, both of which are
 * pruned, so publishing STAGES copies under the composer-uploads dir
 * (~/.opensession-sessions/uploads/walkthrough/<sessionId>/) — under the home
 * dir, so the existing /media route streams them to the session and
 * the Review tab with no new endpoint.
 *
 * The walkthrough is also mirrored into the GitHub PR description as a
 * marker-delimited managed section (re-publish replaces it, human edits around
 * it survive). The media itself is linked, not inlined: os.tella.dev is
 * tailnet-only, so GitHub's camo proxy can never fetch it, and our only public
 * channels are banned for screenshots (PII rule). Links open fine for the
 * whole team (everyone is on the tailnet).
 */

import { existsSync, mkdirSync, copyFileSync } from "fs";
import { basename } from "path";
import type {
  SessionWalkthrough,
  UnifiedSession,
  WalkthroughShot,
} from "./types";
import { UPLOADS_DIR } from "./uploads";
import { findSession, touchNativeSession } from "./session-cache";
import { transcriptStore } from "./transcript-store";
import { resolvePrTarget } from "./session-repos";
import { prHostFor } from "./pr-host";
import { getRepo } from "./worktree";
import { configuredServer } from "./config";

const VIDEO_EXTS = new Set([".mp4", ".webm", ".mov"]);
const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

const START_MARKER = "<!-- opensession:walkthrough -->";
const END_MARKER = "<!-- /opensession:walkthrough -->";
const HOME = process.env.HOME || "";

export interface WalkthroughInput {
  summary: string;
  video?: string;
  videoTitle?: string;
  shots?: WalkthroughShot[];
}

function ext(p: string): string {
  return p.slice(p.lastIndexOf(".")).toLowerCase();
}

/** Same path scoping as the /media route: absolute, no traversal,
 *  under /tmp or the service user's home — the places agents can write. */
function readablePath(p: string): boolean {
  return (
    p.startsWith("/") &&
    !p.includes("..") &&
    (p.startsWith("/tmp/") || (!!HOME && p.startsWith(`${HOME}/`)))
  );
}

/** Copy one media file into the session's walkthrough dir; returns the staged
 *  absolute path. Throws with an agent-actionable message on a bad path. */
function stageMedia(
  sessionId: string,
  path: string,
  kind: "video" | "image",
): string {
  const p = (path || "").trim();
  const allowed = kind === "video" ? VIDEO_EXTS : IMAGE_EXTS;
  if (!readablePath(p))
    throw new Error(
      `${kind} path must be absolute under /tmp or ${HOME || "the service home"}: ${p}`,
    );
  if (!allowed.has(ext(p)))
    throw new Error(
      `${kind} must be one of ${[...allowed].join(" ")}: ${p}`,
    );
  if (!existsSync(p)) throw new Error(`${kind} file not found: ${p}`);
  const dir = `${UPLOADS_DIR}/walkthrough/${sessionId}`;
  mkdirSync(dir, { recursive: true });
  const name = basename(p).replace(/[^\w. -]/g, "_");
  let target = `${dir}/${name}`;
  if (existsSync(target) && target !== p) {
    const dot = name.lastIndexOf(".");
    target = `${dir}/${name.slice(0, dot)}-${Date.now().toString(36)}${name.slice(dot)}`;
  }
  if (target !== p) copyFileSync(p, target);
  return target;
}

/**
 * Validate + stage the media, persist the walkthrough on the session file, and
 * mirror it into the PR description when the session already has an open PR.
 * Returns what happened on the PR side so the tool can tell the agent to
 * re-publish (or that it's done).
 */
/**
 * The `publish_walkthrough` tool call currently running — the entry the card
 * should hang off.
 *
 * We look it up here, once, because this is the only moment anything KNOWS
 * where the walkthrough belongs: the viewer used to re-derive it by scanning
 * the loaded transcript backwards for the same tool call, with a timestamp
 * fallback for when that call had been trimmed out of the window.
 *
 * A miss is fine — an engine whose transcript the v2 store never saw, or a
 * call the store hasn't flushed yet — and leaves the viewer's fallback in
 * charge, exactly as before.
 */
function publishingEntryId(sessionId: string): string | undefined {
  try {
    const { entries } = transcriptStore().readTail(sessionId, 60);
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (
        e.type === "tool_use" &&
        /(^|_)publish_walkthrough$/.test(e.toolName || "")
      )
        return e.id;
    }
  } catch {
    // Store read failed — the viewer still places the card by timestamp.
  }
  return undefined;
}

export async function publishWalkthrough(
  sessionId: string,
  input: WalkthroughInput,
  by?: string,
): Promise<{
  walkthrough: SessionWalkthrough;
  pr: { mirrored: boolean; url?: string; reason?: string };
}> {
  const summary = (input.summary || "").trim();
  if (!summary) throw new Error("summary is required");
  const publishedEntryId = publishingEntryId(sessionId);
  const walkthrough: SessionWalkthrough = {
    summary,
    publishedAt: new Date().toISOString(),
    ...(by ? { publishedBy: by } : {}),
    ...(publishedEntryId ? { publishedEntryId } : {}),
  };
  if (input.video) {
    walkthrough.video = stageMedia(sessionId, input.video, "video");
    if (input.videoTitle?.trim()) walkthrough.videoTitle = input.videoTitle.trim();
  }
  const shots: WalkthroughShot[] = [];
  for (const s of input.shots || []) {
    const shot: WalkthroughShot = {};
    if (s.before) shot.before = stageMedia(sessionId, s.before, "image");
    if (s.after) shot.after = stageMedia(sessionId, s.after, "image");
    if (s.caption?.trim()) shot.caption = s.caption.trim();
    if (shot.before || shot.after) shots.push(shot);
  }
  if (shots.length) walkthrough.shots = shots;

  touchNativeSession(sessionId, { walkthrough });
  // Pass the walkthrough we just built: the unified-session re-read must not
  // be the thing that decides whether it exists (slack/linear sessions only
  // surface sidecar fields via the overlay in sessions.ts — belt and braces).
  const pr = await mirrorWalkthroughToPr(sessionId, walkthrough);
  return { walkthrough, pr };
}

/** Absolute, auth-free-to-build media URL (the media route itself is behind
 *  the tailnet, like the whole UI). */
function mediaUrl(path: string): string {
  return `${configuredServer().publicBaseUrl}/media?path=${encodeURIComponent(path)}`;
}

/** The marker-delimited markdown section spliced into the PR body. */
function walkthroughPrSection(w: SessionWalkthrough): string {
  const lines: string[] = ["## Walkthrough", ""];
  if (w.video) {
    const title = w.videoTitle || "Demo video";
    lines.push(`▶ **[${title}](${mediaUrl(w.video)})**`, "");
  }
  lines.push(w.summary.trim(), "");
  if (w.shots?.length) {
    lines.push("| Before | After |", "| --- | --- |");
    for (const s of w.shots) {
      const before = s.before ? `[Before${s.caption ? ` — ${s.caption}` : ""}](${mediaUrl(s.before)})` : "—";
      const after = s.after ? `[After${s.caption ? ` — ${s.caption}` : ""}](${mediaUrl(s.after)})` : "—";
      lines.push(`| ${before} | ${after} |`);
    }
    lines.push("");
  }
  lines.push(
    `<sub>Media links open on ${configuredServer().publicBaseUrl}. Published from the session's Review tab, where they play inline.</sub>`,
  );
  return lines.join("\n");
}

/** Replace an existing managed section, else insert above the "Started by …"
 *  attribution footer, else append. */
function spliceWalkthroughSection(body: string, section: string): string {
  const block = `${START_MARKER}\n${section}\n${END_MARKER}`;
  const start = body.indexOf(START_MARKER);
  const end = body.indexOf(END_MARKER);
  if (start !== -1 && end !== -1 && end > start) {
    return (
      body.slice(0, start) + block + body.slice(end + END_MARKER.length)
    );
  }
  const footer = body.match(/\n*(Started by|Created by) .*\[this [^\]]* session\]\([^)]*\)[^\n]*\s*$/);
  if (footer && typeof footer.index === "number") {
    return `${body.slice(0, footer.index).trimEnd()}\n\n${block}\n${body.slice(footer.index).trimStart() ? "\n" + body.slice(footer.index).trim() : ""}`;
  }
  return `${body.trimEnd()}\n\n${block}`.trimStart();
}

/**
 * Mirror the session's walkthrough into its primary PR's description. No open
 * PR yet is a normal outcome (the agent usually publishes before `gh pr
 * create`) — the caller tells the agent to re-publish after opening it.
 */
async function mirrorWalkthroughToPr(
  sessionId: string,
  /** Freshly-built walkthrough from publishWalkthrough — wins over the
   *  unified-session re-read so a persistence/scan gap can't lose it. */
  fresh?: SessionWalkthrough,
): Promise<{ mirrored: boolean; url?: string; reason?: string }> {
  const session: UnifiedSession | undefined = findSession(sessionId);
  if (!session) return { mirrored: false, reason: "session not found" };
  const walkthrough = fresh ?? session.walkthrough;
  if (!walkthrough)
    return { mirrored: false, reason: "no walkthrough on session" };
  const target = resolvePrTarget(session, null, null);
  if (!target) return { mirrored: false, reason: "session has no branch" };
  const repo = getRepo(target.repoId);
  // code.storage has no PR description to splice a walkthrough into
  // (updatePrBody is unsupported there) — no-op cleanly instead of handing
  // gh a code.storage repo id, which would read (and could write to) an
  // unrelated github.com/<csRepoId>.
  if (repo.host === "codestorage") {
    console.debug(
      `[walkthrough] ${sessionId}: skipping PR mirror — code.storage branches have no PR description`,
    );
    return { mirrored: false, reason: "code.storage changes have no PR description to mirror into" };
  }
  const host = prHostFor(repo);
  const details = await host.getPrDetails(target.branch, target.ghRepo);
  if (!details || details.state !== "OPEN")
    return { mirrored: false, reason: "no open PR for the session's branch" };
  const section = walkthroughPrSection(walkthrough);
  const result = await host.updatePrBody(
    target.branch,
    (body) => spliceWalkthroughSection(body, section),
    target.ghRepo,
  );
  if ("error" in result) return { mirrored: false, reason: result.error };
  return { mirrored: true, url: result.url };
}
