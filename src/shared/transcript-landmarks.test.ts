import { expect, test } from "bun:test";
import {
	buildLandmarks,
	landmarkDigest,
	sectionAnchorId,
	workAnchorId,
	type LandmarkEntry,
} from "./transcript-landmarks";

let clock = 0;
function entry(
	type: string,
	content: string,
	over: Partial<LandmarkEntry> = {},
): LandmarkEntry {
	clock += 1000;
	return {
		id: `e${clock}`,
		type,
		content,
		timestamp: new Date(clock).toISOString(),
		...over,
	};
}

function conversation(): LandmarkEntry[] {
	return [
		entry("user", "Fix the flaky upload test"),
		entry("assistant", "Looking at the retry budget first."),
		entry("tool_use", "", { toolName: "Read", toolInput: { file_path: "src/a.ts" } }),
		entry("tool_result", "ok", {}),
		entry("tool_use", "", { toolName: "Edit", toolInput: { file_path: "src/a.ts" } }),
		entry("assistant", "Fixed it — the timeout was too tight."),
		entry("user", "Now run the tests"),
		entry("tool_use", "", { toolName: "Bash", toolInput: { command: "bun test" } }),
		entry("assistant", "All green."),
	];
}

test("landmarks mirror the block segmentation: prompt, work fold, answer", () => {
	expect(buildLandmarks(conversation()).map((l) => l.kind)).toEqual([
		"prompt", // Fix the flaky upload test
		"work", // the fold's own row
		"step", //   its narration
		"step", //   its Read + Edit run
		"answer", // Fixed it …
		"prompt", // Now run the tests
		"work", // a one-section fold gets no steps of its own
		"answer", // All green.
	]);
});

test("a landmark's id is the anchor of the block it points at", () => {
	const entries = conversation();
	const landmarks = buildLandmarks(entries);
	// Prose blocks anchor on their own entry; a fold anchors on its LAST item
	// (the one that survives a history page merging older rows into the turn).
	expect(landmarks[0].id).toBe(entries[0].id);
	expect(landmarks[1].id).toBe(workAnchorId(entries[4].id));
	// Steps inside the fold: the narration bubble, then the tool run, whose
	// anchor is its LAST tool call.
	expect(landmarks[2].id).toBe(entries[1].id);
	expect(landmarks[3].id).toBe(sectionAnchorId(entries[4].id));
	expect(landmarks[4].id).toBe(entries[5].id);
	expect(landmarks[7].id).toBe(entries[8].id);
	// Every id is unique — two ticks pointing at one block would make the rail
	// lie about where the reader is.
	expect(new Set(landmarks.map((l) => l.id)).size).toBe(landmarks.length);
});

test("a turn with no tools folds nothing — its replies are their own landmarks", () => {
	expect(
		buildLandmarks([
			entry("user", "What does the retry budget do?"),
			entry("assistant", "It caps how many times an upload re-dials."),
		]).map((l) => l.kind),
	).toEqual(["prompt", "answer"]);
});

test("tool_result never becomes a landmark of its own", () => {
	const landmarks = buildLandmarks([
		entry("user", "check"),
		entry("tool_use", "", { toolName: "Read", toolInput: { file_path: "a.ts" } }),
		entry("tool_result", "contents", {}),
	]);
	expect(landmarks.map((l) => l.kind)).toEqual(["prompt", "work"]);
});

test("system entries are inline chips, never navigation targets", () => {
	expect(
		buildLandmarks([
			entry("system", "Run cancelled"),
			entry("user", "retry"),
		]).map((l) => l.kind),
	).toEqual(["prompt"]);
});

test("labels and previews read as prose, not as markdown source", () => {
	const landmarks = buildLandmarks([
		entry("user", "## Heading\n\nPlease **fix** the `uploader`. It drops frames."),
		entry("tool_use", "", {
			toolName: "Bash",
			toolInput: { command: "bun test src/upload.test.ts" },
		}),
	]);
	expect(landmarks[0].label).toBe("Heading Please fix the uploader");
	expect(landmarks[0].preview).toContain("It drops frames");
	expect(landmarks[0].preview).not.toContain("**");
	// A fold with no narration names the run it made instead.
	expect(landmarks[1].preview).toContain("bun test src/upload.test.ts");
	expect(landmarks[1].meta).toBe("1 step");
});

test("every step names the fold it must open before it can be reached", () => {
	const landmarks = buildLandmarks(conversation());
	const fold = landmarks[1];
	for (const step of landmarks.filter((l) => l.kind === "step"))
		expect(step.turnId).toBe(fold.id);
	// Only steps carry it — a prompt or an answer is never inside a fold.
	for (const other of landmarks.filter((l) => l.kind !== "step"))
		expect(other.turnId).toBeUndefined();
});

test("a fold prefers the agent's own narration over the tool list", () => {
	const landmarks = buildLandmarks([
		entry("user", "go"),
		entry("assistant", "Tracing the latch controller before touching layout."),
		entry("tool_use", "", { toolName: "Grep", toolInput: { pattern: "latch" } }),
	]);
	expect(landmarks[1].label).toBe(
		"Tracing the latch controller before touching layout",
	);
	expect(landmarks[1].meta).toBe("1 step");
});

test("digests name who acted, so a batch of them can be labelled in order", () => {
	const [prompt, work] = buildLandmarks([
		entry("user", "Fix the uploader"),
		entry("tool_use", "", { toolName: "Edit", toolInput: { file_path: "src/up.ts" } }),
	]);
	expect(landmarkDigest(prompt)).toStartWith("User asked: Fix the uploader");
	expect(landmarkDigest(work)).toStartWith("Agent worked (1 step): Edit");
});

test("clamping never runs away on a huge entry", () => {
	const [only] = buildLandmarks([entry("user", "word ".repeat(5000))]);
	expect(only.label.length).toBeLessThanOrEqual(66);
	expect(only.preview.length).toBeLessThanOrEqual(222);
});
