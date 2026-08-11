/**
 * Share visual changes in Slack once their PR merges. A walkthrough's durable
 * `after` screenshot is both the visual-change signal and the attachment, so
 * this path needs no model classification and never posts text-only noise.
 */
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, relative, resolve } from "path";
import { createHash } from "crypto";
import { personaName } from "../../server/config";
import { sessionRefFromPrBody } from "../../server/pr-cache";
import {
  tryGetSessionControl,
  type SessionControl,
  type SessionSummary,
} from "../../server/session-control";
import { audit } from "../../server/audit";
import { stateDir } from "../../server/paths";
import { writeJsonAtomic } from "../../server/shared/atomic-write";
import { UPLOADS_DIR } from "../../server/uploads";
import { postSlackFile } from "../slack/slack-api";
import { shippedChangesChannel } from "./constants";
import { matchSessions, workspaceIdForRepo } from "./session-notify";

export interface ShippedVisualChange {
  sessionId: string;
  screenshot: string;
  summary: string;
}

const ANNOUNCEMENT_STATE_ROOT = `${stateDir("github")}/shipped-visual-changes`;
const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024;
const SCREENSHOT_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

interface AnnouncementReceipt {
  status: "pending" | "sent";
  claimId: string;
  at: string;
  sessionId?: string;
}

function announcementReceiptPath(key: string, root: string): string {
  const digest = createHash("sha256").update(key).digest("hex");
  return `${root}/${digest}.json`;
}

function readAnnouncementReceipt(path: string): AnnouncementReceipt | null {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

export function claimShippedChangeAnnouncement(
  key: string,
  root = ANNOUNCEMENT_STATE_ROOT,
  now = Date.now(),
): string | null {
  const claimId = crypto.randomUUID();
  const receiptPath = announcementReceiptPath(key, root);
  mkdirSync(dirname(receiptPath), { recursive: true });
  try {
    writeFileSync(
      receiptPath,
      JSON.stringify({ status: "pending", claimId, at: new Date(now).toISOString() }),
      { flag: "wx" },
    );
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
    // Fail closed after a process crash rather than risk posting the same merge
    // twice. Ordinary upload failures remove their receipt in settle().
    return null;
  }
  return claimId;
}

export function settleShippedChangeAnnouncement(
  key: string,
  claimId: string,
  sent: boolean,
  sessionId?: string,
  root = ANNOUNCEMENT_STATE_ROOT,
): void {
  const receiptPath = announcementReceiptPath(key, root);
  const receipt = readAnnouncementReceipt(receiptPath);
  if (receipt?.claimId !== claimId) return;
  if (sent) {
    writeJsonAtomic(receiptPath, {
      status: "sent",
      claimId,
      at: new Date().toISOString(),
      sessionId,
    });
  } else {
    rmSync(receiptPath, { force: true });
  }
}

export function validWalkthroughScreenshot(
  path: string,
  sessionId: string,
  uploadsRoot = UPLOADS_DIR,
): boolean {
  try {
    const root = realpathSync(resolve(uploadsRoot, "walkthrough", sessionId));
    const candidate = realpathSync(path);
    const within = relative(root, candidate);
    if (within.startsWith("..") || resolve(root, within) !== candidate) return false;
    const dot = candidate.lastIndexOf(".");
    if (dot < 0 || !SCREENSHOT_EXTS.has(candidate.slice(dot).toLowerCase())) return false;
    const stat = statSync(candidate);
    return stat.isFile() && stat.size > 0 && stat.size <= MAX_SCREENSHOT_BYTES;
  } catch {
    return false;
  }
}

/** Prefer the PR-attributed session, then the newest branch match with proof. */
export function selectShippedVisualChange(
  sessions: SessionSummary[],
  preferredSessionId?: string,
  fileExists: (path: string, sessionId: string) => boolean = validWalkthroughScreenshot,
): ShippedVisualChange | null {
  const ordered = [...sessions].sort((a, b) => {
    if (a.id === preferredSessionId) return -1;
    if (b.id === preferredSessionId) return 1;
    const bTime = Date.parse(b.walkthrough?.publishedAt || "") || 0;
    const aTime = Date.parse(a.walkthrough?.publishedAt || "") || 0;
    return bTime - aTime;
  });
  for (const session of ordered) {
    const screenshot = session.walkthrough?.shots?.find((shot) => shot.after)?.after;
    if (!screenshot || !fileExists(screenshot, session.id)) continue;
    return {
      sessionId: session.id,
      screenshot,
      summary: session.walkthrough!.summary,
    };
  }
  return null;
}

/** Collapse the walkthrough's first prose paragraph into Slack-sized copy. */
export function shippedChangeOneLiner(markdown: string, max = 280): string {
  const paragraphs = markdown
    .split(/\n\s*\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const prose =
    paragraphs.find((part) => !/^#{1,6}\s/.test(part) && !/^[-*]\s*$/.test(part)) || "";
  const plain = prose
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:#{1,6}|[-*+])\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (plain.length <= max) return plain;
  const clipped = plain.slice(0, max - 1);
  const wordBoundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, wordBoundary > max * 0.7 ? wordBoundary : undefined).trimEnd()}…`;
}

function slackText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function candidateSessions(
  control: SessionControl,
  workspaceId: string,
  headRef: string,
  preferredSessionId?: string,
): SessionSummary[] {
  if (!preferredSessionId) return [];
  const matches = matchSessions(control, workspaceId, headRef);
  const preferred = matches.find((session) => session.id === preferredSessionId);
  return preferred ? [preferred] : [];
}

/** `pull_request` webhook payload with action=closed & merged=true. */
export async function announceShippedVisualChange(payload: any): Promise<void> {
  const channel = shippedChangesChannel();
  if (!channel) return;
  const pr = payload?.pull_request;
  const repoFullName: string = payload?.repository?.full_name || "";
  const workspaceId = workspaceIdForRepo(repoFullName);
  const headRef: string = pr?.head?.ref || "";
  const control = tryGetSessionControl();
  if (!pr || !workspaceId || !headRef || !control) return;

  const preferredSessionId = sessionRefFromPrBody(pr.body);
  const visual = selectShippedVisualChange(
    candidateSessions(control, workspaceId, headRef, preferredSessionId),
    preferredSessionId,
  );
  if (!visual) return;

  const prNumber: number = pr.number;
  const title = String(pr.title || `PR #${prNumber}`).replace(/\|/g, "¦");
  const url = pr.html_url || `https://github.com/${repoFullName}/pull/${prNumber}`;
  const reason = shippedChangeOneLiner(visual.summary);
  if (!reason) return;
  const comment = `*${slackText(personaName())} shipped <${url}|${slackText(title)}>*\n${slackText(reason)}`;
  const announcementKey = `${repoFullName}#${prNumber}@${pr.merge_commit_sha || pr.merged_at || "merged"}`;
  const claimId = claimShippedChangeAnnouncement(announcementKey);
  if (!claimId) return;
  try {
    await postSlackFile(channel, visual.screenshot, comment, {
      title: `${title} — shipped`,
      altText: `Screenshot of the shipped visual change: ${title}`,
    });
    settleShippedChangeAnnouncement(
      announcementKey,
      claimId,
      true,
      visual.sessionId,
    );
  } catch (error) {
    settleShippedChangeAnnouncement(announcementKey, claimId, false);
    throw error;
  }
  audit({
    msg: "github_shipped_visual_change_announced",
    repo: repoFullName,
    pr_number: prNumber,
    session_id: visual.sessionId,
    slack_channel: channel,
  });
  console.log(
    `[github] Shared merged visual change ${repoFullName}#${prNumber} in Slack from ${visual.sessionId}`,
  );
}
