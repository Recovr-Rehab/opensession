import React, { useMemo, useState } from "react";
import type { SessionWalkthrough } from "../lib/types";
import { renderMarkdown } from "../lib/markdown";
import { relativeTime } from "../lib/api";
import { cn } from "../ui/cn";
import { IconChevronDown, IconPlay, IconPlayOutline } from "./icons";
import { useMarkdownRepo } from "./MarkdownBody";
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
	// Every still in the card, flattened in render order, so clicking one opens
	// the shared media lightbox (Escape/arrows/pinch-zoom/download) browsing
	// before→after across all the pairs.
	const gallery = useMemo(() => {
		const items: LightboxItem[] = [];
		const at = new Map<string, number>();
		(walkthrough.shots || []).forEach((shot, i) => {
			for (const side of ["before", "after"] as const) {
				const path = shot[side];
				if (!path) continue;
				at.set(`${i}:${side}`, items.length);
				items.push({
					kind: "image",
					src: mediaUrl(path),
					sessionTitle: [shot.caption, side === "before" ? "Before" : "After"]
						.filter(Boolean)
						.join(" — "),
				});
			}
		});
		return { items, at };
	}, [walkthrough.shots]);

	// What the card holds, for the folded header — the one thing a reader needs
	// to decide whether to open it. Open, they can see that for themselves, so
	// the slot goes back to saying when it was published.
	const contentsLabel = [
		walkthrough.video ? "Demo" : "",
		gallery.items.length
			? `${gallery.items.length} still${gallery.items.length === 1 ? "" : "s"}`
			: "",
	]
		.filter(Boolean)
		.join(" · ") || (walkthrough.summary ? "Writeup" : "");

	const open = (key: string, target: HTMLElement) =>
		openLightbox(gallery.items, gallery.at.get(key) ?? 0, target);

	return (
		<div
			className={cn(
				// p-4 deliberately exceeds the mt-3 rhythm between the blocks
				// inside, so the card edge reads as an edge — at 12px a trailing
				// screenshot looks like it runs out of the card rather than sitting
				// in it. The card inherits its surrounding surface; the hairline is
				// enough to separate it without introducing a darker grey panel.
				"rounded-lg bg-transparent p-4",
				session && "border border-line",
				// In the session the card is a transcript block like any other, so it
				// takes the same centered reading column the turns and footers use
				// (mx-auto + --session-col) instead of spanning the whole pane. It
				// trails more space than it leads: unlike the neighbouring blocks
				// it ends in media, which otherwise butts straight into the next
				// message.
				session ? "mx-auto mb-6 mt-2 w-full max-w-[var(--session-col)]" : "mb-4",
			)}
		>
			{session ? (
				<button
					type="button"
					aria-expanded={expanded}
					onClick={() => setExpanded(!expanded)}
					// The transcript's fold line, verbatim from TurnBlock: same 14px
					// text, same 20px chevron, same baseline alignment mixing a
					// title with faint meta runs. A card that borrows the fold's
					// behaviour but not its typography reads as a different control.
					className="-m-1 mb-1 flex w-full min-w-0 cursor-pointer items-baseline gap-2 rounded-control border-0 bg-transparent p-1 text-left font-sans text-[14px] leading-5 text-dim transition-colors hover:bg-hover/40 hover:text-fg"
				>
					{/* The walkthrough's own icon leads the line, so the row is
					    named before it is operated; the chevron trails at the far
					    edge, where it reads as this card's disclosure rather than
					    as another indent level in the transcript. */}
					<IconPlayOutline
						size={14}
						className="flex-shrink-0 self-center text-faint"
					/>
					<span className="flex-shrink-0 font-medium">Walkthrough</span>
					{walkthrough.publishedBy && (
						<span className="min-w-0 truncate text-label leading-4 text-faint">
							· {walkthrough.publishedBy}
						</span>
					)}
					<span className="ml-auto flex-shrink-0 text-label leading-4 text-faint">
						{expanded
							? walkthrough.publishedAt
								? relativeTime(walkthrough.publishedAt)
								: ""
							: contentsLabel}
					</span>
					<span
						className={cn(
							"grid size-5 flex-shrink-0 place-items-center self-center leading-none text-faint transition-transform duration-150",
							!expanded && "-rotate-90",
						)}
					>
						<IconChevronDown size={20} className="block" />
					</span>
				</button>
			) : (
				<div className="mb-2 flex items-center gap-1.5">
					<IconPlayOutline size={13} className="text-faint" />
					<span className="text-xs font-semibold text-dim">Walkthrough</span>
				</div>
			)}

			{!expanded && (walkthrough.video || gallery.items.length > 0) && (
				// The folded card's pictures: every still, in reading order, sharing
				// out the card's width instead of sitting at thumbnail size against
				// a gulf of empty card. Tight within a pair and loose between them;
				// the labels make each side explicit while the pairing remains the
				// point of the folded strip,
				// since a before and its after side by side is checkable at a
				// glance. Each pair keeps a floor width, so a walkthrough with many
				// pairs overflows into the same scroll as before rather than
				// shrinking every still into illegibility. The strip runs to the
				// card's edges rather than stopping at its padding — a tile cut off
				// by the padding looks like a rendering bug, one that runs under the
				// edge reads as "there is more this way".
				<div className="-mx-4 mt-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
					<div className="flex w-full items-start gap-6">
						{walkthrough.video && (
							// The demo leads the strip as its own tile: folded, the
							// headline artifact was represented only by the word "Demo",
							// so the strip couldn't sell what opening the card buys.
							// Clicking it opens the card rather than playing in place —
							// a 104px-wide video is a thumbnail, not a player.
							<button
								type="button"
								className="relative block aspect-[16/10] max-h-[132px] min-w-[104px] max-w-[200px] flex-1 cursor-pointer overflow-hidden rounded-md border border-line bg-black p-0 outline-none focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]"
								aria-label="Open the walkthrough to play the demo"
								onClick={() => setExpanded(true)}
							>
								<video
									className="h-full w-full object-cover"
									src={`${mediaUrl(walkthrough.video)}#t=0.1`}
									preload="metadata"
									muted
									tabIndex={-1}
								/>
								<span className="absolute inset-0 grid place-items-center bg-black/25 text-white">
									<IconPlay size={18} />
								</span>
							</button>
						)}
						{(walkthrough.shots || []).map((shot, i) => (
							<div
								className="flex min-w-[216px] max-w-[420px] flex-1 gap-1"
								key={i}
							>
								{(["before", "after"] as const).map(
									(side) =>
										shot[side] && (
											<figure
												className="m-0 min-w-0 flex-1"
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
				<>
					{walkthrough.video && (
						<>
							<video
								className={cn(
									"w-full rounded-md border border-line bg-black",
									session ? "max-h-[60vh] object-contain" : "",
								)}
								src={mediaUrl(walkthrough.video)}
								controls
								preload="metadata"
								title={walkthrough.videoTitle || "Demo video"}
							/>
							{session && walkthrough.videoTitle ? (
								<div className="mb-2 mt-1 text-[11px] text-faint">
									{walkthrough.videoTitle}
								</div>
							) : (
								<div className="mb-2" />
							)}
						</>
					)}
					<div
						className="markdown text-[13px]"
						dangerouslySetInnerHTML={{ __html: summaryHtml }}
					/>
					{(walkthrough.shots || []).map((shot, i) => (
						<div className="mt-3" key={i}>
							{shot.caption && (
								<div className="mb-1 text-xs text-dim">{shot.caption}</div>
							)}
							<div className="flex gap-2">
								{(["before", "after"] as const).map(
									(side) =>
										shot[side] && (
											<figure className="m-0 min-w-0 flex-1" key={side}>
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
													className="block w-full cursor-zoom-in rounded-control border-0 bg-transparent p-0 text-left outline-none focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]"
													onClick={(event) =>
														open(`${i}:${side}`, event.currentTarget)
													}
												>
													<img
														className={cn(
															"rounded-md border border-line",
															// In the session the card sits in the message flow,
															// so cap the stills (full size lives one click away
															// in the lightbox) instead of pushing the
															// conversation down by a screenful per pair. The cap
															// bounds the IMAGE rather than a box it is contained
															// in: `object-contain` letterboxes inside a
															// full-width box, and the hairline then frames empty
															// gutters instead of the screenshot.
															session
																? "max-h-52 max-w-full"
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
						</div>
					))}
				</>
			)}
		</div>
	);
}
