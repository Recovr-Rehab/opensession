import React, { useCallback, useEffect, useRef, useState } from "react";

import { uploadFile } from "../lib/images";
import {
	DEFAULT_MARKUP_COLOR,
	MARKUP_COLORS,
	type MarkupPoint,
	type MarkupShape,
	type MarkupTool,
	markupExportSize,
	markupExportType,
	markupFileName,
	markupStrokeWidth,
	badgeInk,
	noteBadge,
	noteTexts,
	recallMarkup,
	rememberMarkup,
	renderMarkup,
	shapeHasInk,
	shapePaths,
} from "../lib/image-markup";
import { useIsPhone } from "../hooks/useIsPhone";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { Modal, useEnterOnMount } from "../ui/modal";
import { toast } from "../ui/toast";
import {
	IconArrowUpRight,
	IconMessage,
	IconPencil,
	IconRectangle,
	IconUndo,
	IconX,
} from "./icons";

/**
 * Annotate a screenshot before you send it.
 *
 * The gap this closes: you paste a screenshot into the composer and then have
 * to write "the second button in the top right, the one with the chevron",
 * because the picture cannot point. Here you drag a box around the region and
 * type what is wrong with it. The region becomes a numbered badge on the
 * picture and the sentence leaves as the matching numbered line in the
 * message, so three separate remarks about three parts of one screen are three
 * places and three sentences rather than a paragraph of directions.
 *
 * Arrow, box and pen are the silent tools, for when pointing IS the message.
 *
 * Shape state lives in the image's natural pixels (lib/image-markup.ts
 * explains why), and the live overlay is an SVG with a natural-pixel viewBox,
 * so the browser does the scaling. That is what makes this correct at any
 * window size and crisp at any DPR without a single devicePixelRatio in this
 * file. Canvas appears exactly once, on save, to flatten.
 *
 * Saving REPLACES the attachment with the annotated copy, and remembers what
 * it was made from (rememberMarkup) so reopening restores the editable shapes
 * and "Remove markup" can put the clean picture back. That memory is per page
 * session by design.
 *
 * On upload failure the editor stays open with the shapes intact. It
 * deliberately does not fall back to a data URL the way a pasted image does:
 * an annotated screenshot is comfortably past the size where a base64 copy in
 * the composer's localStorage draft would wedge sending for every session in
 * the tab.
 */

interface Props {
	/** The attachment being annotated: a `/media?path=` ref or a data URL. */
	src: string;
	/** Hand back the ref for the annotated copy (or the original when markup was
	 *  removed), plus the note text in badge order for the message being
	 *  written. */
	onSave: (ref: string, notes: string[]) => void;
	onClose: () => void;
}

/** A tool's button in the strip. */
function ToolButton({
	active,
	label,
	onClick,
	children,
}: {
	active: boolean;
	label: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={label}
			aria-label={label}
			aria-pressed={active}
			className={cn(
				"focus-ring flex size-8 items-center justify-center rounded-control p-0 transition-colors",
				active
					? "bg-fg text-panel"
					: "text-supporting hover:bg-hover hover:text-fg",
			)}
		>
			{children}
		</button>
	);
}

export function ImageMarkup({ src, onSave, onClose }: Props) {
	const open = useEnterOnMount();
	const isPhone = useIsPhone();
	// The picture this session of the editor is actually drawing on. Reopening
	// an annotated attachment goes back to the clean original with its shapes
	// restored, so a second pass moves the arrow rather than drawing on top of
	// a picture of an arrow.
	const priorRef = useRef(recallMarkup(src));
	const base = priorRef.current?.original ?? src;

	const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
	const [shapes, setShapes] = useState<MarkupShape[]>(
		() => priorRef.current?.shapes ?? [],
	);
	const [draft, setDraft] = useState<MarkupShape | null>(null);
	// A note's region, drawn and waiting for its sentence. It is deliberately
	// not in `shapes` yet: a box with nothing said about it is an unfinished
	// thought, and letting it commit would put an unexplained number on the
	// picture and an empty line in the message.
	const [pending, setPending] = useState<MarkupShape | null>(null);
	const [noteText, setNoteText] = useState("");
	const [tool, setTool] = useState<MarkupTool>("note");
	const [color, setColor] = useState(DEFAULT_MARKUP_COLOR);
	const [saving, setSaving] = useState(false);
	const imageRef = useRef<HTMLImageElement | null>(null);
	const surfaceRef = useRef<SVGSVGElement | null>(null);

	// Decode once, up front, and keep the element: the export draws from this
	// same decoded bitmap, so a save can never race the picture.
	useEffect(() => {
		let cancelled = false;
		const img = new Image();
		img.decoding = "async";
		img.src = base;
		img
			.decode()
			.then(() => {
				if (cancelled) return;
				imageRef.current = img;
				setNatural({ w: img.naturalWidth, h: img.naturalHeight });
			})
			.catch(() => {
				if (cancelled) return;
				toast("That image could not be opened for markup.", {
					variant: "error",
				});
				onClose();
			});
		return () => {
			cancelled = true;
		};
	}, [base, onClose]);

	const strokeWidth = markupStrokeWidth(natural?.w ?? 0);

	/** Pointer position in natural image pixels. The surface and the picture
	 *  fill the same box, so one rect converts both. */
	const pointAt = useCallback(
		(e: React.PointerEvent): MarkupPoint | null => {
			const svg = surfaceRef.current;
			if (!svg || !natural) return null;
			const rect = svg.getBoundingClientRect();
			if (!rect.width || !rect.height) return null;
			return {
				x: ((e.clientX - rect.left) / rect.width) * natural.w,
				y: ((e.clientY - rect.top) / rect.height) * natural.h,
			};
		},
		[natural],
	);

	function onPointerDown(e: React.PointerEvent) {
		// One unfinished note at a time. Starting a second region would abandon
		// the sentence half-typed, which is the one thing here that cannot be
		// recovered with Undo.
		if (saving || !natural || pending) return;
		const p = pointAt(e);
		if (!p) return;
		e.preventDefault();
		// Capture so a stroke that leaves the picture (which is most of them,
		// since you aim at an edge) keeps reporting instead of ending mid-drag.
		e.currentTarget.setPointerCapture?.(e.pointerId);
		setDraft({
			id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
			tool,
			color,
			points: [p, p],
		});
	}

	function onPointerMove(e: React.PointerEvent) {
		if (!draft) return;
		const p = pointAt(e);
		if (!p) return;
		setDraft((current) => {
			if (!current) return current;
			if (current.tool === "pen")
				return { ...current, points: [...current.points, p] };
			return { ...current, points: [current.points[0], p] };
		});
	}

	function endStroke() {
		if (!draft) return;
		if (shapeHasInk(draft, strokeWidth)) {
			// A note's region is only half of it. Hold the box and ask for the
			// sentence; every other tool is complete the moment the drag ends.
			if (draft.tool === "note") {
				setPending(draft);
				setNoteText("");
			} else {
				setShapes((all) => [...all, draft]);
			}
		}
		setDraft(null);
	}

	/** Commit the pending region with what was typed about it. */
	function commitNote() {
		const said = noteText.trim();
		if (!pending || !said) return;
		setShapes((all) => [...all, { ...pending, note: said }]);
		setPending(null);
		setNoteText("");
	}

	/** Drop the region and whatever was being said about it. The box was never
	 *  a shape, so there is nothing for Undo to pick up afterwards. */
	function discardNote() {
		setPending(null);
		setNoteText("");
	}

	async function save() {
		if (!natural || !imageRef.current) return;
		// Nothing drawn: this is a cancel that happens to have taken the long
		// way round, so leave the attachment exactly as it was.
		if (!shapes.length) {
			onSave(priorRef.current ? base : src, []);
			onClose();
			return;
		}
		setSaving(true);
		try {
			const { width, height, scale } = markupExportSize(natural.w, natural.h);
			const canvas = document.createElement("canvas");
			canvas.width = width;
			canvas.height = height;
			const ctx = canvas.getContext("2d");
			if (!ctx) throw new Error("canvas unavailable");
			ctx.scale(scale, scale);
			ctx.drawImage(imageRef.current, 0, 0, natural.w, natural.h);
			renderMarkup(ctx, shapes, strokeWidth, (d) => new Path2D(d), {
				w: natural.w,
				h: natural.h,
			});
			const type = markupExportType(base);
			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, type.mime, type.quality),
			);
			if (!blob) throw new Error("could not encode the image");
			const name = markupFileName(base);
			const { path } = await uploadFile(
				new File([blob], name, { type: type.mime }),
			);
			const ref = `/media?path=${encodeURIComponent(path)}`;
			rememberMarkup(ref, { original: base, shapes });
			onSave(ref, noteTexts(shapes));
			onClose();
		} catch (e) {
			// Keep the shapes on screen. The work took a minute of aiming and
			// the retry is one more click.
			toast((e as Error)?.message || "Could not save the markup.", {
				variant: "error",
			});
			setSaving(false);
		}
	}

	const live = draft
		? [...shapes, draft]
		: pending
			? [...shapes, pending]
			: shapes;
	const canRemove = !!priorRef.current;
	const notes = shapes.filter((shape) => shape.note !== undefined);
	// Badges for the committed notes, plus one for the region being written
	// about right now: seeing the number it is ABOUT to take is what makes the
	// list underneath read as the same thing as the picture.
	const badges = [...notes, ...(pending ? [pending] : [])].flatMap(
		(shape, i) => {
			const badge = noteBadge(shape, strokeWidth, natural ?? undefined);
			return badge ? [{ shape, badge, number: i + 1 }] : [];
		},
	);
	// Where the note field sits: just under the region's bottom-left corner,
	// held inside the picture so a box drawn against the right or bottom edge
	// (which is where half of them are) does not push its own field off screen.
	const notePlacement = (() => {
		if (!pending || !natural) return { left: 0, top: 0 };
		const [a, b] = pending.points;
		const left = (Math.min(a.x, b.x) / natural.w) * 100;
		const top = (Math.max(a.y, b.y) / natural.h) * 100;
		return {
			left: Math.min(Math.max(left, 0), 55),
			top: Math.min(Math.max(top, 0), 78),
		};
	})();

	return (
		<Modal.Root
			open={open}
			onOpenChange={(next: boolean) => {
				if (!next && !saving) onClose();
			}}
		>
			<Modal.Content
				widthClassName="w-[min(1040px,94vw)] max-w-none"
				className="gap-3 p-4 phone:w-[96vw] phone:p-3"
				aria-label="Markup"
			>
				<Modal.Header
					title="Markup"
					description="Drag a box around what you mean, then say what is wrong."
				/>
				{/* The picture sits on a neutral, non-themed plate. A screenshot
				    of a light app on the dark app's raised surface reads as a
				    cutout floating in a hole; a mid grey gives every source the
				    same frame. */}
				<div className="flex min-h-0 justify-center overflow-auto rounded-control bg-[#8a8d94]/18 p-2">
					{natural ? (
						<div
							className="relative leading-[0]"
							style={{ aspectRatio: `${natural.w} / ${natural.h}` }}
						>
							<img
								src={base}
								alt=""
								className="block max-h-[58dvh] w-auto max-w-full rounded-[4px] object-contain phone:max-h-[46dvh]"
								draggable={false}
							/>
							<svg
								ref={surfaceRef}
								viewBox={`0 0 ${natural.w} ${natural.h}`}
								// The overlay is the SAME box as the picture, so a
								// pointer position converts through one rect and the
								// viewBox does every other bit of scaling. `touch-action`
								// is load-bearing on a phone: without it the first
								// downward stroke is a scroll, not a line.
								className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
								onPointerDown={onPointerDown}
								onPointerMove={onPointerMove}
								onPointerUp={endStroke}
								onPointerCancel={endStroke}
							>
								{live.flatMap((shape) =>
									shapePaths(shape, strokeWidth).map((d, i) => (
										<path
											key={`${shape.id}-${i}`}
											d={d}
											fill="none"
											stroke={shape.color}
											strokeWidth={strokeWidth}
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									)),
								)}
								{/* A note's number, on its region's corner. Drawn from the same
								    geometry the export uses, so what you aimed at is what leaves. */}
								{badges.map(({ shape, badge, number }) => (
									<g key={`badge-${shape.id}`} pointerEvents="none">
										<circle cx={badge.cx} cy={badge.cy} r={badge.r} fill={shape.color} />
										<text
											x={badge.cx}
											y={badge.cy}
											fill={badgeInk(shape.color)}
											fontSize={badge.r * 1.25}
											fontWeight={600}
											textAnchor="middle"
											dominantBaseline="central"
											fontFamily="system-ui, -apple-system, sans-serif"
										>
											{number}
										</text>
									</g>
								))}
							</svg>
							{/* The sentence is asked for AT the region rather than in a panel
							    off to the side: what you are typing about stays under your
							    cursor, and the field arrives where your hand already is. */}
							{pending && natural && (
								<div
									className="absolute z-20 w-[min(280px,86%)]"
									style={{
										left: `${notePlacement.left}%`,
										top: `${notePlacement.top}%`,
									}}
								>
									<div className="mt-1.5 flex flex-col gap-2 rounded-control border border-line bg-panel p-2 shadow-lg">
										<textarea
											autoFocus
											rows={2}
											value={noteText}
											placeholder="What is wrong here?"
											onChange={(e) => setNoteText(e.target.value)}
											onKeyDown={(e) => {
												// Enter commits, because this is one remark rather than a
												// message: the next thing you do is draw the next region.
												if (e.key === "Enter" && !e.shiftKey) {
													e.preventDefault();
													commitNote();
												}
												if (e.key === "Escape") {
													e.stopPropagation();
													discardNote();
												}
											}}
											className="w-full resize-none bg-transparent text-body text-fg outline-none placeholder:text-faint"
										/>
										<div className="flex items-center justify-end gap-1">
											<Button size="sm" variant="ghost" onClick={discardNote}>
												Cancel
											</Button>
											<Button
												size="sm"
												variant="primary"
												disabled={!noteText.trim()}
												onClick={commitNote}
											>
												Add
											</Button>
										</div>
									</div>
								</div>
							)}
						</div>
					) : (
						<div className="h-[40dvh] w-full animate-pulse rounded-[4px] bg-hover" />
					)}
				</div>

				<div className="flex flex-wrap items-center gap-3">
					<div className="flex items-center gap-1 rounded-control bg-hover/60 p-1">
						<ToolButton
							active={tool === "note"}
							label="Comment"
							onClick={() => setTool("note")}
						>
							<IconMessage size={20} />
						</ToolButton>
						<ToolButton
							active={tool === "arrow"}
							label="Arrow"
							onClick={() => setTool("arrow")}
						>
							<IconArrowUpRight size={20} />
						</ToolButton>
						<ToolButton
							active={tool === "box"}
							label="Box"
							onClick={() => setTool("box")}
						>
							<IconRectangle size={20} />
						</ToolButton>
						{/* No pen at phone width. Over a retina screenshot one
						    finger-pixel covers seven image pixels, so freehand comes
						    out as scribble; arrow and box are drags, which that
						    precision handles, and they are the "point at it" tools
						    anyway. */}
						{!isPhone && (
							<ToolButton
								active={tool === "pen"}
								label="Pen"
								onClick={() => setTool("pen")}
							>
								<IconPencil size={20} />
							</ToolButton>
						)}
					</div>

					<div className="flex items-center gap-1.5">
						{MARKUP_COLORS.map((c) => (
							<button
								key={c.id}
								type="button"
								title={c.name}
								aria-label={c.name}
								aria-pressed={color === c.value}
								onClick={() => setColor(c.value)}
								className={cn(
									"focus-ring size-6 rounded-full p-0 transition-transform",
									// The ring is the selection, drawn outside the swatch
									// so the colour itself is never dimmed or covered by
									// the thing marking it.
									color === c.value
										? "outline outline-2 outline-offset-2 outline-fg"
										: "hover:scale-110",
								)}
								style={{
									background: c.value,
									// White and black swatches need an edge or they
									// disappear into one theme or the other.
									boxShadow: "inset 0 0 0 1px rgb(0 0 0 / 0.18)",
								}}
							/>
						))}
					</div>

					<div className="ml-auto flex items-center gap-1">
						<Button
							size="sm"
							variant="ghost"
							disabled={!shapes.length || saving}
							onClick={() => setShapes((all) => all.slice(0, -1))}
						>
							<IconUndo size={20} />
							Undo
						</Button>
						{canRemove && (
							<Button
								size="sm"
								variant="ghost"
								disabled={saving}
								onClick={() => {
									onSave(base, []);
									onClose();
								}}
							>
								Remove markup
							</Button>
						)}
					</div>
				</div>

				{/* The message half of the annotation, in the numbers the picture
				    carries. Seeing the lines here is what makes Save honest: this
				    text is going into the composer, not just into the file. */}
				{notes.length > 0 && (
					<ol className="flex flex-col gap-1.5">
						{notes.map((shape, i) => (
							<li key={shape.id} className="flex items-start gap-2">
								<span
									className="mt-px flex size-[18px] shrink-0 items-center justify-center rounded-full text-label font-medium"
									style={{ background: shape.color, color: badgeInk(shape.color) }}
								>
									{i + 1}
								</span>
								<span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-body text-fg">
									{shape.note}
								</span>
								<button
									type="button"
									onClick={() =>
										setShapes((all) => all.filter((s) => s.id !== shape.id))
									}
									className="focus-ring shrink-0 rounded-control p-0.5 text-faint transition-colors hover:text-fg"
									aria-label={`Remove note ${i + 1}`}
								>
									<IconX size={14} dense />
								</button>
							</li>
						))}
					</ol>
				)}

				<Modal.Footer>
					<Button variant="ghost" disabled={saving} onClick={onClose}>
						Cancel
					</Button>
					<Button variant="primary" disabled={saving || !natural} onClick={save}>
						{saving ? "Saving" : notes.length ? "Add to message" : "Save"}
					</Button>
				</Modal.Footer>
			</Modal.Content>
		</Modal.Root>
	);
}
