import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { UnifiedSession } from "../../server/types";

// Both workspaces.ts and unfurl.ts resolve module-scope state (the workspace
// directory, the UI host) at import, so redirect them before importing.
const scratch = mkdtempSync(join(tmpdir(), "opensession-unfurl-"));
const previousStateDir = process.env.OPENSESSION_STATE_DIR;
const previousUiBase = process.env.OPENSESSION_UI_BASE;
process.env.OPENSESSION_STATE_DIR = scratch;
process.env.OPENSESSION_UI_BASE = "https://os.example.test";

const { createWorkspace } = await import("../../server/workspaces");
const { cardTitle } = await import("./unfurl");

afterAll(() => {
	if (previousStateDir === undefined) delete process.env.OPENSESSION_STATE_DIR;
	else process.env.OPENSESSION_STATE_DIR = previousStateDir;
	if (previousUiBase === undefined) delete process.env.OPENSESSION_UI_BASE;
	else process.env.OPENSESSION_UI_BASE = previousUiBase;
	rmSync(scratch, { recursive: true, force: true });
});

function session(patch: Partial<UnifiedSession>): UnifiedSession {
	return {
		id: "sess-1",
		lastActivity: new Date().toISOString(),
		...patch,
	} as UnifiedSession;
}

describe("cardTitle", () => {
	test("leads with the workspace name and keeps the session title beside it", () => {
		const ws = createWorkspace({ name: "Keep the video playing", createdBy: "Kent" });
		expect(
			cardTitle(session({ title: "Fix the seek bar", workspaceId: ws.id })),
		).toEqual({ title: "Keep the video playing", session: "Fix the seek bar" });
	});

	test("prints one name when the session's title still matches its workspace", () => {
		const ws = createWorkspace({ name: "Ship the unfurl", createdBy: "Kent" });
		expect(cardTitle(session({ title: "Ship the unfurl", workspaceId: ws.id }))).toEqual({
			title: "Ship the unfurl",
			session: undefined,
		});
	});

	// Slack and Linear agent runs have no workspace to be named after.
	test("falls back to the session title when there is no workspace", () => {
		expect(cardTitle(session({ title: "Triage the ticket" }))).toEqual({
			title: "Triage the ticket",
		});
	});

	test("falls back when the workspace id no longer resolves", () => {
		expect(
			cardTitle(session({ title: "Triage the ticket", workspaceId: "ws-gone" })),
		).toEqual({ title: "Triage the ticket" });
	});

	test("falls back to the session id when the session is untitled", () => {
		expect(cardTitle(session({ id: "sess-42" }))).toEqual({ title: "sess-42" });
	});
});
