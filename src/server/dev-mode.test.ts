import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { devInstanceBootError, isDevInstance } from "./dev-mode";
import { __resetRenameCompatForTest, stateDir, statePath } from "./rename-compat";

const SAVED_KEYS = [
	"OPENSESSION_DEV",
	"BACKSTAGE_DEV",
	"OPENSESSION_STATE_DIR",
	"OPENSESSION_CHATS_DIR",
	"BACKSTAGE_CHATS_DIR",
	"OPENSESSION_PROFILE",
	"HOME",
] as const;
const saved: Record<string, string | undefined> = {};
let scratch = "";

beforeEach(() => {
	for (const k of SAVED_KEYS) {
		saved[k] = process.env[k];
		delete process.env[k];
	}
	// HOME must stay set — statePath falls back to os.homedir() without it.
	scratch = mkdtempSync(join(tmpdir(), "os-dev-mode-"));
	process.env.HOME = join(scratch, "home");
	mkdirSync(process.env.HOME, { recursive: true });
	__resetRenameCompatForTest();
});

afterEach(() => {
	for (const k of SAVED_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
	__resetRenameCompatForTest();
	rmSync(scratch, { recursive: true, force: true });
});

describe("isDevInstance", () => {
	test("true iff OPENSESSION_DEV=1", () => {
		expect(isDevInstance()).toBe(false);
		process.env.OPENSESSION_DEV = "1";
		expect(isDevInstance()).toBe(true);
	});

	test("only the literal '1' enables it", () => {
		for (const v of ["0", "true", "yes", ""]) {
			process.env.OPENSESSION_DEV = v;
			expect(isDevInstance()).toBe(false);
		}
	});

	test("legacy BACKSTAGE_DEV alias still works", () => {
		process.env.BACKSTAGE_DEV = "1";
		expect(isDevInstance()).toBe(true);
	});
});

describe("devInstanceBootError", () => {
	test("null when not a dev instance", () => {
		expect(devInstanceBootError({})).toBeNull();
		expect(devInstanceBootError({ OPENSESSION_DEV: "0" })).toBeNull();
	});

	test("refuses a dev instance with no state isolation", () => {
		expect(devInstanceBootError({ OPENSESSION_DEV: "1" })).toContain(
			"OPENSESSION_STATE_DIR",
		);
		expect(devInstanceBootError({ BACKSTAGE_DEV: "1" })).not.toBeNull();
		// Empty strings are not isolation.
		expect(
			devInstanceBootError({ OPENSESSION_DEV: "1", OPENSESSION_STATE_DIR: "" }),
		).not.toBeNull();
	});

	test("accepts OPENSESSION_STATE_DIR or a chats-dir override", () => {
		expect(
			devInstanceBootError({ OPENSESSION_DEV: "1", OPENSESSION_STATE_DIR: "/x" }),
		).toBeNull();
		expect(
			devInstanceBootError({ OPENSESSION_DEV: "1", OPENSESSION_CHATS_DIR: "/x" }),
		).toBeNull();
		expect(
			devInstanceBootError({ OPENSESSION_DEV: "1", BACKSTAGE_CHATS_DIR: "/x" }),
		).toBeNull();
	});

	test("defaults to process.env", () => {
		process.env.OPENSESSION_DEV = "1";
		expect(devInstanceBootError()).not.toBeNull();
		process.env.OPENSESSION_STATE_DIR = "/x";
		expect(devInstanceBootError()).toBeNull();
	});
});

describe("statePath with OPENSESSION_STATE_DIR", () => {
	test("resolves strictly under the state root, no legacy dual-read", () => {
		const home = process.env.HOME!;
		const stateRoot = join(scratch, "state");
		mkdirSync(stateRoot, { recursive: true });
		// Legacy name exists under HOME: without the knob, dual-read picks it…
		mkdirSync(join(home, ".backstage-foo"), { recursive: true });
		expect(statePath(".opensession-foo", ".backstage-foo")).toBe(
			join(home, ".backstage-foo"),
		);
		// …with the knob set, the same name resolves under the root (fresh
		// namespace — the cache is keyed on the root, so no reset needed).
		process.env.OPENSESSION_STATE_DIR = stateRoot;
		expect(statePath(".opensession-foo", ".backstage-foo")).toBe(
			join(stateRoot, ".opensession-foo"),
		);
		// Even a legacy name INSIDE the root is ignored: strictly the new name.
		mkdirSync(join(stateRoot, ".backstage-bar"), { recursive: true });
		expect(statePath(".opensession-bar", ".backstage-bar")).toBe(
			join(stateRoot, ".opensession-bar"),
		);
	});

	test("unsetting the knob returns to HOME resolution (cache keyed on root)", () => {
		const stateRoot = join(scratch, "state");
		process.env.OPENSESSION_STATE_DIR = stateRoot;
		expect(stateDir("baz")).toBe(join(stateRoot, ".opensession-baz"));
		delete process.env.OPENSESSION_STATE_DIR;
		expect(stateDir("baz")).toBe(join(process.env.HOME!, ".opensession-baz"));
	});
});

describe("chats-dir resolution with OPENSESSION_STATE_DIR", () => {
	// paths.ts resolves its dir once at module load — re-import cache-busted.
	let n = 0;
	async function freshChatsDir(): Promise<string> {
		const spec = `./paths?dev-mode-test=${++n}`;
		const mod = (await import(spec as string)) as {
			OPENSESSION_CHATS_DIR: string;
		};
		return mod.OPENSESSION_CHATS_DIR;
	}

	test("uses <stateRoot>/.opensession-chats when set", async () => {
		const stateRoot = join(scratch, "state");
		process.env.OPENSESSION_STATE_DIR = stateRoot;
		expect(await freshChatsDir()).toBe(join(stateRoot, ".opensession-chats"));
	});

	test("OPENSESSION_CHATS_DIR still wins over the state root", async () => {
		process.env.OPENSESSION_STATE_DIR = join(scratch, "state");
		process.env.OPENSESSION_CHATS_DIR = join(scratch, "chats-override");
		expect(await freshChatsDir()).toBe(join(scratch, "chats-override"));
	});

	test("default resolution is unchanged without the knob", async () => {
		expect(await freshChatsDir()).toBe(
			join(process.env.HOME!, ".opensession-chats"),
		);
	});
});
