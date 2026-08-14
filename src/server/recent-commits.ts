/**
 * What shipped in a repo that has no pull requests.
 *
 * A `sharedCheckout` repo (Open Session's own, self-hosting from one tree)
 * lands work as commits straight on the default branch, so the PR cache has
 * nothing to say about it and the feed showed the repo as if it had shipped
 * nothing all year. The commits themselves are the shipping record, and they
 * are already on disk: this reads them with `git log` rather than the API, so
 * it costs no GitHub quota and works for a repo with no `ghRepo` at all.
 *
 * Only `sharedCheckout` repos are read. Everywhere else a merge is a PR, and
 * listing both would show the same work twice.
 */
import { $ } from "bun";
import { configuredRepos } from "./config";
import { personKeyForGitAuthor } from "./shared/user-mappings";

export interface RecentCommit {
	/** Repo id, as in `configuredRepos()`. */
	repo: string;
	sha: string;
	title: string;
	/** GitHub commit page; absent for a repo with no `ghRepo`. */
	url?: string;
	/** Git author name, for repos whose authors aren't teammates. */
	author: string;
	/** Web user-picker key ("kent"), or null when the author isn't a teammate. */
	person: string | null;
	committedAt: string;
	additions: number;
	deletions: number;
}

/** How far back to read per repo. Deep enough to fill the feed's own window
 *  several times over on a busy day, shallow enough to stay a cheap read. */
const LOG_LIMIT = 250;
const CACHE_TTL_MS = 60_000;

const RECORD = "\x1e";
const FIELD = "\x1f";

/**
 * Parse `git log --shortstat` written with the record/field separators below.
 * Exported for the test; every call site goes through `getRecentCommits`.
 */
export function parseCommitLog(
	stdout: string,
	repo: { id: string; ghRepo?: string },
): RecentCommit[] {
	const out: RecentCommit[] = [];
	for (const chunk of stdout.split(RECORD)) {
		if (!chunk.trim()) continue;
		const [head, ...rest] = chunk.split("\n");
		const [sha, author, email, date, ...titleParts] = head.split(FIELD);
		if (!sha || !date) continue;
		// The subject is last and can't contain a newline, but it can contain
		// anything else — including our field separator, in principle.
		const title = titleParts.join(FIELD).trim();
		const stat = rest.join("\n");
		out.push({
			repo: repo.id,
			sha,
			title: title || sha.slice(0, 7),
			...(repo.ghRepo ? { url: `https://github.com/${repo.ghRepo}/commit/${sha}` } : {}),
			author: author || "",
			person: personKeyForGitAuthor(author, email),
			committedAt: date,
			additions: Number(stat.match(/(\d+) insertions?\(\+\)/)?.[1] || 0),
			deletions: Number(stat.match(/(\d+) deletions?\(-\)/)?.[1] || 0),
		});
	}
	return out;
}

/** The branch to read: what's on the remote, falling back to the local branch
 *  so a checkout that has never fetched still reports its own history. */
async function shippedRef(dir: string, defaultBranch: string): Promise<string | null> {
	for (const ref of [`origin/${defaultBranch}`, defaultBranch, "HEAD"]) {
		const ok = await $`git -C ${dir} rev-parse --verify --quiet ${ref}`.quiet().nothrow();
		if (ok.exitCode === 0) return ref;
	}
	return null;
}

async function readRepoCommits(repo: {
	id: string;
	repo: string;
	ghRepo?: string;
	defaultBranch: string;
}): Promise<RecentCommit[]> {
	const ref = await shippedRef(repo.repo, repo.defaultBranch);
	if (!ref) return [];
	const format = `${RECORD}%H${FIELD}%an${FIELD}%ae${FIELD}%aI${FIELD}%s`;
	const log = await $`git -C ${repo.repo} log ${ref} --no-merges -n ${LOG_LIMIT} --shortstat --format=${format}`
		.quiet()
		.nothrow();
	if (log.exitCode !== 0) return [];
	return parseCommitLog(log.stdout.toString(), repo);
}

let cache: { data: RecentCommit[]; ts: number } | null = null;
let inFlight: Promise<RecentCommit[]> | null = null;

/**
 * Recent commits on the default branch of every repo that ships without PRs,
 * newest first. Cached briefly: the feed asks on every page load, and a repo's
 * log doesn't move faster than that.
 */
export async function getRecentCommits(): Promise<RecentCommit[]> {
	if (cache && Date.now() - cache.ts < CACHE_TTL_MS) return cache.data;
	if (inFlight) return inFlight;
	inFlight = (async () => {
		const repos = Object.values(configuredRepos()).filter(
			(repo) => repo.sharedCheckout && repo.repo,
		);
		const perRepo = await Promise.all(repos.map((repo) => readRepoCommits(repo).catch(() => [])));
		const data = perRepo
			.flat()
			.sort((a, b) => (b.committedAt || "").localeCompare(a.committedAt || ""));
		cache = { data, ts: Date.now() };
		return data;
	})().finally(() => {
		inFlight = null;
	});
	return inFlight;
}
