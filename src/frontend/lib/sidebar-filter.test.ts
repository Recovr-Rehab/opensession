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
const { FILTER_KEY, FILTER_VERSION, defaultGroupBy, readStoredFilter } =
	await import("./sidebar-filter");

function write(blob: Record<string, unknown>) {
	store.set(FILTER_KEY, JSON.stringify(blob));
}

beforeEach(() => store.clear());

describe("defaultGroupBy", () => {
	test("one project reads as a plain inbox", () => {
		rememberRepoCount(1);
		expect(defaultGroupBy()).toBe("inbox");
	});

	test("several projects nest that inbox under each one", () => {
		rememberRepoCount(4);
		expect(defaultGroupBy()).toBe("repo-inbox");
	});

	// An instance with no project registered yet has nothing to group by
	// either — it is the empty end of the same case.
	test("no projects reads as a plain inbox", () => {
		rememberRepoCount(0);
		expect(defaultGroupBy()).toBe("inbox");
	});
});

describe("readStoredFilter", () => {
	test("nothing stored leaves the grouping to the default", () => {
		expect(readStoredFilter().groupBy).toBe("auto");
	});

	test("a grouping picked at the current version is honoured", () => {
		write({ v: FILTER_VERSION, groupBy: "repo-status" });
		expect(readStoredFilter().groupBy).toBe("repo-status");
	});

	test("an explicit auto stays auto", () => {
		write({ v: FILTER_VERSION, groupBy: "auto" });
		expect(readStoredFilter().groupBy).toBe("auto");
	});

	// Before v3 the whole state persisted together, so "repo-status" on a v2
	// blob is as likely to be that version's default as anyone's choice.
	test("the previous version's default reads as unset", () => {
		write({ v: 2, groupBy: "repo-status", repo: "acme", person: "kent" });
		const stored = readStoredFilter();
		expect(stored.groupBy).toBe("auto");
		// Everything the person did choose survives the migration.
		expect(stored.repo).toBe("acme");
		expect(stored.person).toBe("kent");
	});

	test("a v2 pick that was never a default survives", () => {
		write({ v: 2, groupBy: "status" });
		expect(readStoredFilter().groupBy).toBe("status");
	});

	// "status" was the default before v2, so a blob older than that says
	// nothing about what its owner wanted.
	test("a pre-v2 status reads as unset", () => {
		write({ groupBy: "status" });
		expect(readStoredFilter().groupBy).toBe("auto");
	});

	test("a grouping nobody recognises reads as unset", () => {
		write({ v: FILTER_VERSION, groupBy: "sideways" });
		expect(readStoredFilter().groupBy).toBe("auto");
	});
});
