import { describe, expect, test } from "bun:test";
import {
	appendImageAttachmentComment,
	imageAttachmentReference,
	rebaseImageAttachmentReferences,
} from "./image-attachment-comment";

const region = { x: 0.124, y: 0.201, width: 0.3, height: 0.4 };

describe("image attachment comments", () => {
	test("formats a compact attachment and region reference", () => {
		expect(imageAttachmentReference(1, region)).toBe(
			"[Image 2 · 12–42% × 20–60%]",
		);
	});

	test("appends multiple comments without replacing the draft", () => {
		const first = appendImageAttachmentComment("Intro", 0, region, " Fix this ");
		const second = appendImageAttachmentComment(first, 1, region, "And this");
		expect(second).toBe(
			"Intro\n[Image 1 · 12–42% × 20–60%] Fix this\n[Image 2 · 12–42% × 20–60%] And this",
		);
	});

	test("rebases later references and detaches comments from a removed image", () => {
		expect(
			rebaseImageAttachmentReferences(
				"[Image 1 · 12–42% × 20–60%] First\n[Image 2 · 12–42% × 20–60%] Second",
				0,
			),
		).toBe("First\n[Image 1 · 12–42% × 20–60%] Second");
	});
});
