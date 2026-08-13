import { describe, expect, it } from "bun:test";
import {
	familyRoot,
	foldFamilies,
	parentLinks,
	type Foldable,
} from "./session-family";

const hit = (id: string): Foldable & { score: number } => ({
	id: `session:${id}`,
	score: 1,
});

describe("parentLinks", () => {
	it("links workers to their parent and helpers to their spawner", () => {
		const parents = parentLinks([
			{ id: "a" },
			{ id: "b", parentSessionId: "a" },
			{ id: "c", spawnedBy: "a" },
		]);
		expect(parents.get("b")).toBe("a");
		expect(parents.get("c")).toBe("a");
		expect(parents.has("a")).toBe(false);
	});

	it("ignores a session that claims itself as parent", () => {
		expect(parentLinks([{ id: "a", parentSessionId: "a" }]).size).toBe(0);
	});
});

describe("familyRoot", () => {
	it("walks a chain to its oldest ancestor", () => {
		const parents = parentLinks([
			{ id: "b", parentSessionId: "a" },
			{ id: "c", parentSessionId: "b" },
		]);
		expect(familyRoot("c", parents)).toBe("a");
		expect(familyRoot("a", parents)).toBe("a");
	});

	it("returns a parent that is not itself in the list", () => {
		const parents = parentLinks([{ id: "b", parentSessionId: "gone" }]);
		expect(familyRoot("b", parents)).toBe("gone");
	});

	it("survives a cycle", () => {
		const parents = parentLinks([
			{ id: "a", parentSessionId: "b" },
			{ id: "b", parentSessionId: "a" },
		]);
		expect(["a", "b"]).toContain(familyRoot("a", parents));
	});
});

describe("foldFamilies", () => {
	const parents = parentLinks([
		{ id: "review", parentSessionId: "work" },
		{ id: "worker", parentSessionId: "work" },
	]);

	it("keeps a parent and its review as one hit", () => {
		const out = foldFamilies([hit("work"), hit("review")], parents, 8);
		expect(out.map((h) => h.id)).toEqual(["session:work"]);
		expect(out[0]!.rootId).toBeUndefined();
		expect(out[0]!.foldedIds).toEqual(["review"]);
	});

	it("points a child-only match at the parent, keeping the child's record", () => {
		const out = foldFamilies([hit("review")], parents, 8);
		expect(out).toHaveLength(1);
		expect(out[0]!.id).toBe("session:review");
		expect(out[0]!.rootId).toBe("work");
	});

	it("lets the best-scoring member lead its family", () => {
		const out = foldFamilies([hit("review"), hit("worker"), hit("work")], parents, 8);
		expect(out).toHaveLength(1);
		expect(out[0]!.id).toBe("session:review");
		expect(out[0]!.foldedIds).toEqual(["worker", "work"]);
	});

	it("leaves unrelated sessions alone and applies the limit after folding", () => {
		const out = foldFamilies(
			[hit("work"), hit("review"), hit("other"), hit("third")],
			parents,
			2,
		);
		expect(out.map((h) => h.id)).toEqual(["session:work", "session:other"]);
	});
});
