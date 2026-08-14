import { useEffect, useState } from "react";
import type { UnifiedSession } from "../lib/types";
import { useReviewTeams } from "../lib/people";
import {
	fetchRecentCommits,
	fetchRecentPrs,
	type RecentCommit,
	type RecentPr,
} from "../lib/api";
import {
	buildWorktreeRows,
	compactAge,
	compactDiff,
	dateGroup,
	personLabel,
} from "../lib/pr-rows";
import { buildFeedRows, type FeedRow } from "../lib/feed-rows";
import { PR_FEED_ROW, PR_GROUP_LABEL, PR_LIST } from "../lib/pr-list-classes";
import { RepoTile, repoLabel } from "./RepoTile";
import { useCurrentUser } from "./UserPicker";
import { UserAvatar } from "./UserAvatar";
import { personLensFilter, setFilter } from "../lib/sidebar-filter";
import {
	presenceState,
	StatusDot,
	useTeamPresence,
	type TeamMember,
} from "./TeamPresence";
import { PageDescription, PageHeader, PageTitle } from "../ui/page-header";
import { EmptyState } from "../ui/state";
import { cn } from "../ui/cn";
import { IconFeed, IconPeople } from "./icons";
import {
	PEOPLE_CHIP,
	PEOPLE_CHIP_GLYPH,
	PEOPLE_CHIP_ROW,
	PEOPLE_CHIP_SELECTED,
	PEOPLE_SECTION_LABEL,
} from "../lib/people-classes";

/**
 * What the team has been shipping.
 *
 * The page is the feed. The team is the row above it, because who shipped it
 * is how you narrow the feed, not a destination of its own — there is no
 * per-person page to open, since everything you would put on one already
 * exists as their sidebar.
 *
 * So picking a teammate does two things at once, which is the point: it
 * narrows the feed to their merges, and it hands you their sidebar. Picking
 * an organization narrows the feed to its members; the sidebar's lens holds
 * one person, so it goes back to everyone rather than staying on whoever you
 * had before.
 */

interface Props {
	sessions: UnifiedSession[];
	/** Who's viewing what right now (global presence), for the face dots. */
	teamViewing?: Array<{ user: string; sessionId: string }>;
	onSelect: (session: UnifiedSession) => void;
}

/** How much of the feed to keep on screen. Far enough back to cover a quiet
 *  fortnight; past that it stops being what's happening and starts being
 *  history, which the Pull requests list holds properly. */
const FEED_LIMIT = 80;

/** Everyone, one person, or one organization's members. */
type Scope =
	| { kind: "everyone" }
	| { kind: "person"; key: string }
	| { kind: "org"; github: string; members: string[] };

function ScopeChip({
	selected,
	onClick,
	mark,
	label,
}: {
	selected: boolean;
	onClick: () => void;
	mark: React.ReactNode;
	label: string;
}) {
	return (
		<button
			className={cn(PEOPLE_CHIP, selected && PEOPLE_CHIP_SELECTED)}
			onClick={onClick}
			aria-pressed={selected}
		>
			{mark}
			<span className="min-w-0 truncate">{label}</span>
		</button>
	);
}

export function Feed({ sessions, teamViewing, onSelect }: Props) {
	const currentUser = useCurrentUser();
	const team = useTeamPresence({ sessions, teamViewing, currentUser });
	const orgs = useReviewTeams();
	const [scope, setScope] = useState<Scope>({ kind: "everyone" });

	// You first, then the team in the order `useTeamPresence` already sorted
	// them: working, then online, then whoever moved most recently.
	const chips = [...team].sort((a, b) => Number(b.isYou) - Number(a.isYou));
	const byKey = new Map(team.map((m) => [m.key, m]));

	// Picking a person is also the sidebar you turn to. An organization has no
	// single-person lens to be, so it clears back to everyone rather than
	// leaving the sidebar on whoever you had picked before.
	const pick = (next: Scope) => {
		setScope(next);
		setFilter({
			person: personLensFilter(
				next.kind === "person" ? next.key : "everyone",
				currentUser,
			),
		});
	};

	const [recentPrs, setRecentPrs] = useState<RecentPr[]>([]);
	const [personPrs, setPersonPrs] = useState<RecentPr[]>([]);
	// Repos that ship without pull requests — Open Session's own — say what
	// they shipped in commits instead, and land in the same list.
	const [commits, setCommits] = useState<RecentCommit[]>([]);
	useEffect(() => {
		let active = true;
		fetchRecentPrs()
			.then((prs) => active && setRecentPrs(prs))
			.catch(() => {});
		fetchRecentCommits()
			.then((rows) => active && setCommits(rows))
			.catch(() => {});
		return () => {
			active = false;
		};
	}, []);
	// One person's own merges, on top of the global list: that list is capped
	// across the whole team, so a quiet fortnight would drop someone out of
	// their own feed.
	const scopedPerson = scope.kind === "person" ? scope.key : null;
	useEffect(() => {
		if (!scopedPerson) {
			setPersonPrs([]);
			return;
		}
		let active = true;
		fetchRecentPrs(scopedPerson)
			.then((prs) => active && setPersonPrs(prs))
			.catch(() => {});
		return () => {
			active = false;
		};
	}, [scopedPerson]);

	const inScope = (person: string | null) => {
		if (scope.kind === "everyone") return true;
		if (scope.kind === "person") return person === scope.key;
		return !!person && scope.members.includes(person);
	};
	const prs = new Map(recentPrs.map((pr) => [pr.url, pr]));
	for (const pr of personPrs) prs.set(pr.url, pr);
	const merged = buildWorktreeRows([...prs.values()], sessions).filter(
		(row) => row.state === "MERGED",
	);
	const shipped = buildFeedRows(merged, commits).filter((row) => inScope(row.person));
	const groups = new Map<string, FeedRow[]>();
	for (const row of shipped.slice(0, FEED_LIMIT)) {
		const label = dateGroup(row.shippedAt);
		groups.set(label, [...(groups.get(label) || []), row]);
	}
	const days = [...groups.entries()];

	const scopeName =
		scope.kind === "person"
			? personLabel(scope.key)
			: scope.kind === "org"
				? orgs.find((o) => o.github === scope.github)?.name
				: null;

	return (
		// The page frame every other list page in the app uses: one centred
		// column at the shared width and padding, a PageHeader on top.
		<div className="min-h-0 w-full flex-1 overflow-y-auto bg-surface">
			<div className="mx-auto w-full max-w-[920px] px-6 pb-15 pt-7 max-[560px]:px-4 max-[560px]:pb-12 max-[560px]:pt-[18px]">
				<PageHeader>
					<div className="min-w-0">
						<PageTitle>Feed</PageTitle>
						<PageDescription>
							What the team has been shipping. Pick someone to narrow it, and to
							put their workspaces in the sidebar.
						</PageDescription>
					</div>
				</PageHeader>

				{team.length > 0 && (
					<div className={PEOPLE_CHIP_ROW}>
						<ScopeChip
							selected={scope.kind === "everyone"}
							onClick={() => pick({ kind: "everyone" })}
							mark={
								<span className={PEOPLE_CHIP_GLYPH}>
									<IconPeople size={17} />
								</span>
							}
							label="Everyone"
						/>
						{chips.map((member) => (
							<ScopeChip
								key={member.key}
								selected={scope.kind === "person" && scope.key === member.key}
								onClick={() => pick({ kind: "person", key: member.key })}
								mark={
									// The face carries whether they're around. The dot rings
									// itself in the chip's own fill so it reads as a gap in the
									// picture rather than a mark on it.
									<span className="relative flex">
										<UserAvatar name={member.person.name} size={26} />
										<StatusDot
											state={presenceState(member)}
											ring={
												scope.kind === "person" && scope.key === member.key
													? "color-mix(in srgb, var(--text) 10%, var(--bg-surface))"
													: "var(--bg-panel)"
											}
											size={8}
										/>
									</span>
								}
								label={member.isYou ? "You" : member.person.name}
							/>
						))}
						{orgs.map((org) => {
							const members = org.members.map((name) => name.trim().toLowerCase());
							const faces = members
								.map((key) => byKey.get(key))
								.filter((m): m is TeamMember => !!m)
								.slice(0, 3);
							return (
								<ScopeChip
									key={org.github}
									selected={scope.kind === "org" && scope.github === org.github}
									onClick={() => pick({ kind: "org", github: org.github, members })}
									mark={
										// An organization wears its members rather than a glyph:
										// it is the people, and the pile says which ones without
										// spending a line on names.
										<span className="flex shrink-0 items-center pl-0.5">
											{faces.map((m, i) => (
												<span
													key={m.key}
													className="relative flex"
													style={{ marginLeft: i === 0 ? 0 : -8, zIndex: faces.length - i }}
												>
													<UserAvatar
														name={m.person.name}
														size={26}
														style={{ boxShadow: "var(--avatar-edge), 0 0 0 2px var(--bg-panel)" }}
													/>
												</span>
											))}
										</span>
									}
									label={org.name}
								/>
							);
						})}
					</div>
				)}

				{recentPrs.length === 0 && commits.length === 0 ? (
					<EmptyState icon={<IconFeed size={22} />} title="Nothing yet">
						Work shows up here as the team ships it.
					</EmptyState>
				) : days.length === 0 ? (
					// The heading stays rather than disappearing: a picked teammate with
					// nothing shipped is an answer, and a page that empties itself as you
					// click faces reads as a bug.
					<EmptyState title="Nothing shipped yet">
						{scopeName
							? `${scopeName} hasn't shipped anything recently.`
							: "Merged pull requests and commits show up here."}
					</EmptyState>
				) : (
					<>
						<h3 className={PEOPLE_SECTION_LABEL}>
							{scopeName ? `${scopeName} shipped` : "Shipped"}
						</h3>
						<div className={PR_LIST}>
							{days.map(([label, rows]) => (
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
												title={`${repoLabel(row.repo)}${row.ref ? ` · ${row.ref}` : ""}`}
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
														{row.ref && (
															<span className="shrink-0 text-meta tabular-nums text-faint">
																{row.ref}
															</span>
														)}
													</span>
													<span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-meta text-faint">
														<span className="truncate">{repoLabel(row.repo)}</span>
													</span>
												</span>
												{/* A side that moved no lines is left off rather than
												    written as a zero: every commit carries both counts. */}
												<span className="justify-self-end text-meta tabular-nums phone:hidden">
													{!!row.additions && (
														<span className="text-green">+{compactDiff(row.additions)}</span>
													)}
													{!!row.deletions && (
														<span className="ml-2 text-red">−{compactDiff(row.deletions)}</span>
													)}
												</span>
												<span className="justify-self-end text-meta tabular-nums text-faint">
													{compactAge(row.shippedAt)}
												</span>
											</button>
										))}
									</div>
								</div>
							))}
						</div>
					</>
				)}
			</div>
		</div>
	);
}
