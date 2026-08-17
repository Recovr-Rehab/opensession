import { describe, expect, test } from "bun:test";
import {
	canvasCardMatches,
	canvasCardPerson,
	canvasFilterActive,
	canvasFilterOptions,
	type CanvasFilter,
} from "./canvas-filter";
import { AGENT_PERSON_KEY } from "./automation-audience";
import type { UnifiedSession } from "./types";

function session(over: Partial<UnifiedSession> = {}): UnifiedSession {
	return {
		id: over.id || "os-1",
		title: "A session",
		createdAt: "2026-08-17T10:00:00.000Z",
		lastActivity: "2026-08-17T11:00:00.000Z",
		...over,
	} as UnifiedSession;
}

const everyone: CanvasFilter = { person: "everyone", repo: "all" };

describe("canvasFilterActive", () => {
	test("the default board is not filtered", () => {
		expect(canvasFilterActive(everyone)).toBe(false);
		expect(canvasFilterActive({ person: "me", repo: "all" })).toBe(true);
		expect(canvasFilterActive({ person: "everyone", repo: "opensession" })).toBe(
			true,
		);
	});
});

describe("canvasCardPerson", () => {
	test("a person's card is keyed on their first name, however it is spelled", () => {
		expect(canvasCardPerson(session({ createdBy: "Kent de Bruin" }))).toBe("kent");
		expect(canvasCardPerson(session({ startedBy: "KENT" }))).toBe("kent");
	});

	test("an automation run belongs to the agent, not to whoever set it up", () => {
		expect(
			canvasCardPerson(session({ automation: "Nightly sweep", createdBy: "Kent" })),
		).toBe(AGENT_PERSON_KEY);
	});

	test("a goal wake belongs to the agent, not to the goal's own title", () => {
		// The server stamps "<goal name> (goal)" as the creator, which read as a
		// person offers a whole sentence in the person menu.
		expect(
			canvasCardPerson(
				session({ goalId: "goal-1", createdBy: "Improve Tella SEO visibility (goal)" }),
			),
		).toBe(AGENT_PERSON_KEY);
	});

	test("a session with no creator belongs to nobody", () => {
		expect(canvasCardPerson(session())).toBe("");
	});
});

describe("canvasCardMatches", () => {
	test("everyone + all repos keeps every card", () => {
		expect(canvasCardMatches(session(), everyone, "Kent")).toBe(true);
	});

	test("me matches on the signed-in person, whatever their full name", () => {
		const mine = session({ createdBy: "Kent de Bruin" });
		const theirs = session({ createdBy: "Michiel" });
		const filter: CanvasFilter = { person: "me", repo: "all" };
		expect(canvasCardMatches(mine, filter, "Kent")).toBe(true);
		expect(canvasCardMatches(theirs, filter, "Kent")).toBe(false);
	});

	test("nobody signed in: me narrows nothing rather than emptying the board", () => {
		const filter: CanvasFilter = { person: "me", repo: "all" };
		expect(canvasCardMatches(session({ createdBy: "Kent" }), filter, "")).toBe(true);
	});

	test("a teammate's lens leaves the agent's runs off the board", () => {
		const filter: CanvasFilter = { person: "michiel", repo: "all" };
		expect(
			canvasCardMatches(session({ createdBy: "Michiel" }), filter, "Kent"),
		).toBe(true);
		expect(
			canvasCardMatches(session({ automation: "Nightly sweep" }), filter, "Kent"),
		).toBe(false);
	});

	test("the agent's lens keeps the automation runs", () => {
		const filter: CanvasFilter = { person: AGENT_PERSON_KEY, repo: "all" };
		expect(
			canvasCardMatches(session({ automation: "Nightly sweep" }), filter, "Kent"),
		).toBe(true);
		expect(canvasCardMatches(session({ createdBy: "Kent" }), filter, "Kent")).toBe(
			false,
		);
	});

	test("a repo filter matches the session's own checkout", () => {
		const filter: CanvasFilter = { person: "everyone", repo: "opensession" };
		expect(canvasCardMatches(session({ repo: "opensession" }), filter, "Kent")).toBe(
			true,
		);
		expect(
			canvasCardMatches(session({ repo: "tella-fusion" }), filter, "Kent"),
		).toBe(false);
	});

	test("a repo-less session never answers to a repo filter", () => {
		// sessionRepo would otherwise hand it the instance's default repo, which
		// is how scratch sessions turn up under a repo they have nothing to do with.
		const scratch = session({ repoLess: true });
		expect(
			canvasCardMatches(scratch, { person: "everyone", repo: "opensession" }, "Kent"),
		).toBe(false);
		expect(canvasCardMatches(scratch, everyone, "Kent")).toBe(true);
	});

	test("the two filters narrow together", () => {
		const filter: CanvasFilter = { person: "me", repo: "opensession" };
		expect(
			canvasCardMatches(
				session({ createdBy: "Kent", repo: "opensession" }),
				filter,
				"Kent",
			),
		).toBe(true);
		expect(
			canvasCardMatches(
				session({ createdBy: "Kent", repo: "tella-fusion" }),
				filter,
				"Kent",
			),
		).toBe(false);
	});
});

describe("canvasFilterOptions", () => {
	test("offers the repos and people on the board, busiest first", () => {
		const options = canvasFilterOptions([
			session({ id: "1", createdBy: "Kent", repo: "tella-fusion" }),
			session({ id: "2", createdBy: "Michiel", repo: "opensession" }),
			session({ id: "3", createdBy: "Michiel", repo: "opensession" }),
		]);
		expect(options.repos).toEqual(["opensession", "tella-fusion"]);
		expect(options.people).toEqual([
			{ key: "michiel", label: "Michiel" },
			{ key: "kent", label: "Kent" },
		]);
		expect(options.agent).toBe(false);
	});

	test("the agent is offered only once a run is on the board", () => {
		expect(canvasFilterOptions([session({ createdBy: "Kent" })]).agent).toBe(false);
		expect(
			canvasFilterOptions([session({ automation: "Nightly sweep" })]).agent,
		).toBe(true);
	});

	test("an automation run is not offered as a person of its own", () => {
		const options = canvasFilterOptions([
			session({ automation: "Nightly sweep", createdBy: "Kent" }),
		]);
		expect(options.people).toEqual([]);
	});

	test("a goal's title never reaches the person menu", () => {
		const options = canvasFilterOptions([
			session({ goalId: "goal-1", createdBy: "Improve Tella SEO visibility (goal)" }),
		]);
		expect(options.people).toEqual([]);
		expect(options.agent).toBe(true);
	});

	test("a repo-less session votes for no repo", () => {
		expect(canvasFilterOptions([session({ repoLess: true })]).repos).toEqual([]);
	});
});
