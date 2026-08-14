import type { UnifiedSession } from "../lib/types";
import { useReviewTeams } from "../lib/people";
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
}

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

export function People({ sessions, teamViewing }: Props) {
	const currentUser = useCurrentUser();
	const team = useTeamPresence({ sessions, teamViewing, currentUser });
	const orgs = useReviewTeams();
	const filter = useSidebarFilter();
	const lens = personLensValue(filter.person, currentUser);
	const pick = (next: string) => setFilter({ person: personLensFilter(next, currentUser) });

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
				<PageHeader>
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
			</div>
		</div>
	);
}
