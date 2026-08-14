import { useEffect, useState } from "react";
import type { UnifiedSession } from "../lib/types";
import { useReviewTeams } from "../lib/people";
import { fetchRecentPrs, type RecentPr } from "../lib/api";
import {
	buildWorktreeRows,
	compactAge,
	compactDiff,
	dateGroup,
	personLabel,
} from "../lib/pr-rows";
import { PR_FEED_ROW, PR_GROUP_LABEL, PR_LIST } from "../lib/pr-list-classes";
import { RepoTile, repoLabel } from "./RepoTile";
import { useCurrentUser } from "./UserPicker";
import { UserAvatar } from "./UserAvatar";
import {
	personLensFilter,
	personLensValue,
	setFilter,
	useSidebarFilter,
} from "../lib/sidebar-filter";
import {
	presenceLabel,
	presenceState,
	StatusDot,
	useTeamPresence,
	type TeamMember,
} from "./TeamPresence";
import { PageDescription, PageHeader, PageTitle } from "../ui/page-header";
import { EmptyState } from "../ui/state";
import { cn } from "../ui/cn";
import { IconCheck, IconPeople } from "./icons";
import {
	PEOPLE_CARD,
	PEOPLE_CARD_SELECTED,
	PEOPLE_GRID,
	PEOPLE_INSET,
	PEOPLE_ORG_CARD,
	PEOPLE_ORG_MEMBER,
	PEOPLE_SECTION_LABEL,
} from "../lib/people-classes";

/**
 * The team, as a place you can go.
 *
 * Picking someone here sets the app's person lens, which is the sidebar you
 * then work in. That is the whole interaction: there is no per-person page to
 * open, because everything you would put on one already exists as their
 * sidebar. So the page stays put when you pick, and says who it switched to.
 */

interface Props {
	sessions: UnifiedSession[];
	/** Who's viewing what right now (global presence), for the status lines. */
	teamViewing?: Array<{ user: string; sessionId: string }>;
	onSelect: (session: UnifiedSession) => void;
}

/** How much of the feed to keep on screen. Far enough back to cover a quiet
 *  week; past that it stops being what's happening and starts being history,
 *  which the Pull requests list holds properly. */
const FEED_LIMIT = 40;

function PersonCard({
	member,
	selected,
	onPick,
}: {
	member: TeamMember;
	selected: boolean;
	onPick: (key: string) => void;
}) {
	return (
		<button
			className={cn(PEOPLE_CARD, selected && PEOPLE_CARD_SELECTED)}
			onClick={() => onPick(member.key)}
			aria-pressed={selected}
		>
			{/* The face carries whether they're around; the line under the name
			    says the same thing in words, so the colour isn't alone. The dot
			    rings itself in the card's own fill to cut a gap into the picture,
			    and steps to the selected fill so it stays a gap there too. That
			    fill is translucent ink over the page, so the ring mixes the same
			    step rather than naming a surface token that doesn't exist. */}
			<span className="relative flex">
				<UserAvatar name={member.person.name} size={34} />
				<StatusDot
					state={presenceState(member)}
					ring={
						selected
							? "color-mix(in srgb, var(--text) 10%, var(--bg-surface))"
							: "var(--bg-panel)"
					}
					size={9}
				/>
			</span>
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<span className="truncate text-control-label font-medium text-fg">
					{member.isYou ? `${member.person.fullName} (you)` : member.person.fullName}
				</span>
				{/* What they're on, in the same words the lens menu's tooltip uses.
				    It is the reason to look at this page at all, so it gets the
				    second line rather than a hover. */}
				<span className="truncate text-meta text-dim">{presenceLabel(member)}</span>
			</span>
			{selected && <IconCheck className="shrink-0 text-accent" size={17} />}
		</button>
	);
}

export function People({ sessions, teamViewing, onSelect }: Props) {
	const currentUser = useCurrentUser();
	const team = useTeamPresence({ sessions, teamViewing, currentUser });
	const orgs = useReviewTeams();
	const filter = useSidebarFilter();
	const lens = personLensValue(filter.person, currentUser);
	const pick = (next: string) => setFilter({ person: personLensFilter(next, currentUser) });

	// What the team has been shipping. Unscoped once, plus that person's own
	// merges when the lens is on someone, because the recent list is capped
	// globally and a quiet week would otherwise drop them out of their own feed.
	const [recentPrs, setRecentPrs] = useState<RecentPr[]>([]);
	const [personPrs, setPersonPrs] = useState<RecentPr[]>([]);
	useEffect(() => {
		let active = true;
		fetchRecentPrs()
			.then((prs) => active && setRecentPrs(prs))
			.catch(() => {});
		return () => {
			active = false;
		};
	}, []);
	const lensPerson = lens === "everyone" || lens === "unassigned" ? null : lens;
	useEffect(() => {
		if (!lensPerson) {
			setPersonPrs([]);
			return;
		}
		let active = true;
		fetchRecentPrs(lensPerson)
			.then((prs) => active && setPersonPrs(prs))
			.catch(() => {});
		return () => {
			active = false;
		};
	}, [lensPerson]);

	const shipped = (() => {
		const prs = new Map(recentPrs.map((pr) => [pr.url, pr]));
		for (const pr of personPrs) prs.set(pr.url, pr);
		const merged = buildWorktreeRows([...prs.values()], sessions).filter(
			(row) => row.state === "MERGED" && (!lensPerson || row.person === lensPerson),
		);
		const groups = new Map<string, typeof merged>();
		for (const row of merged.slice(0, FEED_LIMIT)) {
			groups.set(dateGroup(row.updatedAt), [...(groups.get(dateGroup(row.updatedAt)) || []), row]);
		}
		return { count: merged.length, groups: [...groups.entries()] };
	})();

	// You first, then the team in the order `useTeamPresence` already sorted
	// them: working, then online, then whoever moved most recently. Your own
	// tile leads because it is the lens you come back to.
	const rows = [...team].sort((a, b) => Number(b.isYou) - Number(a.isYou));
	const byKey = new Map(team.map((m) => [m.key, m]));

	return (
		// The page frame every other list page in the app uses: one centred
		// column at the shared width and padding, a PageHeader on top.
		<div className="min-h-0 w-full flex-1 overflow-y-auto bg-surface">
			<div className="mx-auto w-full max-w-[920px] px-6 pb-15 pt-7 max-[560px]:px-4 max-[560px]:pb-12 max-[560px]:pt-[18px]">
				<PageHeader className={PEOPLE_INSET}>
					<div className="min-w-0">
						<PageTitle>People</PageTitle>
						<PageDescription>
							Pick someone to put their workspaces in the sidebar.
						</PageDescription>
					</div>
				</PageHeader>

				{team.length === 0 ? (
					<EmptyState icon={<IconPeople size={22} />} title="No teammates yet">
						People appear here once the server's identity config names them.
					</EmptyState>
				) : (
					<div className={PEOPLE_GRID}>
						{rows.map((member) => (
							<PersonCard
								key={member.key}
								member={member}
								selected={lens === member.key}
								onPick={pick}
							/>
						))}
						{/* The way back out of a person, in the same words the lens menu
						    and the sidebar header use for it. It sits in the grid rather
						    than off in a corner because it is one more thing the lens can
						    be, not a reset button. */}
						<button
							className={cn(PEOPLE_CARD, lens === "everyone" && PEOPLE_CARD_SELECTED)}
							onClick={() => pick("everyone")}
							aria-pressed={lens === "everyone"}
						>
							<span className="flex size-[34px] shrink-0 items-center justify-center rounded-[32%] bg-hover text-dim">
								<IconPeople size={20} />
							</span>
							<span className="flex min-w-0 flex-1 flex-col gap-0.5">
								<span className="truncate text-control-label font-medium text-fg">
									All workspaces
								</span>
								<span className="truncate text-meta text-dim">Everyone's work</span>
							</span>
							{lens === "everyone" && (
								<IconCheck className="shrink-0 text-accent" size={17} />
							)}
						</button>
					</div>
				)}

				{orgs.length > 0 && (
					<>
						<h3 className={PEOPLE_SECTION_LABEL}>Organizations</h3>
						<div className="flex flex-col gap-2">
							{orgs.map((org) => {
								const members = org.members
									.map((name) => byKey.get(name.trim().toLowerCase()))
									.filter((m): m is TeamMember => !!m);
								return (
									<div key={org.github} className={PEOPLE_ORG_CARD}>
										<div className="flex min-w-0 items-baseline gap-2">
											<span className="truncate text-control-label font-medium text-fg">
												{org.name}
											</span>
											<span className="truncate text-meta text-faint">
												{org.github}
											</span>
										</div>
										{members.length > 0 && (
											<div className="mt-2 -ml-1 flex flex-wrap">
												{members.map((member) => (
													<button
														key={member.key}
														className={PEOPLE_ORG_MEMBER}
														onClick={() => pick(member.key)}
														aria-pressed={lens === member.key}
														title={presenceLabel(member)}
													>
														<span className="relative flex">
															<UserAvatar
																name={member.person.name}
																size={30}
																style={
																	lens === member.key
																		? {
																				outline: "2px solid var(--accent)",
																				outlineOffset: "1px",
																			}
																		: undefined
																}
															/>
															<StatusDot
																state={presenceState(member)}
																ring="var(--bg-panel)"
																size={8}
															/>
														</span>
														<span className="w-full truncate text-meta text-dim">
															{member.person.name}
														</span>
													</button>
												))}
											</div>
										)}
									</div>
								);
							})}
						</div>
					</>
				)}

				{/* What the team has actually been shipping, newest first. The grid
				    above says who is around; this says what came of it, and picking
				    a face narrows both at once. Merged only: an open pull request
				    is work in progress, and the Pull requests list is where you go
				    to act on those. */}
				{recentPrs.length > 0 && (
					<>
						<h3 className={PEOPLE_SECTION_LABEL}>
							{lensPerson ? `${personLabel(lensPerson)} shipped` : "Shipped"}
						</h3>
						{shipped.groups.length === 0 ? (
							// The section stays rather than disappearing: a picked teammate
							// with nothing merged is an answer, and a heading that comes
							// and goes as you click faces reads as a bug.
							<EmptyState title="Nothing merged yet">
								{lensPerson
									? `${personLabel(lensPerson)} hasn't merged a pull request recently.`
									: "Merged pull requests show up here."}
							</EmptyState>
						) : (
						<div className={PR_LIST}>
							{shipped.groups.map(([label, rows]) => (
								<div key={label} className="mb-4">
									<h4 className={PR_GROUP_LABEL}>
										{label}
										<span className="font-medium">{rows.length}</span>
									</h4>
									<div>
										{rows.map((row) => (
											<button
												key={row.key}
												className={PR_FEED_ROW}
												onClick={() =>
													row.session
														? onSelect(row.session)
														: row.url && window.open(row.url, "_blank", "noopener")
												}
												title={`${repoLabel(row.repo)} · ${row.branch}`}
											>
												{/* Who shipped it, or the repo when the author isn't a
												    teammate: the column always says where it came from. */}
												{row.person ? (
													<UserAvatar
														name={personLabel(row.person)}
														size={24}
														title={personLabel(row.person)}
													/>
												) : (
													<RepoTile name={row.repo} size={24} />
												)}
												<span className="min-w-0">
													<span className="flex min-w-0 items-baseline gap-2">
														<span className="truncate text-body font-medium leading-[1.3] text-fg">
															{row.title}
														</span>
														{row.number && (
															<span className="shrink-0 text-meta tabular-nums text-faint">
																#{row.number}
															</span>
														)}
													</span>
													<span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-meta text-faint">
														<span className="truncate">{repoLabel(row.repo)}</span>
													</span>
												</span>
												<span className="justify-self-end text-meta tabular-nums phone:hidden">
													{row.additions !== undefined && (
														<span className="text-green">+{compactDiff(row.additions)}</span>
													)}
													{row.deletions !== undefined && (
														<span className="ml-2 text-red">−{compactDiff(row.deletions)}</span>
													)}
												</span>
												<span className="justify-self-end text-meta tabular-nums text-faint">
													{compactAge(row.updatedAt)}
												</span>
											</button>
										))}
									</div>
								</div>
							))}
						</div>
						)}
					</>
				)}
			</div>
		</div>
	);
}
