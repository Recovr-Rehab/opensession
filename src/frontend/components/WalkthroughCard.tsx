import { useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { SessionWalkthrough } from "../lib/types";
import { renderMarkdown } from "../lib/markdown";
import { relativeTime } from "../lib/api";
import { cn } from "../ui/cn";
import { duration, ease } from "../ui/motion";
import { IconChevronDown, IconPlayRectangle } from "./icons";
import { MarkdownBody, useMarkdownRepo } from "./MarkdownBody";
import { openLightbox, type LightboxItem } from "./MediaLightbox";

/** Stream server-side media (staged under the uploads dir) through the
 *  existing scoped media route — same URL shape MessageBubble uses. */
const mediaUrl = (path: string) => `/media?path=${encodeURIComponent(path)}`;

/**
 * The Before/After label: the app's own status pill, resting in the tile's top
 * left. Panel surface, a --red-soft/--green-soft tint, --red/--green ink and a
 * hairline — the same parts every other pill in the product is made of, so it
 * reads as a caption the app put on the picture rather than as a sticker.
 *
 * Because it is opaque it reads on a white screenshot and on a dark one alike,
 * so it can simply follow the app theme instead of sampling the image under
 * it. A drop shadow under the hairline is what lifts it off the picture, now
 * that the tile's corner no longer holds it in place.
 *
 * `rounded-[999px]`, not `rounded-full`: base.css grants squircle corners to
 * every `rounded-*` except that one spelling, and a pill is where the squircle
 * belongs.
 *
 * The tint is a gradient because it has to sit ON the panel fill: --red-soft
 * is translucent ink, and painted straight onto the picture it is the wash
 * that let a white screenshot through in the first place.
 */
const SHOT_LABEL =
	"pointer-events-none absolute left-2 top-2 rounded-[999px] bg-panel px-2 py-0.5 text-[11px] font-semibold leading-4 shadow-[inset_0_0_0_1px_var(--border),0_1px_3px_oklch(0_0_0_/_0.16)]";
const SHOT_LABEL_SIDE = {
	before:
		"text-red [background-image:linear-gradient(var(--red-soft),var(--red-soft))]",
	after:
		"text-green [background-image:linear-gradient(var(--green-soft),var(--green-soft))]",
} as const;

/**
 * The agent-published walkthrough (opensession-walkthrough): demo video +
 * before/after screenshot pairs + writeup. Rendered at the top of the PR info
 * column in the Review tab (`panel`), and inline in the session where the agent
 * published it (`session`) — the video plays right there instead of only living
 * behind a tab. Both are the inline counterpart of the link-only section
 * mirrored into the GitHub PR description.
 *
 * In the session it arrives as one folded row. Opening it also widens the card:
 * the compact state belongs to the transcript's reading column, while paired
 * screenshots need more room to be useful. Width and body move together, so
 * the disclosure explains where that extra space came from instead of snapping
 * between two unrelated layouts. In the Review tab the card IS the content of
 * the column, so it stays open.
 */
export function WalkthroughCard({
	walkthrough,
	variant = "panel",
}: {
	walkthrough: SessionWalkthrough;
	variant?: "panel" | "session";
}) {
	const session = variant === "session";
	const [expanded, setExpanded] = useState(!session);
	const reduceMotion = useReducedMotion();
	const repo = useMarkdownRepo();
	const summaryHtml = useMemo(
		() => renderMarkdown(walkthrough.summary, { repo }),
		[walkthrough.summary, repo],
	);
	// Every piece of media in the card, in render order, so clicking one opens
	// the shared lightbox (Escape/arrows/pinch-zoom/download) browsing
	// demo→before→after across all the pairs.
	const gallery = useMemo(() => {
		const items: LightboxItem[] = [];
		const at = new Map<string, number>();
		if (walkthrough.video) {
			at.set("video", items.length);
			items.push({
				kind: "video",
				src: mediaUrl(walkthrough.video),
				sessionTitle: walkthrough.videoTitle || "Demo",
			});
		}
		let stillCount = 0;
		(walkthrough.shots || []).forEach((shot, i) => {
			for (const side of ["before", "after"] as const) {
				const path = shot[side];
				if (!path) continue;
				at.set(`${i}:${side}`, items.length);
				stillCount += 1;
				items.push({
					kind: "image",
					src: mediaUrl(path),
					sessionTitle: [shot.caption, side === "before" ? "Before" : "After"]
						.filter(Boolean)
						.join(" · "),
				});
			}
		});
		return { items, at, stillCount };
	}, [walkthrough.shots, walkthrough.video, walkthrough.videoTitle]);

	// What the card holds, for the folded header — the one thing a reader needs
	// to decide whether to open it. Open, they can see that for themselves, so
	// the slot goes back to saying when it was published.
	const contentsLabel =
		[
			walkthrough.video ? "Demo" : "",
			gallery.stillCount
				? `${gallery.stillCount} still${gallery.stillCount === 1 ? "" : "s"}`
				: "",
		]
			.filter(Boolean)
			.join(" · ") || (walkthrough.summary ? "Writeup" : "");
	const open = (key: string, target: HTMLElement) =>
		openLightbox(gallery.items, gallery.at.get(key) ?? 0, target);

	return (
		<div
			className={cn(
				// White in light mode, with only a close edge shadow. The walkthrough
				// should read as finished proof, not a panel floating over the transcript.
				"rounded-xl border border-line/60 bg-surface p-4 smooth-shadow-xs",
				// In the session the card is a transcript block like any other, so it
				// takes the same centered reading column the turns and footers use
				// (mx-auto + --session-col) instead of spanning the whole pane. It
				// trails more space than it leads: unlike the neighbouring blocks
				// it ends in media, which otherwise butts straight into the next
				// message.
				session &&
					"mx-auto mb-6 mt-2 w-full transition-[max-width] duration-[var(--dur-lg)] ease-[var(--ease)]",
				session && !expanded && "max-w-[var(--session-col)]",
				// Opened, it stops being a line in the conversation and becomes the
				// thing you are looking at, so it takes the room the pane has —
				// where the reading column is a limit the media never asked for. A
				// before and an after sit side by side, so each of them is half of
				// whatever the card gets: at the 780px column, two desktop
				// screenshots come out ~370px wide, which is too small to see what
				// changed in the picture you opened the card to check. The prose
				// keeps its own measure (the summary caps at 68ch), and the ceiling
				// keeps the card from running the width of a large display.
				session && expanded && "max-w-[min(1120px,100%)]",
				!session && "mb-4",
			)}
		>
			{session ? (
				<div className="flex items-center gap-2">
					<button
						type="button"
						aria-expanded={expanded}
						onClick={() => setExpanded(!expanded)}
						// Keep the fold's 14px title and 20px chevron. The play-in-screen
						// glyph mirrors the native app without adding another icon tile.
						// The row is the height of its own contents, like the turn fold
						// it sits among — a 40px row spent 20 of them holding the title
						// away from a card edge that already has padding of its own, so
						// the header read as a band and the folded card as a panel.
						// The hover is the turn fold's: a half-strength wash, which on a
						// row this wide is the difference between saying "this is live"
						// and lighting a slab the size of the card. The chevron takes
						// the rest of it, at its own scale — the whole row folds, but
						// the chevron is what a reader is aiming at.
						className="group -m-1 flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent p-1 text-left font-sans text-[14px] leading-5 text-dim outline-none transition-colors hover:bg-hover/40 focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]"
					>
						{/* The walkthrough's own icon leads the line, so the row is
					    named before it is operated; the chevron trails at the far
					    edge, where it reads as this card's disclosure rather than
					    as another indent level in the transcript. */}
						<IconPlayRectangle size={20} className="flex-shrink-0 text-faint" />
						<span className="flex-shrink-0 font-semibold text-fg">
							Walkthrough
						</span>
						<span className="ml-auto max-w-40 flex-shrink truncate text-label leading-4 text-faint phone:max-w-24">
							{expanded
								? walkthrough.publishedAt
									? relativeTime(walkthrough.publishedAt)
									: ""
								: contentsLabel}
						</span>
						<span
							className={cn(
								"grid size-5 flex-shrink-0 place-items-center leading-none text-faint transition-[transform,color] duration-150 group-hover:text-dim",
								!expanded && "-rotate-90",
							)}
						>
							<IconChevronDown size={20} className="block" />
						</span>
					</button>
				</div>
			) : (
				<div className="mb-2 flex items-center gap-1.5">
					<IconPlayRectangle size={20} className="text-faint" />
					<span className="text-xs font-semibold text-dim">Walkthrough</span>
				</div>
			)}

			<AnimatePresence initial={false}>
				{expanded && (
					<motion.div
						key="walkthrough-body"
						initial={
							reduceMotion
								? { opacity: 0 }
								: { height: 0, opacity: 0, transform: "translateY(-6px)" }
						}
						animate={
							reduceMotion
								? { opacity: 1 }
								: { height: "auto", opacity: 1, transform: "translateY(0px)" }
						}
						exit={
							reduceMotion
								? { opacity: 0 }
								: { height: 0, opacity: 0, transform: "translateY(-4px)" }
						}
						transition={{
							type: "tween",
							duration: reduceMotion ? 0 : duration.large,
							ease,
						}}
						className={session ? "overflow-hidden" : undefined}
					>
						<div
							className={cn(
								"space-y-5",
								session ? "mt-3 border-t border-line/60 pt-4" : "mt-3",
							)}
						>
							<section className="px-0.5">
								<h3 className="m-0 mb-1.5 text-[11px] font-semibold leading-4 text-faint">
									Summary
								</h3>
								<MarkdownBody
									html={summaryHtml}
									className="markdown max-w-[68ch] text-[13px] leading-5 text-dim [overflow-wrap:anywhere] [text-wrap:pretty]"
								/>
							</section>

							{walkthrough.video && (
								<figure className="m-0">
									<figcaption className="mb-2 flex min-h-5 items-center gap-2 px-0.5 text-xs font-medium text-fg">
										<span className="size-1.5 flex-shrink-0 rounded-full bg-blue" />
										<span className="flex-shrink-0">Demo</span>
										{walkthrough.videoTitle && (
											<span className="min-w-0 truncate font-normal text-faint">
												{walkthrough.videoTitle}
											</span>
										)}
									</figcaption>
									<video
										className={cn(
											"w-full rounded-md bg-black shadow-[0_0_0_1px_var(--border)]",
											session && "max-h-[60vh] object-contain",
										)}
										src={mediaUrl(walkthrough.video)}
										controls
										preload="metadata"
										title={walkthrough.videoTitle || "Demo video"}
									/>
								</figure>
							)}

							{(walkthrough.shots || []).map((shot, i) => {
								const paired = Boolean(shot.before && shot.after);
								return (
									<section key={i}>
										{shot.caption && (
											<h3 className="m-0 px-0.5 pb-2 text-xs font-medium leading-5 text-fg">
												{shot.caption}
											</h3>
										)}
										<div
											className={cn(
												"grid gap-2.5",
												paired
													? "grid-cols-2 phone:grid-cols-1"
													: "grid-cols-1",
											)}
										>
											{(["before", "after"] as const).map(
												(side) =>
													shot[side] && (
														<figure className="m-0 min-w-0" key={side}>
															<button
																type="button"
																className="relative flex w-full cursor-zoom-in items-start justify-center overflow-hidden rounded-md border-0 bg-surface p-0 text-left outline-none transition-[filter] hover:brightness-[0.98] focus-visible:shadow-[inset_0_0_0_3px_var(--accent-soft)]"
																onClick={(event) =>
																	open(`${i}:${side}`, event.currentTarget)
																}
															>
																<img
																	className={cn(
																		"block object-contain object-top",
																		// A cap on HEIGHT costs a PORTRAIT shot its
																		// width too: a phone screenshot is about
																		// twice as tall as it is wide, so every
																		// point off the ceiling takes half a point
																		// off the picture. At 256px one rendered
																		// ~120px across — a column of grey. 384
																		// still leaves the pair, the writeup above
																		// it and the next block in view.
																		session ? "max-h-96 max-w-full" : "w-full",
																	)}
																	src={mediaUrl(shot[side]!)}
																	alt={`${shot.caption || "change"} · ${side}`}
																	loading="lazy"
																/>
																<span
																	className={cn(
																		SHOT_LABEL,
																		SHOT_LABEL_SIDE[side],
																	)}
																>
																	{side === "before" ? "Before" : "After"}
																</span>
															</button>
														</figure>
													),
											)}
										</div>
									</section>
								);
							})}
						</div>
					</motion.div>
				)}
			</AnimatePresence>
		</div>
	);
}
