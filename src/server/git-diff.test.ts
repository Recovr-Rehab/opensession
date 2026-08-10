import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { getSessionDiff } from "./git-diff";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("getSessionDiff", () => {
  test("coalesces concurrent reads of the same worktree", async () => {
    const dir = mkdtempSync(join(tmpdir(), "opensession-git-diff-"));
    dirs.push(dir);
    const env = {
      ...process.env,
      GIT_AUTHOR_NAME: "Open Session Test",
      GIT_AUTHOR_EMAIL: "test@opensession.local",
      GIT_COMMITTER_NAME: "Open Session Test",
      GIT_COMMITTER_EMAIL: "test@opensession.local",
    };
    expect(Bun.spawnSync(["git", "init", "-b", "main"], { cwd: dir, env }).exitCode).toBe(0);
    writeFileSync(join(dir, "file.txt"), "before\n");
    expect(Bun.spawnSync(["git", "add", "file.txt"], { cwd: dir, env }).exitCode).toBe(0);
    expect(Bun.spawnSync(["git", "commit", "-m", "initial"], { cwd: dir, env }).exitCode).toBe(0);
    writeFileSync(join(dir, "file.txt"), "after\n");

    const first = getSessionDiff(dir);
    const second = getSessionDiff(dir);

    expect(second).toBe(first);
    const result = await first;
    expect(result.rawPatch).toContain("+after");
    expect(result.diffVersion).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const next = getSessionDiff(dir);
    expect(next).not.toBe(first);
    await next;
  });

	test("keeps non-ASCII paths literal in patches", async () => {
		const dir = mkdtempSync(join(tmpdir(), "opensession-git-diff-unicode-"));
		dirs.push(dir);
		const env = {
			...process.env,
			GIT_AUTHOR_NAME: "Open Session Test",
			GIT_AUTHOR_EMAIL: "test@opensession.local",
			GIT_COMMITTER_NAME: "Open Session Test",
			GIT_COMMITTER_EMAIL: "test@opensession.local",
		};
		writeFileSync(join(dir, "café.ts"), "export const value = 1;\n");
		expect(Bun.spawnSync(["git", "init", "-b", "main"], { cwd: dir, env }).exitCode).toBe(0);
		expect(Bun.spawnSync(["git", "add", "café.ts"], { cwd: dir, env }).exitCode).toBe(0);
		expect(Bun.spawnSync(["git", "commit", "-m", "initial"], { cwd: dir, env }).exitCode).toBe(0);
		writeFileSync(join(dir, "café.ts"), "export const value = 2;\n");

		const result = await getSessionDiff(dir);
		expect(result.rawPatch).toContain("café.ts");
		expect(result.files[0]?.path).toBe("café.ts");
	});
});
