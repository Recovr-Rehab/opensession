import { useCallback, useEffect, useRef, useState } from "react";
import {
	fetchGitStatus,
	fetchPr,
	fetchSessionAssets,
	sessionAssetPreviewUrl,
	type SessionAssetFile,
} from "../lib/api";
import { fetchDiff } from "../lib/api";
import { commitPrompt } from "../lib/commit-prompt";
import { getCurrentUser } from "./UserPicker";
import { pollWhileVisible, PR_WEBHOOK_FALLBACK_POLL_MS } from "../lib/poll";
import { summarizeChecks } from "./PrStatusBar";
import { cn } from "../ui/cn";
import type { GitStatusInfo, PrDetails, UnifiedSession } from "../lib/types";
import {
	WS_SUMMARY_ACTION,
	WS_SUMMARY_BODY,
	WS_SUMMARY_DIVIDER,
	WS_SUMMARY_ICON,
	WS_SUMMARY_LABEL,
	WS_SUMMARY_ROW,
	WS_SUMMARY_SECTION,
	WS_SUMMARY_SHELL,
	WS_SUMMARY_STATE,
	WS_SUMMARY_THUMB,
} from "../lib/workspace-summary-classes";
import {
	IconArrowUp,
	IconArrowDown,
	IconBranches,
	IconCheck,
	IconClock,
	IconFile,
	IconGitMerge,
	IconPullRequest,
	IconRepo,
	IconX,
} from "./icons";

/**
 * The workspace summary: a standing column beside the transcript carrying
 * where the work stands. Changes, branch, PR, checks, conflicts, and the
 * session's own scratch files.
 *
 * Why it exists: the Workspace panel is a third of the pane, so the only way
 * to check "did the checks pass / is there a conflict / how big is this now"
 * was to give up that much of the transcript. The header carries a one-line PR
 * strip, but a single headline cannot say more than one thing at a time. This
 * is the rest of that headline, standing open, in a column narrow enough to
 * leave the reading column wide.
 *
 * It was a popover first, and the reframe to a column is the whole point of
 * this file: workspace state is something you keep an eye on, not something
 * you go and ask for. A card you have to open tells you nothing about the
 * moment you were not looking, so the answer to "did that push land" was
 * always a click. Standing in the layout it is also cheaper than it was
 * floating: the card had to shove the transcript sideways to avoid covering
 * it, and a real column just takes its width.
 *
 * It is deliberately read-and-route, not a second control surface. Every row
 * opens the panel page that owns the real actions, and the only thing it does
 * itself is ask the session to commit (which is a sentence, not a git plumbing
 * call). Duplicating merge/confirm state here would mean two places that can
 * disagree about whether a merge is in flight, which is also why the header's
 * PR strip keeps the merge and push buttons: this column reports, that strip
 * commits.
 *
 * Fetching: the PR's own line stats feed the Changes row when there is a PR,
 * because that number rides along with the PR fetch where a worktree diff
 * would be a second, much heavier request for the same two integers. With no
 * PR (or no branch yet) it falls back to the worktree diff, and that one is
 * gated on the worktree having actually moved, since a standing column polls
 * for as long as the session is open where the card only polled while you held
 * it.
 */

interface Props {
	session: UnifiedSession;
	/** Open the right panel on a page. Every row's destination. */
	onOpenPanelTab: (tab: "info" | "changes") => void;
	/** Open the Review tab (PR + its checks). */
	onOpenPr: () => void;
	onOpenChecks: () => void;
	/** Open the Assets tab (the "Sources" list's destination). */
	onOpenAssets?: () => void;
	/** Prompt the session (Commit) via WS `prompt`. Absent while disconnected. */
	send?: (msg: any) => void;
	/** Bumped when a webhook or an auto-push reports workspace activity. */
	refreshTick?: number;
}

type SummaryData = {
	pr: PrDetails | null;
	git: GitStatusInfo | null;
	assets: SessionAssetFile[];
	/** Worktree line stats, only fetched when there is no PR to read them from. */
	diff: { additions: number; deletions: number; files: number } | null;
};

/** Last-known state per session, so switching back to a session paints
 *  instantly and revalidates behind the previous answer instead of flashing a
 *  skeleton. Module-level: survives the column unmounting, dies with the page. */
const lastKnown = new Map<string, SummaryData>();

function emptyData(): SummaryData {
	return { pr: null, git: null, assets: [], diff: null };
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

/** How many sources the column lists before it defers to the Assets tab. A
 *  floating card could only afford three; a column has the height for the
 *  handful a session usually makes. */
const SOURCES_SHOWN = 8;

/** What the worktree diff is a function of. The Changes row's +/− only moves
 *  when one of these does, so a poll that finds them unchanged can skip the
 *  patch (see the module doc). */
function diffKey(git: GitStatusInfo | null): string {
	return `${git?.branch ?? ""}|${git?.uncommittedFiles ?? 0}|${git?.ahead ?? 0}`;
}

/** The PR glyph's colour: where the pull request itself stands. */
function prTone(pr: PrDetails): string {
	if (pr.state === "MERGED") return "text-purple";
	if (pr.state === "CLOSED") return "text-dim";
	if (pr.isDraft) return "text-faint";
	return "text-green";
}

/** The word at the row's right edge: the review verdict when there is one to
 *  report, otherwise the PR's own state. A draft says so before anything else,
 *  since an approval on a draft still cannot ship. */
function prStatusLabel(pr: PrDetails): { label: string; tone: string } {
	if (pr.state === "MERGED") return { label: "Merged", tone: "text-purple" };
	if (pr.state === "CLOSED") return { label: "Closed", tone: "text-dim" };
	if (pr.isDraft) return { label: "Draft", tone: "text-dim" };
	if (pr.reviewDecision === "CHANGES_REQUESTED")
		return { label: "Changes requested", tone: "text-red" };
	if (pr.reviewDecision === "APPROVED")
		return { label: "Approved", tone: "text-green" };
	if (pr.reviewDecision === "REVIEW_REQUIRED")
		return { label: "Review needed", tone: "text-dim" };
	return { label: "Open", tone: "text-dim" };
}

export function WorkspaceSummary({
	session,
	onOpenPanelTab,
	onOpenPr,
	onOpenChecks,
	onOpenAssets,
	send,
	refreshTick,
}: Props) {
	const activeSessionId = useRef(session.id);
	activeSessionId.current = session.id;
	const [data, setData] = useState<SummaryData>(
		() => lastKnown.get(session.id) ?? emptyData(),
	);
	const [prompted, setPrompted] = useState(false);
	// The worktree state the stored diff was fetched for. Null asks for a fresh
	// patch on the next load.
	const diffKeyRef = useRef<string | null>(null);
	const updateData = useCallback(
		(patch: Partial<SummaryData>) => {
			if (activeSessionId.current !== session.id) return;
			setData((current) => {
				const next = { ...current, ...patch };
				lastKnown.set(session.id, next);
				return next;
			});
		},
		[session.id],
	);

	const load = useCallback(async () => {
		// Each answer paints as it lands rather than waiting for the slowest of
		// the three, which is what makes a cold session fill in rather than
		// appear.
		const prTask = fetchPr(session.id, session.repo || undefined)
			.catch(() => null)
			.then((nextPr) => {
				updateData({ pr: nextPr, ...(nextPr ? { diff: null } : {}) });
				return nextPr;
			});
		const gitTask = fetchGitStatus(session.id, session.repo || undefined)
			.catch(() => null)
			.then((nextGit) => {
				updateData({ git: nextGit });
				return nextGit;
			});
		const assetsTask = fetchSessionAssets(session.id)
			.then((response) => response.files)
			.catch(() => [] as SessionAssetFile[])
			.then((nextAssets) => updateData({ assets: nextAssets }));
		const [nextPr, nextGit] = await Promise.all([prTask, gitTask, assetsTask]);
		if (activeSessionId.current !== session.id) return;
		// Only pay for the worktree patch when the PR cannot answer the same
		// question, and only when the worktree has moved since the last one.
		if (nextPr) {
			diffKeyRef.current = null;
			return;
		}
		const key = diffKey(nextGit);
		if (key === diffKeyRef.current) return;
		diffKeyRef.current = key;
		const patch = await fetchDiff(session.id).catch(() => null);
		const diff = patch?.repos
			? patch.repos.reduce(
					(sum, repo) => ({
						additions: sum.additions + (repo.diff.totalAdditions || 0),
						deletions: sum.deletions + (repo.diff.totalDeletions || 0),
						files: sum.files + (repo.diff.files?.length || 0),
					}),
					{ additions: 0, deletions: 0, files: 0 },
				)
			: null;
		updateData({ diff });
	}, [session.id, session.repo, updateData]);

	useEffect(() => {
		setData(lastKnown.get(session.id) ?? emptyData());
		diffKeyRef.current = null;
		load();
		return pollWhileVisible(load, PR_WEBHOOK_FALLBACK_POLL_MS);
	}, [load, session.id]);
	useEffect(() => {
		if (!refreshTick) return;
		// A push or a PR event is exactly when the patch is stale, so this is
		// the one refresh that always re-reads it.
		diffKeyRef.current = null;
		load();
	}, [refreshTick, load]);

	const { pr, git, assets, diff } = data;
	const additions = pr ? pr.additions : (diff?.additions ?? 0);
	const deletions = pr ? pr.deletions : (diff?.deletions ?? 0);
	const changedFiles = pr ? pr.changedFiles : (diff?.files ?? 0);
	const checks = summarizeChecks(pr);
	const dirty = git?.uncommittedFiles ?? 0;
	const ahead = git?.ahead ?? 0;
	const behind = git?.behindBase ?? 0;
	const conflicted = pr?.mergeable === "CONFLICTING";

	function askCommit() {
		if (!send) return;
		send({
			type: "prompt",
			sessionId: session.id,
			user: getCurrentUser(),
			content: commitPrompt(dirty, git?.sharedCheckout, git?.uncommittedPaths),
		});
		setPrompted(true);
		setTimeout(() => setPrompted(false), 4000);
	}

	const branch = git?.branch || session.branch;
	const sources = assets.slice(0, SOURCES_SHOWN);

	return (
		<aside className={WS_SUMMARY_SHELL} aria-label="Workspace summary">
			<div className={WS_SUMMARY_BODY}>
				<div className={WS_SUMMARY_SECTION}>Workspace</div>

				{changedFiles > 0 && (
					<button
						className={WS_SUMMARY_ROW}
						onClick={() => onOpenPanelTab("changes")}
					>
						<IconFile size={15} className={WS_SUMMARY_ICON} />
						<span className={WS_SUMMARY_LABEL}>Changes</span>
						<span className="shrink-0 text-meta tabular-nums">
							<span className="text-green">+{additions}</span>{" "}
							<span className="text-red">−{deletions}</span>
						</span>
					</button>
				)}

				{session.repo && (
					<button
						className={WS_SUMMARY_ROW}
						onClick={() => onOpenPanelTab("info")}
					>
						<IconRepo size={15} className={WS_SUMMARY_ICON} />
						<span className={WS_SUMMARY_LABEL}>{session.repo}</span>
					</button>
				)}

				{branch && (
					<button
						className={WS_SUMMARY_ROW}
						onClick={() => {
							navigator.clipboard?.writeText(branch).catch(() => {});
						}}
						title={branch}
					>
						<IconBranches size={15} className={WS_SUMMARY_ICON} />
						<span className={WS_SUMMARY_LABEL}>{branch}</span>
						<span
							className={cn(WS_SUMMARY_ACTION, "opacity-0 group-hover/ws:opacity-100")}
						>
							Copy
						</span>
					</button>
				)}

				{dirty > 0 && (
					<button className={WS_SUMMARY_ROW} onClick={askCommit} disabled={!send}>
						<IconClock size={15} className={WS_SUMMARY_ICON} />
						<span className={WS_SUMMARY_LABEL}>
							{prompted
								? "Asked to commit"
								: `Commit ${dirty} file${dirty === 1 ? "" : "s"}`}
						</span>
						{!prompted && <span className={WS_SUMMARY_ACTION}>Commit</span>}
					</button>
				)}

				{ahead > 0 && (
					<div className={WS_SUMMARY_ROW}>
						<IconArrowUp size={15} className={WS_SUMMARY_ICON} />
						<span className={WS_SUMMARY_LABEL}>
							Ahead by {ahead} commit{ahead === 1 ? "" : "s"}
						</span>
					</div>
				)}

				{pr && (
					<button
						className={WS_SUMMARY_ROW}
						onClick={onOpenPr}
						title={`#${pr.number} · ${pr.title}`}
					>
						{/* The glyph carries the PR's own state and the trailing word
						    carries the review's. They answer different questions ("has
						    it landed" vs "is anyone blocking it"), and a merged PR with
						    an old approval on it must not read as open. */}
						<IconPullRequest size={15} className={cn("shrink-0", prTone(pr))} />
						<span className={WS_SUMMARY_LABEL}>{pr.title}</span>
						<span className={cn(WS_SUMMARY_STATE, prStatusLabel(pr).tone)}>
							{prStatusLabel(pr).label}
						</span>
					</button>
				)}

				{pr && checks.total > 0 && (
					<button className={WS_SUMMARY_ROW} onClick={onOpenChecks}>
						{checks.failed > 0 ? (
							<IconX size={15} className="shrink-0 text-red" />
						) : checks.pending > 0 ? (
							<IconClock size={15} className="shrink-0 text-yellow" />
						) : (
							<IconCheck size={15} className="shrink-0 text-green" />
						)}
						<span className={WS_SUMMARY_LABEL}>
							{checks.failed > 0
								? `${checks.failed} check${checks.failed === 1 ? "" : "s"} failing`
								: checks.pending > 0
									? `${checks.pending} check${checks.pending === 1 ? "" : "s"} pending`
									: "Checks successful"}
						</span>
					</button>
				)}

				{conflicted && (
					<button className={WS_SUMMARY_ROW} onClick={onOpenPr}>
						<IconGitMerge size={15} className="shrink-0 text-red" />
						<span className={WS_SUMMARY_LABEL}>Merge conflicts</span>
						<span className={WS_SUMMARY_ACTION}>Fix</span>
					</button>
				)}

				{behind > 0 && (
					<button
						className={WS_SUMMARY_ROW}
						onClick={() => onOpenPanelTab("info")}
					>
						<IconArrowDown size={15} className={WS_SUMMARY_ICON} />
						<span className={WS_SUMMARY_LABEL}>
							{behind} behind {git?.baseBranch || "main"}
						</span>
						<span className={WS_SUMMARY_ACTION}>Pull</span>
					</button>
				)}

				{sources.length > 0 && (
					<>
						<div className={WS_SUMMARY_DIVIDER} />
						<div className={WS_SUMMARY_SECTION}>Sources</div>
						{sources.map((file) => (
							<button
								key={file.path}
								className={WS_SUMMARY_ROW}
								onClick={() => onOpenAssets?.()}
								title={file.path}
							>
								{IMAGE_RE.test(file.path) ? (
									<img
										src={sessionAssetPreviewUrl(session.id, file)}
										alt=""
										className={WS_SUMMARY_THUMB}
										loading="lazy"
									/>
								) : (
									<IconFile size={15} className={WS_SUMMARY_ICON} />
								)}
								<span className={WS_SUMMARY_LABEL}>{file.path}</span>
							</button>
						))}
						{assets.length > sources.length && (
							<button className={WS_SUMMARY_ROW} onClick={() => onOpenAssets?.()}>
								<span className="w-[15px] shrink-0" />
								<span className={cn(WS_SUMMARY_LABEL, "text-dim")}>
									View all {assets.length}
								</span>
							</button>
						)}
					</>
				)}
			</div>
		</aside>
	);
}
