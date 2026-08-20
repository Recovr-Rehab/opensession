/**
 * Website access requests, stored as the small Markdown list the landing page
 * started with. The POST route is public, while the Settings reader is behind
 * Open Session's normal sign-in and workspace-admin gate.
 *
 * Storage defaults to ~/.opensession-waitlist.md. Reads and writes resolve the
 * path per call so isolated dev instances and tests never touch live state.
 */
import { readFileSync } from "fs";
import { configuredIntegration, configuredServer } from "./config";
import { stateDir } from "./paths";
import { writeFileAtomic } from "./shared/atomic-write";

export interface WaitlistEntry {
	email: string;
	createdAt: string;
}

export interface WaitlistAddResult {
	entry: WaitlistEntry;
	duplicate: boolean;
	slackNotified: boolean;
}

type WaitlistNotifier = (entry: WaitlistEntry) => Promise<boolean>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ENTRY_RE = /^-\s+(.+?)\s+·\s+(\S+)\s*$/;

const waitlistState = ((globalThis as typeof globalThis & {
	__osWaitlistState?: { chain: Promise<void> };
}).__osWaitlistState ??= { chain: Promise.resolve() });

function waitlistFile(): string {
	return process.env.OPENSESSION_WAITLIST_FILE || stateDir("waitlist.md");
}

function normalizeEmail(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const email = value.trim().toLowerCase();
	return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

export function parseWaitlistMarkdown(markdown: string): WaitlistEntry[] {
	const entries: WaitlistEntry[] = [];
	for (const line of markdown.split("\n")) {
		const match = line.match(ENTRY_RE);
		if (!match) continue;
		const email = normalizeEmail(match[1]);
		const createdAt = match[2];
		if (!email || Number.isNaN(Date.parse(createdAt))) continue;
		entries.push({ email, createdAt });
	}
	return entries;
}

function readWaitlistMarkdown(): string {
	try {
		return readFileSync(waitlistFile(), "utf8");
	} catch {
		return "";
	}
}

/** Newest first, regardless of the order of lines in an existing file. */
export function listWaitlist(): WaitlistEntry[] {
	return parseWaitlistMarkdown(readWaitlistMarkdown()).sort(
		(a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
	);
}

function withWaitlistLock<T>(work: () => Promise<T> | T): Promise<T> {
	const run = waitlistState.chain.then(work, work);
	waitlistState.chain = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}

export function waitlistSlackChannel(): { id: string; name: string } | null {
	const names = configuredIntegration("slack").channelNames;
	if (!names || typeof names !== "object" || Array.isArray(names)) return null;
	for (const [id, name] of Object.entries(names)) {
		if (
			/^C[A-Z0-9]+$/.test(id) &&
			typeof name === "string" &&
			name.trim().toLowerCase() === "os"
		) {
			return { id, name: name.trim() };
		}
	}
	return null;
}

async function notifyWaitlistSlack(entry: WaitlistEntry): Promise<boolean> {
	const channel = waitlistSlackChannel();
	if (!channel) return false;
	const { sendSlackMessage } = await import("../agents/slack/slack-api");
	const base = configuredServer().publicBaseUrl.replace(/\/$/, "");
	const posted = await sendSlackMessage(
		channel.id,
		`New waitlist request: ${entry.email}\n<${base}/settings/waitlist|Open waitlist>`,
	);
	if (!posted?.ok) throw new Error(posted?.error || "Slack rejected the message");
	return true;
}

/** Store once, then notify #os once. A Slack outage never loses the address. */
export async function addToWaitlist(
	value: unknown,
	opts: { now?: Date; notify?: WaitlistNotifier } = {},
): Promise<WaitlistAddResult> {
	const email = normalizeEmail(value);
	if (!email) throw new Error("Enter a valid email address");

	const stored = await withWaitlistLock(() => {
		const markdown = readWaitlistMarkdown();
		const existing = parseWaitlistMarkdown(markdown).find(
			(entry) => entry.email === email,
		);
		if (existing) return { entry: existing, duplicate: true };

		const entry: WaitlistEntry = {
			email,
			createdAt: (opts.now || new Date()).toISOString(),
		};
		const prefix = markdown.trim()
			? `${markdown.replace(/\s*$/, "")}\n`
			: "# Waitlist\n\n";
		writeFileAtomic(
			waitlistFile(),
			`${prefix}- ${entry.email} · ${entry.createdAt}\n`,
			0o600,
		);
		return { entry, duplicate: false };
	});

	if (stored.duplicate) return { ...stored, slackNotified: false };
	try {
		const slackNotified = await (opts.notify || notifyWaitlistSlack)(stored.entry);
		return { ...stored, slackNotified };
	} catch (error) {
		console.warn("[waitlist] Stored signup but could not notify Slack:", error);
		return { ...stored, slackNotified: false };
	}
}
