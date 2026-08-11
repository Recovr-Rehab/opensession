/**
 * Deliberately share a merged visual change in Slack. A walkthrough's durable
 * `after` screenshot is both the visual-change signal and the attachment; the
 * route calls this only after a teammate clicks Share to Slack.
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
import { audit } from "../../server/audit";
import { stateDir } from "../../server/paths";
import { writeJsonAtomic } from "../../server/shared/atomic-write";
import { UPLOADS_DIR } from "../../server/uploads";
import type { UnifiedSession } from "../../server/types";
import { postSlackFile } from "../slack/slack-api";
import { shippedChangesChannel } from "./constants";

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

export function selectShippedVisualChange(
  session: UnifiedSession,
  fileExists: (path: string, sessionId: string) => boolean = validWalkthroughScreenshot,
): ShippedVisualChange | null {
  const screenshot = session.walkthrough?.shots?.find((shot) => shot.after)?.after;
  if (!screenshot || !fileExists(screenshot, session.id)) return null;
  return {
    sessionId: session.id,
    screenshot,
    summary: session.walkthrough!.summary,
  };
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

export async function shareShippedVisualChange(opts: {
  session: UnifiedSession;
  pr: { number: number; title: string; url: string };
  repoFullName: string;
  requestedBy?: string;
}): Promise<{ status: "shared" | "already_shared" }> {
  const channel = shippedChangesChannel();
  if (!channel) throw new Error("Shipped changes channel is not configured");
  const visual = selectShippedVisualChange(opts.session);
  if (!visual) throw new Error("Walkthrough has no valid after screenshot");
  const title = opts.pr.title.replace(/\|/g, "¦");
  const reason = shippedChangeOneLiner(visual.summary);
  if (!reason) throw new Error("Walkthrough has no prose explanation");
  const comment = `*${slackText(personaName())} shipped <${opts.pr.url}|${slackText(title)}>*\n${slackText(reason)}`;
  const announcementKey = `${opts.repoFullName}#${opts.pr.number}`;
  const claimId = claimShippedChangeAnnouncement(announcementKey);
  if (!claimId) return { status: "already_shared" };
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
    repo: opts.repoFullName,
    pr_number: opts.pr.number,
    session_id: visual.sessionId,
    slack_channel: channel,
    requested_by: opts.requestedBy,
  });
  console.log(
    `[github] Shared merged visual change ${opts.repoFullName}#${opts.pr.number} in Slack from ${visual.sessionId}`,
  );
  return { status: "shared" };
}
