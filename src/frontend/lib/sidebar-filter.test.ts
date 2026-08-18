import { beforeEach, describe, expect, test } from "bun:test";

// The module reads localStorage lazily, inside its functions — but bun has no
// localStorage, so stand one up before importing it.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
	getItem: (k: string) => store.get(k) ?? null,
	setItem: (k: string, v: string) => void store.set(k, v),
	removeItem: (k: string) => void store.delete(k),
};

const { rememberRepoCount } = await import("./repo-count");
const {
	FILTER_KEY,
	FILTER_VERSION,
	defaultGroupBy,
	defaultLanes,
	readStoredFilter,
} = await import("./sidebar-filter");

function write(blob: Record<string, unknown>) {
	store.set(FILTER_KEY, JSON.stringify(blob));
}

beforeEach(() => store.clear());

describe("the default grouping", () => {
	test("an unread list is an inbox, whatever it is grouped by", () => {
		rememberRepoCount(1);
		expect(defaultLanes()).toBe("inbox");
		rememberRepoCount(4);
		expect(defaultLanes()).toBe("inbox");
	});

	test("one project has nothing to group by", () => {
		rememberRepoCount(1);
		expect(defaultGroupBy()).toBe("none");
	});

	test("several projects nest those bands under each one", () => {
		rememberRepoCount(4);
		expect(defaultGroupBy()).toBe("repo");
	});

	// An instance with no project registered yet has nothing to group by
	// either — it is the empty end of the same case.
	test("no projects has nothing to group by", () => {
		rememberRepoCount(0);
		expect(defaultGroupBy()).toBe("none");
	});
});

describe("readStoredFilter", () => {
	test("nothing stored leaves both axes to the defaults", () => {
		const stored = readStoredFilter();
		expect(stored.lanes).toBe("auto");
		expect(stored.groupBy).toBe("auto");
	});

	test("a pick at the current version is honoured", () => {
		write({ v: FILTER_VERSION, lanes: "status", groupBy: "repo" });
		const stored = readStoredFilter();
		expect(stored.lanes).toBe("status");
		expect(stored.groupBy).toBe("repo");
	});

	test("the axes are picked independently", () => {
		write({ v: FILTER_VERSION, lanes: "none" });
		const stored = readStoredFilter();
		expect(stored.lanes).toBe("none");
		expect(stored.groupBy).toBe("auto");
	});

	test("an explicit auto stays auto", () => {
		write({ v: FILTER_VERSION, lanes: "auto", groupBy: "auto" });
		const stored = readStoredFilter();
		expect(stored.lanes).toBe("auto");
		expect(stored.groupBy).toBe("auto");
	});

	// v3 stored one compound grouping, and stored "auto" when nobody picked —
	// so what it names is a real choice, and it decomposes into the pair it
	// always stood for.
	test.each([
		["repo-inbox", "inbox", "repo"],
		["repo-status", "status", "repo"],
		["repo", "none", "repo"],
		["inbox", "inbox", "none"],
		["status", "status", "none"],
	] as const)("v3 %s decomposes into %s lanes grouped by %s", (groupBy, lanes, by) => {
		write({ v: 3, groupBy });
		const stored = readStoredFilter();
		expect(stored.lanes).toBe(lanes);
		expect(stored.groupBy).toBe(by);
	});

	// "recently" was never in the menu, and the sidebar drew it as the plain
	// status lanes — nothing it can decompose into that anyone asked for.
	test("a v3 grouping that was never offered reads as unset", () => {
		write({ v: 3, groupBy: "recently" });
		expect(readStoredFilter().lanes).toBe("auto");
	});

	// Before v3 the whole state persisted together, so "repo-status" on a v2
	// blob is as likely to be that version's default as anyone's choice.
	test("the previous version's default reads as unset", () => {
		write({ v: 2, groupBy: "repo-status", repo: "acme", person: "kent" });
		const stored = readStoredFilter();
		expect(stored.lanes).toBe("auto");
		expect(stored.groupBy).toBe("auto");
		// Everything the person did choose survives the migration.
		expect(stored.repo).toBe("acme");
		expect(stored.person).toBe("kent");
	});

	test("a v2 pick that was never a default survives", () => {
		write({ v: 2, groupBy: "status" });
		const stored = readStoredFilter();
		expect(stored.lanes).toBe("status");
		expect(stored.groupBy).toBe("none");
	});

	// "status" was the default before v2, so a blob older than that says
	// nothing about what its owner wanted.
	test("a pre-v2 status reads as unset", () => {
		write({ groupBy: "status" });
		const stored = readStoredFilter();
		expect(stored.lanes).toBe("auto");
		expect(stored.groupBy).toBe("auto");
	});

	// Empty project bands are the long-standing behaviour, so a blob that
	// never heard of the setting keeps them.
	test("empty projects show unless they were hidden", () => {
		expect(readStoredFilter().emptyProjects).toBe("show");
		write({ v: FILTER_VERSION, emptyProjects: "hide" });
		expect(readStoredFilter().emptyProjects).toBe("hide");
	});

	test("a grouping nobody recognises reads as unset", () => {
		write({ v: FILTER_VERSION, lanes: "sideways", groupBy: "sideways" });
		const stored = readStoredFilter();
		expect(stored.lanes).toBe("auto");
		expect(stored.groupBy).toBe("auto");
	});
});
