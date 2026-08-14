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
import type { WorktreeRow } from "./pr-rows";
import type { UnifiedSession } from "./types";

export interface FeedRow {
	key: string;
	kind: "pr" | "commit";
	title: string;
	repo: string;
	person: string | null;
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

/** Merged PRs and commits in one list, newest first. */
export function buildFeedRows(prRows: WorktreeRow[], commits: RecentCommit[]): FeedRow[] {
	const rows: FeedRow[] = [
		...prRows.map((row) => ({
			key: row.key,
			kind: "pr" as const,
			title: row.title,
			repo: row.repo,
			person: row.person,
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
