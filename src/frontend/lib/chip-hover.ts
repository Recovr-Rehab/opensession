import { fetchOpenPrs, fetchSession, type OpenPr } from "./api";
import type { OsReview, UnifiedSession } from "./types";

/**
 * What a transcript chip's hover card knows.
 *
 * Session chips (`os-019f…`) and PR chips (`opensession#128`) are rendered by
 * markdown.ts into an HTML string, so neither can own a popover the way a
 * sidebar row does. One document-level watcher raises a single card off the
 * hovered anchor instead (components/ChipHoverCard.tsx), and this module
 * answers what that card should say.
 *
 * Everything comes from data the app already holds — the polled session list
 * covers most chips — with one lazy, cached fetch behind each kind for the
 * rest: a session that has been archived out of the list, and a PR that no
 * loaded session owns.
 */

export type ChipTarget =
	| { kind: "session"; key: string; id: string }
	| { kind: "pr"; key: string; repo: string; number: number };

/** The chips a card can be raised on. Both carry the ids the card needs. */
export const CHIP_SELECTOR =
	"a.session-link[data-session-id], a.pr-ref[data-pr-number]";

/** What the hovered anchor points at, or null when it says too little. */
export function chipTarget(el: HTMLElement): ChipTarget | null {
	const id = el.dataset.sessionId;
	if (id) return { kind: "session", key: `session:${id}`, id };
	const repo = el.dataset.prRepo;
	const number = Number(el.dataset.prNumber);
	if (repo && Number.isInteger(number))
		return { kind: "pr", key: `pr:${repo}#${number}`, repo, number };
	return null;
}

/**
 * One PR, assembled from wherever this client already knows it. Shaped to be
 * readable by the PR vocabulary the rest of the app shares — `refTone` and
 * `refState` (lib/pr-refs.ts) take exactly the state/draft/review/checks
 * quartet, so the chip card words a PR the way every other surface does.
 */
export type ChipPr = {
	repo: string;
	number: number;
	title?: string;
	url?: string;
	branch?: string;
	author?: string;
	state?: "OPEN" | "MERGED" | "CLOSED";
	isDraft?: boolean;
	reviewDecision?: string;
	checks?: { total: number; passed: number; failed: number; pending: number };
	osReview?: OsReview;
	reviewRequested?: string[];
	createdAt?: string;
	updatedAt?: string;
	additions?: number;
	deletions?: number;
	/** The session that opened it, when one of ours did. */
	session?: UnifiedSession;
};

/** The PR as a session in the list knows it: its own branch's PR first, then
 *  the PRs a session merely spans (attached repos, linked, discovered). */
function prFromSessions(
	repo: string,
	number: number,
	sessions: UnifiedSession[],
): ChipPr | null {
	for (const s of sessions) {
		if (s.repo !== repo || s.prNumber !== number) continue;
		return {
			repo,
			number,
			title: s.prTitle,
			url: s.prUrl,
			branch: s.branch || undefined,
			author: s.prAuthor,
			state: s.prState,
			isDraft: s.prIsDraft,
			reviewDecision: s.prReviewDecision,
			checks: s.prChecks,
			osReview: s.prOsReview,
			reviewRequested: s.prReviewRequested,
			updatedAt: s.prUpdatedAt,
			additions: s.prAdditions,
			deletions: s.prDeletions,
			session: s,
		};
	}
	for (const s of sessions) {
		for (const ref of s.prs || []) {
			if (ref.repo !== repo || ref.number !== number) continue;
			return {
				repo,
				number,
				title: ref.title,
				url: ref.url,
				branch: ref.branch,
				state: ref.state,
				isDraft: ref.isDraft,
				reviewDecision: ref.reviewDecision,
				checks: ref.checks,
				additions: ref.additions,
				deletions: ref.deletions,
				session: s,
			};
		}
	}
	return null;
}

/**
 * Everything known about the PR a chip names. The repo-wide open-PR list is
 * the richer half (author, title, review requests, automated review) and the
 * session list is the fresher one, so lifecycle comes from the session: a PR
 * that merged a minute ago can still sit in the cached open list.
 */
export function chipPr(
	repo: string,
	number: number,
	sessions: UnifiedSession[],
	openPrs: OpenPr[],
): ChipPr | null {
	const mine = prFromSessions(repo, number, sessions);
	const open = openPrs.find((p) => p.repo === repo && p.number === number);
	if (!mine && !open) return null;
	return {
		repo,
		number,
		title: mine?.title || open?.title,
		url: mine?.url || open?.url,
		branch: mine?.branch || open?.branch,
		author: mine?.author || open?.author,
		state: mine?.state ?? (open ? "OPEN" : undefined),
		isDraft: mine?.isDraft ?? open?.isDraft,
		reviewDecision: mine?.reviewDecision || open?.reviewDecision,
		checks: mine?.checks ?? open?.checks,
		osReview: mine?.osReview ?? open?.osReview,
		reviewRequested: mine?.reviewRequested ?? open?.reviewRequested,
		createdAt: open?.createdAt,
		updatedAt: mine?.updatedAt || open?.updatedAt,
		additions: mine?.additions,
		deletions: mine?.deletions,
		session: mine?.session,
	};
}

/** A card is only worth raising over the chip's own tooltip once it can name
 *  the PR. Numbers and a repo id are what the chip already says. */
export function chipPrIsWorthShowing(pr: ChipPr | null): pr is ChipPr {
	return !!pr?.title;
}

// ── Lazy sources ────────────────────────────────────────────────────────────
//
// Both are hover-driven, so they fetch on first need rather than polling, and
// both cache: a pointer crossing a paragraph of chips must not become a burst
// of requests.

const OPEN_PRS_TTL_MS = 60_000;
let openPrs: OpenPr[] = [];
let openPrsAt = 0;
let openPrsInFlight: Promise<OpenPr[]> | null = null;

/** The open PRs already fetched, for the synchronous first look. */
export function cachedOpenPrs(): OpenPr[] {
	return openPrs;
}

export function loadOpenPrs(): Promise<OpenPr[]> {
	if (Date.now() - openPrsAt < OPEN_PRS_TTL_MS) return Promise.resolve(openPrs);
	if (!openPrsInFlight)
		openPrsInFlight = fetchOpenPrs()
			.then((prs) => {
				openPrs = prs;
				openPrsAt = Date.now();
				return prs;
			})
			.finally(() => {
				openPrsInFlight = null;
			});
	return openPrsInFlight;
}

// Sessions the list doesn't carry (archived, or someone else's standalone).
// Null is cached too — a chip pointing at a deleted session shouldn't retry
// on every hover.
const fetchedSessions = new Map<string, UnifiedSession | null>();
const sessionsInFlight = new Map<string, Promise<UnifiedSession | null>>();

export function cachedChipSession(id: string): UnifiedSession | null {
	return fetchedSessions.get(id) ?? null;
}

export function loadChipSession(id: string): Promise<UnifiedSession | null> {
	if (fetchedSessions.has(id))
		return Promise.resolve(fetchedSessions.get(id) ?? null);
	const pending = sessionsInFlight.get(id);
	if (pending) return pending;
	const request = fetchSession(id)
		.then((session) => {
			fetchedSessions.set(id, session);
			return session;
		})
		.catch(() => null)
		.finally(() => {
			sessionsInFlight.delete(id);
		});
	sessionsInFlight.set(id, request);
	return request;
}
