import { useVirtualizer } from "@tanstack/react-virtual";
import React, { useEffect, useRef } from "react";
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
	className?: string;
	content: React.ReactNode;
}

interface Props {
	items: VirtualTranscriptItem[];
	/** The live edge stays ordinary DOM so opening and streaming never wait for measurement. */
	trailingMounted: number;
}

/** Loaded transcript blocks, windowed against their nearest message scroller. */
export function VirtualTranscriptList({ items, trailingMounted }: Props) {
	const rootRef = useRef<HTMLDivElement>(null);
	const virtualCount = virtualTranscriptPrefixCount(
		items.length,
		trailingMounted,
	);
	const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
		count: virtualCount,
		getScrollElement: () =>
			rootRef.current?.closest<HTMLDivElement>(".viewer-messages") ?? null,
		estimateSize: (index) => items[index]?.estimateSize ?? 96,
		getItemKey: (index) => items[index]?.key ?? index,
		overscan: 8,
		useAnimationFrameWithResizeObserver: true,
	});
	const virtualItems = virtualizer.getVirtualItems();
	const canVirtualize =
		typeof ResizeObserver !== "undefined" && virtualCount > 0;

	useEffect(() => {
		const container = rootRef.current?.closest<HTMLDivElement>(
			".viewer-messages",
		);
		if (!container || virtualCount === 0) return;
		const indexByEntry = new Map<string, number>();
		for (let index = 0; index < virtualCount; index++) {
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
	}, [items, virtualCount, virtualizer]);

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
				data-virtual-count={virtualCount}
				data-transcript-blocks={items.length}
			>
				{virtualItems.map((virtualItem) => {
					const item = items[virtualItem.index];
					if (!item) return null;
					return (
						<div
							key={item.key}
							ref={virtualizer.measureElement}
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
			{items.slice(virtualCount).map(renderStaticItem)}
		</>
	);
}

export function virtualTranscriptPrefixCount(
	count: number,
	trailingMounted: number,
): number {
	return Math.max(0, count - Math.max(0, trailingMounted));
}

function renderStaticItem(item: VirtualTranscriptItem) {
	return (
		<div key={item.key} data-eid={item.anchorId} className={item.className}>
			{item.content}
		</div>
	);
}
