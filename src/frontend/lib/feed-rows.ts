/**
 * One shipped thing, as a feed row.
 *
 * The feed is what the team shipped, and not every repo ships the same way:
 * most land work as a merged pull request, while a `sharedCheckout` repo
 * (Open Session's own) commits straight to the default branch and has no PR
 * to show. Both become the same row here, sorted together, so the page
 * answers "what shipped" rather than "what merged".
 */

import type { RecentCommit } from "./api";
import { personLabel, type WorktreeRow } from "./pr-rows";
import type { UnifiedSession } from "./types";

/**
 * Who shipped it. Everything has an owner: a teammate, or the automation or
 * agent that ran unattended. A row with no owner at all is a gap in the
 * record rather than a kind of work, so the feed does not render one.
 */
export interface FeedOwner {
	/** User-picker key, for a teammate. Null for an automation or agent. */
	person: string | null;
	/** What to call them: a teammate's name, or the automation's own. */
	label: string;
}

export interface FeedRow {
	key: string;
	kind: "pr" | "commit";
	title: string;
	repo: string;
	person: string | null;
	/** Null only for work shipped before commits carried a name. */
	owner: FeedOwner | null;
	url?: string;
	/** What to call it in the list: "#128" for a PR, a short sha for a commit. */
	ref?: string;
	additions?: number;
	deletions?: number;
	shippedAt: string;
	/** The workspace behind it, when there is one to open. */
	session?: UnifiedSession;
}

export function shortSha(sha: string): string {
	return sha.slice(0, 7);
}

/**
 * Resolve a row's owner. A teammate wins; otherwise the recorded author is
 * used as it stands, because an unattended run signs its own name (an
 * automation, the review agent). Null only when nothing was recorded, which is
 * how work from before commits carried a name still reads.
 */
export function feedOwner(person: string | null, author?: string | null): FeedOwner | null {
	if (person) return { person, label: personLabel(person) };
	const label = (author || "").trim();
	return label ? { person: null, label } : null;
}

/** Merged PRs and commits in one list, newest first. */
export function buildFeedRows(prRows: WorktreeRow[], commits: RecentCommit[]): FeedRow[] {
	const rows: FeedRow[] = [
		...prRows.map((row) => ({
			key: row.key,
			kind: "pr" as const,
			title: row.title,
			repo: row.repo,
			person: row.person,
			owner: feedOwner(row.person, row.author),
			url: row.url,
			...(row.number ? { ref: `#${row.number}` } : {}),
			additions: row.additions,
			deletions: row.deletions,
			shippedAt: row.updatedAt,
			session: row.session,
		})),
		...commits.map((commit) => ({
			key: `${commit.repo}:${commit.sha}`,
			kind: "commit" as const,
			title: commit.title,
			repo: commit.repo,
			person: commit.person,
			owner: feedOwner(commit.person, commit.author),
			url: commit.url,
			ref: shortSha(commit.sha),
			additions: commit.additions,
			deletions: commit.deletions,
			shippedAt: commit.committedAt,
		})),
	];
	return rows.sort(
		(a, b) => new Date(b.shippedAt).getTime() - new Date(a.shippedAt).getTime(),
	);
}
