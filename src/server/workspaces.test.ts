import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// workspaces.ts resolves its directory at module load, so the state dir has to
// be redirected before the import.
let scratch = "";
let previous: string | undefined;
scratch = mkdtempSync(join(tmpdir(), "opensession-workspaces-"));
previous = process.env.OPENSESSION_STATE_DIR;
process.env.OPENSESSION_STATE_DIR = scratch;

const {
	createWorkspace,
	deleteWorkspace,
	getWorkspace,
	listWorkspaces,
	stampWorkspaceIdentity,
	updateWorkspace,
	workspaceName,
} = await import("./workspaces");

afterAll(() => {
	if (previous === undefined) delete process.env.OPENSESSION_STATE_DIR;
	else process.env.OPENSESSION_STATE_DIR = previous;
	rmSync(scratch, { recursive: true, force: true });
});

describe("stampWorkspaceIdentity", () => {
	test("adopts the PR's repo when the workspace was minted in another one", () => {
		// The real shape: a session working in repo A opens a PR in repo B
		// through an attached repo, and the workspace it minted carries repo A.
		const ws = createWorkspace({
			name: "Keep the video playing",
			repo: "opensession",
			createdBy: "Kent",
		});
		const out = stampWorkspaceIdentity(ws.id, {
			key: "ghpr-5678",
			prNumber: 5678,
			branch: "keep-editor-playing-on-tool-switch",
			repo: "tella-fusion",
		});
		expect(out?.repo).toBe("tella-fusion");
		expect(out?.branch).toBe("keep-editor-playing-on-tool-switch");
		expect(getWorkspace(ws.id)?.repo).toBe("tella-fusion");
	});

	test("leaves the repo alone once the workspace owns a branch", () => {
		const ws = createWorkspace({
			name: "Its own branch",
			repo: "opensession",
			createdBy: "Kent",
			branch: "some-branch",
		});
		const out = stampWorkspaceIdentity(ws.id, {
			key: "ghpr-42",
			prNumber: 42,
			branch: "other-branch",
			repo: "tella-fusion",
		});
		expect(out?.repo).toBe("opensession");
		expect(out?.branch).toBe("some-branch");
	});

	test("leaves the repo alone once the workspace owns a worktree", () => {
		const ws = createWorkspace({
			name: "Materialized",
			repo: "opensession",
			createdBy: "Kent",
			worktreeDir: "/home/ubuntu/worktrees/opensession-thing",
		});
		const out = stampWorkspaceIdentity(ws.id, {
			prNumber: 7,
			branch: "b",
			repo: "tella-fusion",
		});
		expect(out?.repo).toBe("opensession");
	});

	test("stamping the same repo is a no-op", () => {
		const ws = createWorkspace({
			name: "Same repo",
			repo: "tella-fusion",
			createdBy: "Kent",
		});
		const out = stampWorkspaceIdentity(ws.id, { prNumber: 9, repo: "tella-fusion" });
		expect(out?.repo).toBe("tella-fusion");
	});
});

// The sessions list stamps each row with this name, so a stale answer would
// title a sidebar row after a workspace's old name (or after a workspace that
// no longer exists) until the server restarted.
describe("workspaceName", () => {
	test("follows create, rename and delete", () => {
		const ws = createWorkspace({ name: "Add sound effects", createdBy: "Kent" });
		expect(workspaceName(ws.id)).toBe("Add sound effects");
		updateWorkspace(ws.id, { name: "Add a sound library" });
		expect(workspaceName(ws.id)).toBe("Add a sound library");
		deleteWorkspace(ws.id);
		expect(workspaceName(ws.id)).toBeNull();
	});

	test("survives identity stamping, which rewrites the file", () => {
		const ws = createWorkspace({ name: "Adopted by a PR", createdBy: "Kent" });
		stampWorkspaceIdentity(ws.id, { key: "ghpr-1", prNumber: 1 });
		expect(workspaceName(ws.id)).toBe("Adopted by a PR");
	});

	test("refuses an unsafe id", () => {
		expect(workspaceName("../etc/passwd")).toBeNull();
	});
});

// Open Session's own repo was renamed, and workspaces written before it still
// say `backstage` on disk. Clients group by the id they are handed, so an
// un-normalized read draws the repo a second sidebar band with no icon.
describe("a repo that has been renamed", () => {
	test("reads back under the id it is registered under now", () => {
		const ws = createWorkspace({
			name: "Written before the rename",
			repo: "opensession",
			createdBy: "Kent",
		});
		writeFileSync(
			join(scratch, ".opensession-workspaces", `${ws.id}.json`),
			JSON.stringify({
				...ws,
				repo: "backstage",
				attachedRepos: [{ repo: "backstage", branch: "main", dir: "/tmp/wt" }],
			}),
		);

		expect(getWorkspace(ws.id)?.repo).toBe("opensession");
		expect(getWorkspace(ws.id)?.attachedRepos?.[0]?.repo).toBe("opensession");
		expect(listWorkspaces().find((w) => w.id === ws.id)?.repo).toBe("opensession");
	});

	test("leaves an id that is registered alone", () => {
		const ws = createWorkspace({
			name: "Written after it",
			repo: "opensession",
			createdBy: "Kent",
		});
		expect(getWorkspace(ws.id)?.repo).toBe("opensession");
	});
});
