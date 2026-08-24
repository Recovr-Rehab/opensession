import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import React, { useCallback, useEffect, useRef } from "react";
import {
	currentTranscriptWidthBucket,
	loadTranscriptSizes,
	saveTranscriptSizes,
	seededBlockEstimate,
	type TranscriptSizes,
} from "../lib/transcript-sizes";
import {
	registerTranscriptVirtualNavigation,
	type TranscriptVirtualNavigation,
} from "../lib/transcript-virtual-navigation";
import { cn } from "../ui/cn";

export interface VirtualTranscriptItem {
	key: string;
	anchorId: string;
	entryIds: string[];
	estimateSize: number;
	/** Keep the estimate until sparse payload content is available to measure. */
	measure?: boolean;
	className?: string;
	content: React.ReactNode;
}

interface Props {
	items: VirtualTranscriptItem[];
	/** Keep the live-edge tail mounted inside the same virtual coordinate space. */
	trailingMounted: number;
	onVisibleItems?: (items: VirtualTranscriptItem[]) => void;
	/** Range children reuse the renderer without nesting another virtualizer. */
	enabled?: boolean;
	/** Session identity for the persisted measured-height cache. When present,
	 *  block heights measured on a previous visit seed this visit's first
	 *  estimates, so reopening a chat does not shift while estimates correct. */
	sizeCacheKey?: string;
}

// Write measured heights through at most this often while a session is open.
const SIZE_SAVE_INTERVAL_MS = 5_000;
// ...and sooner once a visit has accumulated this many fresh measurements.
const SIZE_SAVE_DIRTY_THRESHOLD = 40;

/** Loaded transcript blocks, windowed against their nearest message scroller. */
export function VirtualTranscriptList({
	items,
	trailingMounted,
	onVisibleItems,
	enabled = true,
	sizeCacheKey,
}: Props) {
	const rootRef = useRef<HTMLDivElement>(null);
	// Heights this visit has observed so far, written through to the persisted
	// store on a short throttle. Declared before the seed block below so a
	// session switch can clear it alongside the seeds it replaces.
	const measuredSizesRef = useRef(new Map<string, number>());
	// Heights measured on an earlier visit of sizeCacheKey, loaded once per
	// session switch. estimateSize reads them before falling back to the
	// outline heuristic, so a reopened chat starts at its true size instead of
	// correcting visible content into place.
	const seededRef = useRef<{ session: string; sizes?: TranscriptSizes } | null>(
		null,
	);
	if (sizeCacheKey && seededRef.current?.session !== sizeCacheKey) {
		seededRef.current = {
			session: sizeCacheKey,
			sizes: loadTranscriptSizes(
				sizeCacheKey,
				currentTranscriptWidthBucket(),
			),
		};
		measuredSizesRef.current = new Map();
	}
	const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
		count: items.length,
		getScrollElement: () =>
			rootRef.current?.closest<HTMLDivElement>(".viewer-messages") ?? null,
		estimateSize: (index) => {
			const item = items[index];
			if (!item) return 96;
			return seededBlockEstimate(
				item.estimateSize,
				seededRef.current?.sizes,
				item.key,
			);
		},
		getItemKey: (index) => items[index]?.key ?? index,
		overscan: 8,
		rangeExtractor: (range) =>
			virtualTranscriptRange(
				defaultRangeExtractor(range),
				range.count,
				trailingMounted,
			),
		useAnimationFrameWithResizeObserver: true,
	});
	virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (
		item,
		_delta,
		instance,
	) => shouldAdjustTranscriptScroll(item.end, instance.scrollOffset ?? 0);
	const virtualItems = virtualizer.getVirtualItems();
	const canVirtualize =
		enabled && typeof ResizeObserver !== "undefined" && items.length > 0;

	// The recording half of the size cache. Rows that really mount are observed
	// here alongside TanStack's own measurement; their stable block keys map to
	// the heights that become the next visit's seeds. Rows never mounted carry
	// no measurement and keep their heuristic, which is exactly right: they are
	// also the blocks whose content has not been seen.
	const rowNodesRef = useRef(new Map<string, HTMLElement>());
	const rowObserverRef = useRef<ResizeObserver | null>(null);
	const flushMeasuredSizes = useCallback(() => {
		if (!sizeCacheKey || measuredSizesRef.current.size === 0) return;
		saveTranscriptSizes(
			sizeCacheKey,
			currentTranscriptWidthBucket(),
			measuredSizesRef.current,
		);
		measuredSizesRef.current = new Map();
	}, [sizeCacheKey]);
	useEffect(() => {
		if (!sizeCacheKey) return;
		const timer = window.setInterval(() => {
			if (measuredSizesRef.current.size >= SIZE_SAVE_DIRTY_THRESHOLD) {
				flushMeasuredSizes();
			}
		}, SIZE_SAVE_INTERVAL_MS);
		return () => {
			window.clearInterval(timer);
			flushMeasuredSizes();
		};
	}, [sizeCacheKey, flushMeasuredSizes]);
	const observeRowNode = useCallback((key: string, node: HTMLElement) => {
		rowNodesRef.current.set(key, node);
		node.dataset.transcriptKey = key;
		if (!rowObserverRef.current) {
			const recorded = measuredSizesRef.current;
			rowObserverRef.current = new ResizeObserver((entries) => {
				for (const entry of entries) {
					const entryKey = (entry.target as HTMLElement).dataset
						.transcriptKey;
					if (!entryKey) continue;
					const size =
						entry.borderBoxSize?.[0]?.blockSize ??
						entry.target.getBoundingClientRect().height;
					if (Number.isFinite(size) && size > 0) {
						recorded.set(entryKey, size);
					}
				}
			});
		}
		rowObserverRef.current.observe(node);
	}, []);
	// Stable per-row ref callbacks. An inline arrow would detach and reattach
	// on every render, re-running TanStack's measure cleanup for each visible
	// row; caching by block key keeps attach to real mounts.
	const rowRefsRef = useRef(
		new Map<string, (node: HTMLDivElement | null) => void>(),
	);
	const rowRef = useCallback(
		(key: string) => {
			let callback = rowRefsRef.current.get(key);
			if (!callback) {
				callback = (node) => {
					virtualizer.measureElement(node);
					if (sizeCacheKey && node) observeRowNode(key, node);
				};
				if (rowRefsRef.current.size > 1_000) rowRefsRef.current.clear();
				rowRefsRef.current.set(key, callback);
			}
			return callback;
		},
		[virtualizer, sizeCacheKey, observeRowNode],
	);
	useEffect(() => {
		return () => {
			rowObserverRef.current?.disconnect();
			rowObserverRef.current = null;
			rowNodesRef.current.clear();
		};
	}, []);

	useEffect(() => {
		const container = rootRef.current?.closest<HTMLDivElement>(
			".viewer-messages",
		);
		if (!container || items.length === 0) return;
		const indexByEntry = new Map<string, number>();
		for (let index = 0; index < items.length; index++) {
			for (const entryId of items[index]?.entryIds ?? []) {
				if (!indexByEntry.has(entryId)) indexByEntry.set(entryId, index);
			}
		}
		const navigation: TranscriptVirtualNavigation = {
			scrollToEntry(entryId) {
				const index = indexByEntry.get(entryId);
				if (index === undefined) return false;
				virtualizer.scrollToIndex(index, { align: "start" });
				return true;
			},
		};
		return registerTranscriptVirtualNavigation(container, navigation);
	}, [items, virtualizer]);

	useEffect(() => {
		if (!onVisibleItems || virtualItems.length === 0) return;
		const container = rootRef.current?.closest<HTMLDivElement>(
			".viewer-messages",
		);
		const top = container?.scrollTop ?? 0;
		const viewport = container?.clientHeight ?? 0;
		const bottom = top + viewport;
		const demand = virtualItems.filter(
			(item) =>
				!container ||
				(item.end >= top - viewport && item.start <= bottom + viewport),
		);
		const timer = window.setTimeout(() => {
			onVisibleItems(
				demand
					.map((virtualItem) => items[virtualItem.index])
					.filter((item): item is VirtualTranscriptItem => Boolean(item)),
			);
		}, 120);
		return () => window.clearTimeout(timer);
	}, [items, onVisibleItems, virtualItems]);

	// Server rendering and minimal test DOMs have no ResizeObserver. Keeping the
	// complete list there also makes transcript markup tests inspect real rows.
	if (!canVirtualize) {
		return <>{items.map(renderStaticItem)}</>;
	}

	return (
		<>
			<div
				ref={rootRef}
				className="relative w-full"
				style={{ height: virtualizer.getTotalSize() }}
				data-virtual-transcript
				data-virtual-count={items.length}
				data-transcript-blocks={items.length}
			>
				{virtualItems.map((virtualItem) => {
					const item = items[virtualItem.index];
					if (!item) return null;
					return (
						<div
							key={item.key}
							ref={item.measure === false ? undefined : rowRef(item.key)}
							data-index={virtualItem.index}
							data-eid={item.anchorId}
							className={cn("absolute left-0 top-0 w-full", item.className)}
							style={{ transform: `translateY(${virtualItem.start}px)` }}
						>
							{item.content}
						</div>
					);
				})}
			</div>
		</>
	);
}

export function shouldAdjustTranscriptScroll(
	itemEnd: number,
	scrollOffset: number,
): boolean {
	return itemEnd <= scrollOffset + 1;
}

export function virtualTranscriptRange(
	visible: number[],
	count: number,
	trailingMounted: number,
): number[] {
	const indexes = new Set(visible);
	const start = Math.max(0, count - Math.max(0, trailingMounted));
	for (let index = start; index < count; index++) indexes.add(index);
	return [...indexes].sort((a, b) => a - b);
}

function renderStaticItem(item: VirtualTranscriptItem) {
	return (
		<div key={item.key} data-eid={item.anchorId} className={item.className}>
			{item.content}
		</div>
	);
}
