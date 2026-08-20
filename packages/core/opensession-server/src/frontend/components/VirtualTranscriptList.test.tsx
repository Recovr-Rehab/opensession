import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	VirtualTranscriptList,
	type VirtualTranscriptItem,
	virtualTranscriptPrefixCount,
} from "./VirtualTranscriptList";

function item(index: number): VirtualTranscriptItem {
	return {
		key: `block-${index}`,
		anchorId: `entry-${index}`,
		entryIds: [`entry-${index}`],
		estimateSize: 80,
		content: <span>Block {index}</span>,
	};
}

describe("VirtualTranscriptList", () => {
	test("keeps the live-edge tail mounted outside the virtual prefix", () => {
		expect(virtualTranscriptPrefixCount(40, 24)).toBe(16);
		expect(virtualTranscriptPrefixCount(12, 24)).toBe(0);
	});

	test("renders complete semantic content without browser measurement", () => {
		const html = renderToStaticMarkup(
			<VirtualTranscriptList
				items={[item(0), item(1), item(2)]}
				trailingMounted={1}
			/>,
		);
		expect(html).toContain("Block 0");
		expect(html).toContain("Block 2");
		expect(html).not.toContain("data-virtual-transcript");
	});
});
