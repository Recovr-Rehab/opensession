import { useCallback, useEffect, useState } from "react";
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
import { Popover } from "../ui/popover";
import { Tooltip } from "../ui/tooltip";
import { cn } from "../ui/cn";
import type { GitStatusInfo, PrDetails, UnifiedSession } from "../lib/types";
import {
	PEEK_ACTION,
	PEEK_CARD,
	PEEK_DIVIDER,
	PEEK_ICON,
	PEEK_LABEL,
	PEEK_ROW,
	PEEK_SECTION,
	PEEK_SKELETON,
	PEEK_THUMB,
	PEEK_VALUE,
} from "../lib/workspace-peek-classes";
import {
	IconArrowUp,
	IconArrowDown,
	IconBranches,
	IconCheck,
	IconClock,
	IconFile,
	IconGitMerge,
	IconListChecks,
	IconPullRequest,
	IconRepo,
	IconX,
} from "./icons";

/**
 * The session header's compact stand-in for the right Workspace panel: one
 * floating card carrying where the work stands — changes, branch, PR, checks,
 * conflicts, and the session's own scratch files.
 *
 * Why it exists: the Workspace panel is a 44%-wide column, so the only way to
 * check "did the checks pass / is there a conflict / how big is this now" was
 * to give up half the transcript. The header already carried a one-line PR
 * strip, but a single headline can't say more than one thing at a time. This
 * is the rest of that headline, on demand, over the pane's own gutter — so
 * both side columns can stay shut and the reading column stays wide.
 *
 * It is deliberately read-and-route, not a second control surface: every row
 * opens the panel tab that owns the real actions, and the only thing it does
 * itself is ask the session to commit (which is a sentence, not a git
 * plumbing call). Duplicating merge/confirm state here would mean two places
 * that can disagree about whether a merge is in flight.
 *
 * Data is fetched only while the card is open, and the PR's own line stats are
 * used for the Changes row when there is a PR — that number rides along with
 * the PR fetch, where a worktree diff would be a second, much heavier request
 * for the same two integers. With no PR (or no branch yet) it falls back to
 * the worktree diff.
 */

interface Props {
	session: UnifiedSession;
	/** Open the right panel on a tab — every row's destination. */
	onOpenPanelTab: (tab: "info" | "changes") => void;
	/** Open the Review tab (PR + its checks). */
	onOpenPr: () => void;
	onOpenChecks: () => void;
	/** Open the Assets tab (the "Sources" list's destination). */
	onOpenAssets?: () => void;
	/** Prompt the session (Commit) — WS `prompt`. Absent while disconnected. */
	send?: (msg: any) => void;
	/** Bumped when a webhook or an auto-push reports workspace activity. */
	refreshTick?: number;
}

type PeekData = {
	pr: PrDetails | null;
	git: GitStatusInfo | null;
	assets: SessionAssetFile[];
	/** Worktree line stats, only fetched when there is no PR to read them from. */
	diff: { additions: number; deletions: number; files: number } | null;
};

/** Last-known state per session, so re-opening the card paints instantly and
 *  revalidates behind the previous answer instead of flashing a skeleton.
 *  Module-level: survives the popup unmounting, dies with the page. */
const lastKnown = new Map<string, PeekData>();

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

export function WorkspacePeek({
	session,
	onOpenPanelTab,
	onOpenPr,
	onOpenChecks,
	onOpenAssets,
	send,
	refreshTick,
}: Props) {
	const [open, setOpen] = useState(false);
	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Tooltip label="Workspace summary">
				<Popover.Trigger
					className={cn(
						"inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-control",
						"border-none bg-transparent p-0 text-dim hover:bg-hover hover:text-fg",
						// Open state reads as pressed rather than hovered, so the card
						// and its trigger stay visibly one object.
						"data-[popup-open]:bg-pressed data-[popup-open]:text-fg",
					)}
					aria-label="Workspace summary"
				>
					<IconListChecks size={20} />
				</Popover.Trigger>
			</Tooltip>
			<Popover.Popup side="bottom" align="end" elevation="lg" initialFocus>
				{/* Mounted only while open — that is what keeps the fetches off every
				    session that merely has the header. */}
				<PeekBody
					session={session}
					onOpenPanelTab={onOpenPanelTab}
					onOpenPr={onOpenPr}
					onOpenChecks={onOpenChecks}
					onOpenAssets={onOpenAssets}
					send={send}
					refreshTick={refreshTick}
					close={() => setOpen(false)}
				/>
			</Popover.Popup>
		</Popover.Root>
	);
}

function PeekBody({
	session,
	onOpenPanelTab,
	onOpenPr,
	onOpenChecks,
	onOpenAssets,
	send,
	refreshTick,
	close,
}: Props & { close: () => void }) {
	const seed = lastKnown.get(session.id);
	const [data, setData] = useState<PeekData | null>(seed ?? null);
	const [prompted, setPrompted] = useState(false);

	const load = useCallback(async () => {
		const [pr, git, assets] = await Promise.all([
			fetchPr(session.id, session.repo || undefined).catch(() => null),
			fetchGitStatus(session.id, session.repo || undefined).catch(() => null),
			fetchSessionAssets(session.id)
				.then((r) => r.files)
				.catch(() => [] as SessionAssetFile[]),
		]);
		// Only pay for the worktree patch when the PR can't answer the same
		// question (see the note in the module doc).
		let diff: PeekData["diff"] = null;
		if (!pr) {
			const patch = await fetchDiff(session.id).catch(() => null);
			if (patch?.repos)
				diff = patch.repos.reduce(
					(sum, repo) => ({
						additions: sum.additions + (repo.diff.totalAdditions || 0),
						deletions: sum.deletions + (repo.diff.totalDeletions || 0),
						files: sum.files + (repo.diff.files?.length || 0),
					}),
					{ additions: 0, deletions: 0, files: 0 },
				);
		}
		const next: PeekData = { pr, git, assets, diff };
		lastKnown.set(session.id, next);
		setData(next);
	}, [session.id, session.repo]);

	useEffect(() => {
		setData(lastKnown.get(session.id) ?? null);
		load();
		return pollWhileVisible(load, PR_WEBHOOK_FALLBACK_POLL_MS);
	}, [load, session.id]);
	useEffect(() => {
		if (refreshTick) load();
	}, [refreshTick, load]);

	if (!data)
		return (
			<div className={PEEK_CARD} aria-busy="true">
				<div className={PEEK_SECTION}>Workspace</div>
				<div className={cn(PEEK_SKELETON, "w-[60%]")} />
				<div className={cn(PEEK_SKELETON, "w-[75%]")} />
				<div className={cn(PEEK_SKELETON, "w-[45%]")} />
			</div>
		);

	const { pr, git, assets, diff } = data;
	const additions = pr ? pr.additions : (diff?.additions ?? 0);
	const deletions = pr ? pr.deletions : (diff?.deletions ?? 0);
	const changedFiles = pr ? pr.changedFiles : (diff?.files ?? 0);
	const checks = summarizeChecks(pr);
	const dirty = git?.uncommittedFiles ?? 0;
	const ahead = git?.ahead ?? 0;
	const behind = git?.behindBase ?? 0;
	const conflicted = pr?.mergeable === "CONFLICTING";

	function go(run: () => void) {
		close();
		run();
	}

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
	const sources = assets.slice(0, 3);

	return (
		<div className={PEEK_CARD}>
			<div className={PEEK_SECTION}>Workspace</div>

			{changedFiles > 0 && (
				<button className={PEEK_ROW} onClick={() => go(() => onOpenPanelTab("changes"))}>
					<IconFile size={15} className={PEEK_ICON} />
					<span className={PEEK_LABEL}>Changes</span>
					<span className="shrink-0 text-meta tabular-nums">
						<span className="text-green">+{additions}</span>{" "}
						<span className="text-red">−{deletions}</span>
					</span>
				</button>
			)}

			{session.repo && (
				<button className={PEEK_ROW} onClick={() => go(() => onOpenPanelTab("info"))}>
					<IconRepo size={15} className={PEEK_ICON} />
					<span className={PEEK_LABEL}>{session.repo}</span>
				</button>
			)}

			{branch && (
				<button
					className={PEEK_ROW}
					onClick={() => {
						navigator.clipboard?.writeText(branch).catch(() => {});
					}}
					title={branch}
				>
					<IconBranches size={15} className={PEEK_ICON} />
					<span className={PEEK_LABEL}>{branch}</span>
					<span className={cn(PEEK_ACTION, "opacity-0 group-hover/peek:opacity-100")}>
						Copy
					</span>
				</button>
			)}

			{dirty > 0 && (
				<button className={PEEK_ROW} onClick={askCommit} disabled={!send}>
					<IconClock size={15} className={PEEK_ICON} />
					<span className={PEEK_LABEL}>
						{prompted
							? "Asked to commit"
							: `Commit ${dirty} file${dirty === 1 ? "" : "s"}`}
					</span>
					{!prompted && <span className={PEEK_ACTION}>Commit</span>}
				</button>
			)}

			{ahead > 0 && (
				<div className={PEEK_ROW}>
					<IconArrowUp size={15} className={PEEK_ICON} />
					<span className={PEEK_LABEL}>
						Ahead by {ahead} commit{ahead === 1 ? "" : "s"}
					</span>
				</div>
			)}

			{pr && (
				<button className={PEEK_ROW} onClick={() => go(onOpenPr)} title={pr.title}>
					<IconPullRequest size={15} className={PEEK_ICON} />
					<span className={PEEK_LABEL}>{pr.title}</span>
					<span className={PEEK_VALUE}>#{pr.number}</span>
				</button>
			)}

			{pr && checks.total > 0 && (
				<button className={PEEK_ROW} onClick={() => go(onOpenChecks)}>
					{checks.failed > 0 ? (
						<IconX size={15} className="shrink-0 text-red" />
					) : checks.pending > 0 ? (
						<IconClock size={15} className="shrink-0 text-yellow" />
					) : (
						<IconCheck size={15} className="shrink-0 text-green" />
					)}
					<span className={PEEK_LABEL}>
						{checks.failed > 0
							? `${checks.failed} check${checks.failed === 1 ? "" : "s"} failing`
							: checks.pending > 0
								? `${checks.pending} check${checks.pending === 1 ? "" : "s"} pending`
								: "Checks successful"}
					</span>
				</button>
			)}

			{conflicted && (
				<button className={PEEK_ROW} onClick={() => go(onOpenPr)}>
					<IconGitMerge size={15} className="shrink-0 text-red" />
					<span className={PEEK_LABEL}>Merge conflicts</span>
					<span className={PEEK_ACTION}>Fix</span>
				</button>
			)}

			{behind > 0 && (
				<button className={PEEK_ROW} onClick={() => go(() => onOpenPanelTab("info"))}>
					<IconArrowDown size={15} className={PEEK_ICON} />
					<span className={PEEK_LABEL}>
						{behind} behind {git?.baseBranch || "main"}
					</span>
					<span className={PEEK_ACTION}>Pull</span>
				</button>
			)}

			{sources.length > 0 && (
				<>
					<div className={PEEK_DIVIDER} />
					<div className={PEEK_SECTION}>Sources</div>
					{sources.map((file) => (
						<button
							key={file.path}
							className={PEEK_ROW}
							onClick={() => go(() => onOpenAssets?.())}
							title={file.path}
						>
							{IMAGE_RE.test(file.path) ? (
								<img
									src={sessionAssetPreviewUrl(session.id, file)}
									alt=""
									className={PEEK_THUMB}
									loading="lazy"
								/>
							) : (
								<IconFile size={15} className={PEEK_ICON} />
							)}
							<span className={PEEK_LABEL}>{file.path}</span>
						</button>
					))}
					{assets.length > sources.length && (
						<button className={PEEK_ROW} onClick={() => go(() => onOpenAssets?.())}>
							<span className="w-[15px] shrink-0" />
							<span className={cn(PEEK_LABEL, "text-dim")}>
								View all {assets.length}
							</span>
						</button>
					)}
				</>
			)}
		</div>
	);
}
