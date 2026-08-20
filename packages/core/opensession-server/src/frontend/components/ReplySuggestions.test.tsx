import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { composerBoxExpanded } from "../lib/composer-classes";
import type { ReplySuggestion } from "../lib/reply-suggestions";
import {
	SUGGESTIONS_CLEARANCE,
	VIEWER_SUGGESTIONS,
	VIEWER_SUGGESTIONS_ROW,
	VIEWER_SUGGESTIONS_ROW_INLINE,
} from "../lib/session-viewer-classes";

const { ReplySuggestions } = await import("./ReplySuggestions");

const suggestions: ReplySuggestion[] = [
	{
		label: "Fix both",
		text: "Fix both the queue race and the stale cache read, then run bun test.",
	},
	{ label: "Only step 1", text: "Only fix step 1 for now and stop there." },
];

describe("ReplySuggestions", () => {
	test("shows the short label and carries the full text as the accessible name", () => {
		const html = renderToStaticMarkup(
			<ReplySuggestions suggestions={suggestions} onPick={() => {}} />,
		);

		expect(html).toContain(">Fix both<");
		expect(html).toContain(">Only step 1<");
		// The sentence is what actually lands in the draft, so a screen reader
		// hears it rather than the two-word shorthand.
		expect(html).toContain(
			'aria-label="Fix both the queue race and the stale cache read, then run bun test."',
		);
	});

	test("renders one scrolling row rather than wrapping above the composer", () => {
		const html = renderToStaticMarkup(
			<ReplySuggestions suggestions={suggestions} onPick={() => {}} />,
		);

		expect(html).toContain("overflow-x-auto");
		expect(html).toContain("whitespace-nowrap");
		expect(html).not.toContain("flex-wrap");
	});

	test("the pills start on the composer's own content rail", () => {
		// The row's left padding is the 4px it reserves for the pills' cast
		// shadow plus the composer's own content inset, which is what puts the
		// first pill where the draft it is offering starts. It cannot read that
		// inset as a variable (the composer declares it on itself), so this is
		// what keeps the two from drifting.
		const px = (source: string, pattern: RegExp) =>
			Number(pattern.exec(source)?.[1]);
		const SHADOW_PAD = 4;

		expect(px(VIEWER_SUGGESTIONS_ROW, /(?:^|\s)pl-\[(\d+)px\]/)).toBe(
			SHADOW_PAD + px(composerBoxExpanded, /(?:^|\s)\[--composer-inset-left:(\d+)px\]/),
		);
		expect(px(VIEWER_SUGGESTIONS_ROW, /\sphone:pl-\[(\d+)px\]/)).toBe(
			SHADOW_PAD + px(composerBoxExpanded, /\sphone:\[--composer-inset-left:(\d+)px\]/),
		);
	});

	test("the transcript keeps clear of the pills, not just of the row", () => {
		// The row floats on the transcript, so the only thing holding the last
		// line of an answer out from under it is this padding. It has to cover
		// the pills' own height plus however far they stand off the composer, or
		// the standoff eats into the 16px the reading is supposed to end on.
		const PILL_HEIGHT = 28; // `h-7` on the chip in ReplySuggestions.
		const SPACING_STEP = 4; // Tailwind's px-anchored scale (styles/tailwind.css).
		const standoff =
			Number(/\spb-(\d+(?:\.\d+)?)\s/.exec(VIEWER_SUGGESTIONS)?.[1]) *
			SPACING_STEP;

		expect(standoff).toBeGreaterThan(0);
		expect(SUGGESTIONS_CLEARANCE).toBe(`${PILL_HEIGHT + standoff}px`);
	});

	test("the chips keep the composer's rail when they move beside Next", () => {
		// The row sits in two places: floating over the transcript when it is
		// alone, and in the action row when there is a Next to share a line with.
		// The indent that puts the first pill where the draft starts has to
		// survive the move, or picking up Next shifts every chip sideways.
		for (const pattern of [/(?:^|\s)pl-\[\d+px\]/, /\sphone:pl-\[\d+px\]/]) {
			expect(pattern.exec(VIEWER_SUGGESTIONS_ROW_INLINE)?.[0]).toBe(
				pattern.exec(VIEWER_SUGGESTIONS_ROW)?.[0],
			);
		}
		// It has to yield rather than push Next off the column's edge when there
		// are more chips than fit: the row scrolls sideways instead.
		expect(VIEWER_SUGGESTIONS_ROW_INLINE).toContain("min-w-0");
	});

	test("renders nothing at all when there is nothing to suggest", () => {
		expect(
			renderToStaticMarkup(
				<ReplySuggestions suggestions={[]} onPick={() => {}} />,
			),
		).toBe("");
	});
});
