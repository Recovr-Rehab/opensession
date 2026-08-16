import { describe, expect, test } from "bun:test";
import type { InstalledArtifact, PackageManifest } from "../../src/server/plugins";
import {
	applyPlan,
	automationKey,
	planInstall,
	recipeFor,
	removeInstalled,
	resolveSource,
	reviewLines,
	type InstanceState,
	type InstanceStores,
} from "./plugins";

const MANIFEST: PackageManifest = {
	name: "loom",
	version: "1.0.0",
	description: "Your Loom videos as a project.",
	mcpServers: {
		loom: { type: "http", url: "https://mcp.loom.example/mcp", headers: { Authorization: "${LOOM_TOKEN}" } },
	},
	feeds: [
		{
			id: "loom",
			title: "Loom",
			refKind: "loom",
			mcpServers: ["loom"],
			items: { server: "loom", tool: "list_videos", map: { id: "id", title: "name" } },
		},
	],
	automations: [
		{
			id: "weekly",
			label: "Weekly digest",
			automation: { name: "Loom weekly digest", prompt: "Summarise last week.", schedule: "0 9 * * 1" },
		},
	],
	skills: ["skills/loom-editing"],
};

/**
 * The stores as maps. The port exists so a test never has to point the real
 * feeds or config writers at a scratch directory, which is one env var away
 * from writing into the live instance.
 */
function fakeStores(options: { failOn?: string } = {}) {
	const mcp = new Map<string, unknown>();
	const feeds = new Map<string, unknown>();
	const automations = new Map<string, string>();
	const skills = new Map<string, string>();

	const stores: InstanceStores = {
		async state(): Promise<InstanceState> {
			return {
				mcpServers: [...mcp.keys()],
				feeds: [...feeds.keys()],
				automations: new Set(automations.keys()),
				skills: [...skills.keys()],
			};
		},
		addMcpServer(name, entry, allowedUsers) {
			if (options.failOn === `mcp:${name}`) throw new Error("boom");
			mcp.set(name, allowedUsers ? { ...(entry as object), allowedUsers } : entry);
		},
		removeMcpServer(name) {
			mcp.delete(name);
		},
		upsertFeed(feed) {
			const id = (feed as { id: string }).id;
			if (options.failOn === `feed:${id}`) throw new Error("boom");
			feeds.set(id, feed);
		},
		removeFeed(id) {
			feeds.delete(id);
		},
		async addAutomation(recipe, createdBy) {
			const key = automationKey(recipe.automation);
			if (options.failOn === `automation:${key}`) throw new Error("boom");
			automations.set(key, createdBy);
		},
		async removeAutomation(recipe) {
			automations.delete(automationKey(recipe.automation));
		},
		addSkill(name, sourceDir) {
			if (options.failOn === `skill:${name}`) throw new Error("boom");
			skills.set(name, sourceDir);
			return `sha-${name}`;
		},
		removeSkill(name) {
			skills.delete(name);
		},
	};

	return { stores, mcp, feeds, automations, skills };
}

async function install(
	fake: ReturnType<typeof fakeStores>,
	manifest = MANIFEST,
	owned: InstalledArtifact[] = [],
	allowedUsers?: string[],
) {
	const plan = planInstall(manifest, await fake.stores.state(), owned);
	const record = await applyPlan({
		manifest,
		plan,
		stores: fake.stores,
		dir: "/tmp/pkg",
		source: "acme/opensession-loom",
		commit: "deadbeef",
		allowedUsers,
	});
	return { plan, record };
}

describe("resolveSource", () => {
	test("owner/repo becomes a GitHub clone URL", () => {
		expect(resolveSource("acme/opensession-loom")).toEqual({
			url: "https://github.com/acme/opensession-loom.git",
		});
	});

	test("git URLs and local paths pass through", () => {
		expect(resolveSource("https://git.example/x.git")).toEqual({ url: "https://git.example/x.git" });
		expect(resolveSource("git@github.com:acme/x.git")).toEqual({ url: "git@github.com:acme/x.git" });
		expect(resolveSource("/tmp/pkg")).toEqual({ url: "/tmp/pkg" });
	});

	// ext:: is remote command execution wearing a URL costume, and a leading
	// dash is an argument pretending to be a source.
	test("command-execution transports and argument injection are refused", () => {
		expect(resolveSource("ext::sh -c 'id'")).toHaveProperty("error");
		expect(resolveSource("--upload-pack=touch /tmp/x")).toHaveProperty("error");
		expect(resolveSource("")).toHaveProperty("error");
		expect(resolveSource("not a source")).toHaveProperty("error");
	});
});

describe("planInstall", () => {
	const empty: InstanceState = { mcpServers: [], feeds: [], automations: new Set(), skills: [] };

	test("every artifact in the manifest becomes an add", () => {
		const plan = planInstall(MANIFEST, empty);
		expect(plan.actions.map((a) => `${a.kind}:${a.ref}`)).toEqual([
			"mcp:loom",
			"feed:loom",
			"automation:Loom weekly digest",
			"skill:loom-editing",
		]);
		expect(plan.actions.every((a) => a.verb === "add")).toBe(true);
		expect(plan.conflicts).toEqual([]);
	});

	test("a name already taken by somebody else is a conflict, not a merge", () => {
		const plan = planInstall(MANIFEST, { ...empty, mcpServers: ["loom"] });
		expect(plan.conflicts).toHaveLength(1);
		expect(plan.conflicts[0]).toContain("not from this package");
		expect(plan.actions.map((a) => a.kind)).not.toContain("mcp");
	});

	test("a name this package already owns is an update", () => {
		const owned: InstalledArtifact[] = [{ kind: "mcp", ref: "loom" }];
		const plan = planInstall(MANIFEST, { ...empty, mcpServers: ["loom"] }, owned);
		expect(plan.conflicts).toEqual([]);
		expect(plan.actions.find((a) => a.kind === "mcp")?.verb).toBe("update");
	});

	test("an artifact the new manifest drops becomes a removal", () => {
		const owned: InstalledArtifact[] = [
			{ kind: "mcp", ref: "loom" },
			{ kind: "feed", ref: "gone" },
		];
		const plan = planInstall(MANIFEST, { ...empty, mcpServers: ["loom"], feeds: ["gone"] }, owned);
		expect(plan.removals).toEqual([{ kind: "feed", ref: "gone" }]);
	});

	test("a feed pointing at a server nobody installs warns without blocking", () => {
		const manifest = { ...MANIFEST, mcpServers: undefined };
		const plan = planInstall(manifest, empty);
		expect(plan.conflicts).toEqual([]);
		expect(plan.warnings[0]).toContain("not installed");
	});

	test("the review names every artifact it would write", () => {
		const lines = reviewLines(MANIFEST, planInstall(MANIFEST, empty)).join("\n");
		expect(lines).toContain("mcp.loom.example");
		expect(lines).toContain("LOOM_TOKEN");
		expect(lines).toContain("installs disabled");
	});
});

describe("recipeFor", () => {
	test("a package automation always installs disabled", () => {
		const recipe = recipeFor("loom", {
			id: "weekly",
			automation: { name: "n", prompt: "p", enabled: true },
		});
		expect(recipe.id).toBe("loom/weekly");
		expect(recipe.automation.enabled).toBe(false);
	});
});

describe("install and remove", () => {
	test("installing writes every artifact and records what it wrote", async () => {
		const fake = fakeStores();
		const { record } = await install(fake);
		expect([...fake.mcp.keys()]).toEqual(["loom"]);
		expect([...fake.feeds.keys()]).toEqual(["loom"]);
		expect([...fake.automations.keys()]).toEqual(["Loom weekly digest"]);
		expect([...fake.skills.keys()]).toEqual(["loom-editing"]);
		expect(fake.automations.get("Loom weekly digest")).toBe("opensession package: loom");
		expect(record.artifacts).toEqual([
			{ kind: "mcp", ref: "loom" },
			{ kind: "feed", ref: "loom" },
			{ kind: "automation", ref: "Loom weekly digest" },
			{ kind: "skill", ref: "loom-editing", hash: "sha-loom-editing" },
		]);
		expect(record.commit).toBe("deadbeef");
		expect(record.updatedAt).toBeUndefined();
	});

	test("installing the same package again changes nothing", async () => {
		const fake = fakeStores();
		const first = await install(fake);
		const before = JSON.stringify([...fake.mcp, ...fake.feeds, ...fake.automations, ...fake.skills]);

		const second = await install(fake, MANIFEST, first.record.artifacts);
		expect(second.plan.conflicts).toEqual([]);
		expect(second.plan.actions.every((a) => a.verb === "update")).toBe(true);
		expect(second.record.artifacts).toEqual(first.record.artifacts);
		expect(JSON.stringify([...fake.mcp, ...fake.feeds, ...fake.automations, ...fake.skills])).toBe(before);
	});

	test("scoping is applied to the servers, and an update keeps it", async () => {
		const fake = fakeStores();
		const first = await install(fake, MANIFEST, [], ["michiel", "kent"]);
		expect(fake.mcp.get("loom")).toMatchObject({ allowedUsers: ["michiel", "kent"] });
		expect(first.record.allowedUsers).toEqual(["michiel", "kent"]);

		await install(fake, MANIFEST, first.record.artifacts, first.record.allowedUsers);
		expect(fake.mcp.get("loom")).toMatchObject({ allowedUsers: ["michiel", "kent"] });
	});

	test("an update drops what the manifest no longer declares", async () => {
		const fake = fakeStores();
		const first = await install(fake);
		const trimmed: PackageManifest = { ...MANIFEST, feeds: [], skills: [] };
		const second = await install(fake, trimmed, first.record.artifacts);
		expect(second.plan.removals.map((r) => r.ref)).toEqual(["loom", "loom-editing"]);
		expect([...fake.feeds.keys()]).toEqual([]);
		expect([...fake.skills.keys()]).toEqual([]);
		expect([...fake.mcp.keys()]).toEqual(["loom"]);
	});

	test("removing reverses everything, and removing twice is not an error", async () => {
		const fake = fakeStores();
		const { record } = await install(fake);
		await removeInstalled(record, fake.stores);
		expect([...fake.mcp.keys(), ...fake.feeds.keys(), ...fake.automations.keys(), ...fake.skills.keys()]).toEqual([]);
		await removeInstalled(record, fake.stores);
		expect([...fake.mcp.keys(), ...fake.feeds.keys(), ...fake.automations.keys(), ...fake.skills.keys()]).toEqual([]);
	});

	test("install then remove then install lands in the same place", async () => {
		const fake = fakeStores();
		const first = await install(fake);
		await removeInstalled(first.record, fake.stores);
		const again = await install(fake);
		expect(again.record.artifacts).toEqual(first.record.artifacts);
		expect(again.plan.conflicts).toEqual([]);
	});

	// A half-installed package is worse than a failed one: nothing can cleanly
	// remove it, because nothing recorded what landed.
	test("a failure part-way through rolls back what it had already written", async () => {
		const fake = fakeStores({ failOn: "skill:loom-editing" });
		await expect(install(fake)).rejects.toThrow("boom");
		expect([...fake.mcp.keys()]).toEqual([]);
		expect([...fake.feeds.keys()]).toEqual([]);
		expect([...fake.automations.keys()]).toEqual([]);
	});

	test("a rollback leaves a previous install of the same package alone", async () => {
		const fake = fakeStores();
		const first = await install(fake);

		// The same package again, now with a second server that fails.
		const grown: PackageManifest = {
			...MANIFEST,
			mcpServers: { ...MANIFEST.mcpServers, extra: { command: "node" } },
		};
		const failing = fakeStores({ failOn: "mcp:extra" });
		// Reuse the first fake's state by replaying the install into it.
		failing.mcp.set("loom", fake.mcp.get("loom"));
		failing.feeds.set("loom", fake.feeds.get("loom"));
		failing.automations.set("Loom weekly digest", "opensession package: loom");
		failing.skills.set("loom-editing", "/tmp/pkg/skills/loom-editing");

		const plan = planInstall(grown, await failing.stores.state(), first.record.artifacts);
		await expect(
			applyPlan({ manifest: grown, plan, stores: failing.stores, dir: "/tmp/pkg", source: "x" }),
		).rejects.toThrow("boom");
		expect([...failing.mcp.keys()]).toEqual(["loom"]);
		expect([...failing.feeds.keys()]).toEqual(["loom"]);
	});
});
