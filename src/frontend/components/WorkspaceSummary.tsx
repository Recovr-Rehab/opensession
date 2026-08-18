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
import { Popover } from "../ui/popover";
import { Tooltip } from "../ui/tooltip";
import { cn } from "../ui/cn";
import type { GitStatusInfo, PrDetails, UnifiedSession } from "../lib/types";
import {
	WS_SUMMARY_ACTION,
	WS_SUMMARY_CARD,
	WS_SUMMARY_COUNT,
	WS_SUMMARY_DIVIDER,
	WS_SUMMARY_ICON,
	WS_SUMMARY_LABEL,
	WS_SUMMARY_ROW,
	WS_SUMMARY_SECTION,
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
	IconGlobe,
	IconListCircles,
	IconPullRequest,
	IconRepo,
	IconStack,
	IconTerminal,
	IconX,
} from "./icons";

/**
 * The session header's compact stand-in for the right Workspace panel: one
 * floating card carrying both halves of what that panel holds. Where the work
 * stands (changes, branch, PR, checks, conflicts, sources) and the places it
 * can take you (portals, agents, terminal).
 *
 * Why it exists: the Workspace panel is a third of the pane, so the only way
 * to check "did the checks pass / is there a conflict / is anything still
 * running" was to give up that much of the transcript. The header already
 * carries a one-line PR strip, but a single headline cannot say more than one
 * thing at a time. This is the rest of that headline, on demand, over the
 * pane's own gutter, so both side columns can stay shut and the reading column
 * stays wide.
 *
 * It carries the panel's whole set of destinations rather than a chosen few.
 * A smaller version of a place is only useful if it is the same place: a card
 * that answered five of the panel's questions and stayed quiet about the other
 * three would send you to the panel for the missing ones, which is the thing
 * it exists to avoid. The Places band is the panel's bottom bar, one row each,
 * with the same live counts on the same two rows.
 *
 * It is deliberately read-and-route, not a second control surface: every row
 * opens the panel page that owns the real actions, and the only thing it does
 * itself is ask the session to commit (which is a sentence, not a git plumbing
 * call). Duplicating merge/confirm state here would mean two places that can
 * disagree about whether a merge is in flight, which is why the header's PR
 * strip keeps merge and push: this card reports, that strip commits.
 *
 * Data is fetched only while the card is open, which is what keeps the polls
 * off every session that merely has the header. The PR's own line stats feed
 * the Changes row when there is a PR, because that number rides along with the
 * PR fetch where a worktree diff would be a second, much heavier request for
 * the same two integers. With no PR (or no branch yet) it falls back to the
 * worktree diff.
 */

interface Props {
	session: UnifiedSession;
	/**
	 * What the card aligns its right edge to: the header's actions row, not the
	 * trigger. Anchoring to the trigger left it hanging off the middle of the
	 * cluster with the panel toggle poking out beside it; against the row it
	 * lands flush with the chrome's own right edge, which is where a summary of
	 * the right-hand panel belongs.
	 */
	anchor?: React.RefObject<HTMLElement | null>;
	/** Open the right panel on a page. Most rows' destination. */
	onOpenPanelTab: (tab: "info" | "changes") => void;
	/** Open the Review tab (PR + its checks). */
	onOpenPr: () => void;
	onOpenChecks: () => void;
	/** Open the Assets tab (the Sources list's destination). */
	onOpenAssets?: () => void;
	/** The panel's own bottom-bar places, and their live counts. */
	onOpenPortals?: () => void;
	onOpenAgents?: () => void;
	onOpenTerminal?: () => void;
	livePortals?: number;
	runningAgents?: number;
	/** Prompt the session (Commit) via WS `prompt`. Absent while disconnected. */
	send?: (msg: any) => void;
	/** Bumped when a webhook or an auto-push reports workspace activity. */
	refreshTick?: number;
	/** Lets the session column make room for the floating card while it is open. */
	onOpenChange?: (open: boolean) => void;
	/** The desktop tab strip sits between the header anchor and the transcript. */
	tabStripVisible?: boolean;
}

type SummaryData = {
	pr: PrDetails | null;
	git: GitStatusInfo | null;
	assets: SessionAssetFile[];
	/** Worktree line stats, only fetched when there is no PR to read them from. */
	diff: { additions: number; deletions: number; files: number } | null;
};

/** Last-known state per session, so re-opening the card paints instantly and
 *  revalidates behind the previous answer instead of flashing a skeleton.
 *  Module-level: survives the popup unmounting, dies with the page. */
const lastKnown = new Map<string, SummaryData>();

function emptyData(): SummaryData {
	return { pr: null, git: null, assets: [], diff: null };
}

const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

/** How many sources the card lists before it defers to the Assets tab. The
 *  card scrolls, so this is about the list staying a summary rather than about
 *  the height it would take. */
const SOURCES_SHOWN = 6;

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
	anchor,
	onOpenPanelTab,
	onOpenPr,
	onOpenChecks,
	onOpenAssets,
	onOpenPortals,
	onOpenAgents,
	onOpenTerminal,
	livePortals = 0,
	runningAgents = 0,
	send,
	refreshTick,
	onOpenChange,
	tabStripVisible,
}: Props) {
	const [open, setOpen] = useState(false);
	useEffect(() => () => onOpenChange?.(false), [onOpenChange]);
	function changeOpen(nextOpen: boolean) {
		setOpen(nextOpen);
		onOpenChange?.(nextOpen);
	}
	return (
		<Popover.Root open={open} onOpenChange={changeOpen}>
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
					<IconListCircles size={20} />
				</Popover.Trigger>
			</Tooltip>
			<Popover.Popup
				side="bottom"
				align="end"
				anchor={anchor}
				// Keep the usual 8px air below whichever chrome row is lowest. The
				// desktop tab strip is 40px tall and sits after the header's own 8px
				// inset, so clear both before adding the final 8px gap.
				sideOffset={tabStripVisible ? 56 : 8}
				elevation="lg"
				className={WS_SUMMARY_CARD}
				initialFocus
			>
				{/* Mounted only while open — that is what keeps the fetches off every
				    session that merely has the header. */}
				<SummaryBody
					session={session}
					onOpenPanelTab={onOpenPanelTab}
					onOpenPr={onOpenPr}
					onOpenChecks={onOpenChecks}
					onOpenAssets={onOpenAssets}
					onOpenPortals={onOpenPortals}
					onOpenAgents={onOpenAgents}
					onOpenTerminal={onOpenTerminal}
					livePortals={livePortals}
					runningAgents={runningAgents}
					send={send}
					refreshTick={refreshTick}
					close={() => changeOpen(false)}
				/>
			</Popover.Popup>
		</Popover.Root>
	);
}

function SummaryBody({
	session,
	onOpenPanelTab,
	onOpenPr,
	onOpenChecks,
	onOpenAssets,
	onOpenPortals,
	onOpenAgents,
	onOpenTerminal,
	livePortals = 0,
	runningAgents = 0,
	send,
	refreshTick,
	close,
}: Omit<Props, "anchor" | "onOpenChange" | "tabStripVisible"> & {
	close: () => void;
}) {
	const activeSessionId = useRef(session.id);
	activeSessionId.current = session.id;
	const [data, setData] = useState<SummaryData>(
		() => lastKnown.get(session.id) ?? emptyData(),
	);
	const [prompted, setPrompted] = useState(false);
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
		// the three, which is what makes a cold card fill in rather than appear.
		const prTask = fetchPr(session.id, session.repo || undefined)
			.catch(() => null)
			.then((nextPr) => {
				updateData({ pr: nextPr, ...(nextPr ? { diff: null } : {}) });
				return nextPr;
			});
		const gitTask = fetchGitStatus(session.id, session.repo || undefined)
			.catch(() => null)
			.then((nextGit) => updateData({ git: nextGit }));
		const assetsTask = fetchSessionAssets(session.id)
			.then((response) => response.files)
			.catch(() => [] as SessionAssetFile[])
			.then((nextAssets) => updateData({ assets: nextAssets }));
		const [nextPr] = await Promise.all([prTask, gitTask, assetsTask]);
		if (activeSessionId.current !== session.id) return;
		// Only pay for the worktree patch when the PR cannot answer the same
		// question.
		if (nextPr) return;
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
		load();
		return pollWhileVisible(load, PR_WEBHOOK_FALLBACK_POLL_MS);
	}, [load, session.id]);
	useEffect(() => {
		if (refreshTick) load();
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

	/** Route somewhere else and get out of the way. A card that stayed open
	 *  over the thing it just opened would have to be dismissed by hand. */
	function go(open?: () => void) {
		close();
		open?.();
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
	const sources = assets.slice(0, SOURCES_SHOWN);
	const places = onOpenPortals || onOpenAgents || onOpenTerminal;

	return (
		<>
			<div className={WS_SUMMARY_SECTION}>Workspace</div>

			{changedFiles > 0 && (
				<button
					className={WS_SUMMARY_ROW}
					onClick={() => go(() => onOpenPanelTab("changes"))}
				>
					<IconFile size={15} className={WS_SUMMARY_ICON} />
					<span className={WS_SUMMARY_LABEL}>Changes</span>
					<span className={WS_SUMMARY_COUNT}>
						<span className="text-green">+{additions}</span>{" "}
						<span className="text-red">−{deletions}</span>
					</span>
				</button>
			)}

			{session.repo && (
				<button
					className={WS_SUMMARY_ROW}
					onClick={() => go(() => onOpenPanelTab("info"))}
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
						className={cn(
							WS_SUMMARY_ACTION,
							"opacity-0 group-hover/ws:opacity-100",
						)}
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
					onClick={() => go(onOpenPr)}
					title={`#${pr.number} · ${pr.title}`}
				>
					{/* The glyph carries the PR's own state and the trailing word
					    carries the review's. They answer different questions ("has it
					    landed" vs "is anyone blocking it"), and a merged PR with an old
					    approval on it must not read as open. */}
					<IconPullRequest size={15} className={cn("shrink-0", prTone(pr))} />
					<span className={WS_SUMMARY_LABEL}>{pr.title}</span>
					<span className={cn(WS_SUMMARY_STATE, prStatusLabel(pr).tone)}>
						{prStatusLabel(pr).label}
					</span>
				</button>
			)}

			{pr && checks.total > 0 && (
				<button className={WS_SUMMARY_ROW} onClick={() => go(onOpenChecks)}>
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
				<button className={WS_SUMMARY_ROW} onClick={() => go(onOpenPr)}>
					<IconGitMerge size={15} className="shrink-0 text-red" />
					<span className={WS_SUMMARY_LABEL}>Merge conflicts</span>
					<span className={WS_SUMMARY_ACTION}>Fix</span>
				</button>
			)}

			{behind > 0 && (
				<button
					className={WS_SUMMARY_ROW}
					onClick={() => go(() => onOpenPanelTab("info"))}
				>
					<IconArrowDown size={15} className={WS_SUMMARY_ICON} />
					<span className={WS_SUMMARY_LABEL}>
						{behind} behind {git?.baseBranch || "main"}
					</span>
					<span className={WS_SUMMARY_ACTION}>Pull</span>
				</button>
			)}

			{/* The panel's bottom bar, as rows. These are places rather than
			    readings, so they keep their own band: everything above says where
			    the work stands, everything here goes somewhere. */}
			{places && (
				<>
					<div className={WS_SUMMARY_DIVIDER} />
					<div className={WS_SUMMARY_SECTION}>Places</div>
					{onOpenPortals && (
						<button
							className={WS_SUMMARY_ROW}
							onClick={() => go(onOpenPortals)}
						>
							<IconGlobe size={15} className={WS_SUMMARY_ICON} />
							<span className={WS_SUMMARY_LABEL}>Portals</span>
							{livePortals > 0 && (
								<span className={cn(WS_SUMMARY_COUNT, "text-faint")}>
									{livePortals}
								</span>
							)}
						</button>
					)}
					{onOpenAgents && (
						<button className={WS_SUMMARY_ROW} onClick={() => go(onOpenAgents)}>
							<IconStack size={15} className={WS_SUMMARY_ICON} />
							<span className={WS_SUMMARY_LABEL}>Agents</span>
							{/* Only the live count, as on the bar: a finished run is
							    something you go and read, not something a summary has to
							    keep announcing. */}
							{runningAgents > 0 && (
								<span className={cn(WS_SUMMARY_COUNT, "text-yellow")}>
									{runningAgents}
								</span>
							)}
						</button>
					)}
					{onOpenTerminal && (
						<button
							className={WS_SUMMARY_ROW}
							onClick={() => go(onOpenTerminal)}
						>
							<IconTerminal size={15} className={WS_SUMMARY_ICON} />
							<span className={WS_SUMMARY_LABEL}>Terminal</span>
						</button>
					)}
				</>
			)}

			{sources.length > 0 && (
				<>
					<div className={WS_SUMMARY_DIVIDER} />
					<div className={WS_SUMMARY_SECTION}>Sources</div>
					{sources.map((file) => (
						<button
							key={file.path}
							className={WS_SUMMARY_ROW}
							onClick={() => go(onOpenAssets)}
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
						<button
							className={WS_SUMMARY_ROW}
							onClick={() => go(onOpenAssets)}
						>
							<span className="w-[15px] shrink-0" />
							<span className={cn(WS_SUMMARY_LABEL, "text-dim")}>
								View all {assets.length}
							</span>
						</button>
					)}
				</>
			)}
		</>
	);
}
