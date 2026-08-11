import React, { useMemo, useState } from "react";
import type { SessionWalkthrough } from "../lib/types";
import { renderMarkdown } from "../lib/markdown";
import { relativeTime } from "../lib/api";
import { cn } from "../ui/cn";
import { IconChevronDown, IconPlay, IconPlayRectangle } from "./icons";
import { MarkdownBody, useMarkdownRepo } from "./MarkdownBody";
import { openLightbox, type LightboxItem } from "./MediaLightbox";

/** Stream server-side media (staged under the uploads dir) through the
 *  existing scoped media route — same URL shape MessageBubble uses. */
const mediaUrl = (path: string) => `/media?path=${encodeURIComponent(path)}`;

/**
 * The agent-published walkthrough (opensession-walkthrough): demo video +
 * before/after screenshot pairs + writeup. Rendered at the top of the PR info
 * column in the Review tab (`panel`), and inline in the session where the agent
 * published it (`session`) — the video plays right there instead of only living
 * behind a tab. Both are the inline counterpart of the link-only section
 * mirrored into the GitHub PR description.
 *
 * In the session it folds and arrives folded, the way the native app's card
 * does: a walkthrough is a screenful of video plus a screenful per before/after
 * pair, and in a session that published several the conversation is mostly
 * walkthrough. Folded is not hidden — the card keeps a sideways strip of its
 * stills, and clicking one opens the same lightbox the open card does, so
 * checking what changed doesn't cost unfolding the demo to get to it. In the
 * Review tab the card IS the content of the column, so it stays open.
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
						.join(" — "),
				});
			}
		});
		return { items, at, stillCount };
	}, [walkthrough.shots, walkthrough.video, walkthrough.videoTitle]);

	// What the card holds, for the folded header — the one thing a reader needs
	// to decide whether to open it. Open, they can see that for themselves, so
	// the slot goes back to saying when it was published.
	const contentsLabel = [
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
				// One outline keeps the walkthrough together in both states. The
				// interior stays flat; only the actual media has another edge.
				"rounded-xl border border-line/60 bg-transparent p-4",
				// In the session the card is a transcript block like any other, so it
				// takes the same centered reading column the turns and footers use
				// (mx-auto + --session-col) instead of spanning the whole pane. It
				// trails more space than it leads: unlike the neighbouring blocks
				// it ends in media, which otherwise butts straight into the next
				// message.
				session && "mx-auto mb-6 mt-2 w-full",
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
				session && expanded && "max-w-[min(1040px,100%)]",
				!session && "mb-4",
			)}
		>
			{session ? (
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
					className="group -m-1 flex w-full min-w-0 cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent p-1 text-left font-sans text-[14px] leading-5 text-dim outline-none transition-colors hover:bg-hover/40 focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]"
				>
					{/* The walkthrough's own icon leads the line, so the row is
					    named before it is operated; the chevron trails at the far
					    edge, where it reads as this card's disclosure rather than
					    as another indent level in the transcript. */}
					<IconPlayRectangle size={20} className="flex-shrink-0 text-faint" />
					<span className="flex min-w-0 items-baseline gap-1.5">
						<span className="flex-shrink-0 font-semibold text-fg">Walkthrough</span>
						{walkthrough.publishedBy && (
							<span className="min-w-0 truncate text-label leading-4 text-faint phone:hidden">
								by {walkthrough.publishedBy}
							</span>
						)}
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
			) : (
				<div className="mb-2 flex items-center gap-1.5">
					<IconPlayRectangle size={20} className="text-faint" />
					<span className="text-xs font-semibold text-dim">Walkthrough</span>
				</div>
			)}

			{!expanded && gallery.items.length > 0 && (
				// The folded card's media: one fixed tile size for the demo and every
				// still. Flexing each comparison group independently made an unpaired
				// image twice as wide as either side of a pair. Tight within a pair and
				// loose between them keeps the relationship without changing scale.
				// The strip runs to the
				// card's edges rather than stopping at its padding — a tile cut off
				// by the padding looks like a rendering bug, one that runs under the
				// edge reads as "there is more this way".
				<div className="-mx-4 mt-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
					<div className="flex w-max items-start gap-4">
						{walkthrough.video && (
							<figure className="m-0 w-40 shrink-0 desktop:w-52">
								<figcaption className="mb-1 inline-flex rounded-full bg-blue-soft px-2 py-0.5 text-[11px] font-semibold leading-4 text-blue">
									Demo
								</figcaption>
								<button
									type="button"
									className="relative block aspect-[16/10] w-full cursor-zoom-in overflow-hidden rounded-md border border-line bg-black p-0 outline-none focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]"
									aria-label="Open demo in media viewer"
									onClick={(event) => open("video", event.currentTarget)}
								>
									<video
										className="h-full w-full object-cover"
										src={`${mediaUrl(walkthrough.video)}#t=0.1`}
										preload="metadata"
										muted
										tabIndex={-1}
									/>
									<span className="absolute inset-0 grid place-items-center bg-black/25 text-white">
										<IconPlay size={18} className="ml-0.5" />
									</span>
								</button>
							</figure>
						)}
						{(walkthrough.shots || []).map((shot, i) => (
							<div
								className="flex shrink-0 gap-1"
								key={i}
							>
								{(["before", "after"] as const).map(
									(side) =>
										shot[side] && (
											<figure
												// One tile size for the demo and every still,
												// wider where there is room for it: a thumbnail
												// of a UI is a picture of small things, and two
												// 160px tiles of the same screen are hard to
												// tell apart — which makes the folded strip
												// decorative rather than the answer to "what
												// changed". The phone keeps the smaller tile, so
												// two of them still fit across the card.
												className="m-0 w-40 shrink-0 desktop:w-52"
												key={side}
											>
												<figcaption
													className={cn(
														"mb-1 inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4",
														side === "before"
															? "bg-red-soft text-red"
															: "bg-green-soft text-green",
													)}
												>
													{side === "before" ? "Before" : "After"}
												</figcaption>
												<button
													type="button"
													className="block aspect-[16/10] max-h-[132px] w-full cursor-zoom-in overflow-hidden rounded-md border border-line bg-transparent p-0 outline-none focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]"
													onClick={(e) =>
														open(`${i}:${side}`, e.currentTarget)
													}
												>
													{/* The alt names the button — an aria-label here
													    would replace the caption with six identical
													    "Open before image preview"s. */}
													<img
														className="h-full w-full object-cover object-top"
														src={mediaUrl(shot[side]!)}
														alt={`${shot.caption || "Change"} — ${side}`}
														loading="lazy"
													/>
												</button>
											</figure>
										),
								)}
							</div>
						))}
					</div>
				</div>
			)}

			{expanded && (
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
										paired ? "grid-cols-2 phone:grid-cols-1" : "grid-cols-1",
									)}
								>
									{(["before", "after"] as const).map(
										(side) =>
											shot[side] && (
												<figure
													className="m-0 min-w-0"
													key={side}
												>
													<figcaption className="mb-1.5 flex h-5 items-center gap-2 px-0.5 text-[11px] font-semibold leading-4 text-dim">
														<span
															className={cn(
																"size-1.5 flex-shrink-0 rounded-full",
																side === "before" ? "bg-red" : "bg-green",
															)}
														/>
														{side === "before" ? "Before" : "After"}
													</figcaption>
													<button
														type="button"
														className="flex w-full cursor-zoom-in items-start justify-center overflow-hidden rounded-md border-0 bg-surface p-0 text-left outline-none transition-[filter] hover:brightness-[0.98] focus-visible:shadow-[inset_0_0_0_3px_var(--accent-soft)]"
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
																session
																	? "max-h-96 max-w-full"
																	: "w-full",
															)}
															src={mediaUrl(shot[side]!)}
															alt={`${shot.caption || "change"} — ${side}`}
															loading="lazy"
														/>
													</button>
												</figure>
											),
									)}
								</div>
							</section>
						);
					})}
				</div>
			)}
		</div>
	);
}
