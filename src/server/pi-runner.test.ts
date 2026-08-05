/**
 * Focused pi-runner tests: the pure pieces — model-id parsing, the
 * deny-by-default run gate, the local-tool path containment guard (the
 * in-process engine's security invariant), and the custom bash tool's
 * exit-gated completion (wedge regression). The engine turn itself is covered
 * by the smoke harness (POST /api/admin/pi-smoke) against a live bridge, not
 * unit tests.
 */
import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  assertContainedPiPath,
  makeGuardedGrepExecute,
  makeGuardedToolOps,
  makePiBashTool,
  parsePiModel,
  piGateReason,
  runPiSmokeTurn,
} from "./pi-runner";

describe("parsePiModel", () => {
  test("splits pi/<provider>/<model>", () => {
    expect(parsePiModel("pi/anthropic/claude-opus-5")).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-5",
    });
  });

  test("model id may itself contain slashes", () => {
    expect(parsePiModel("pi/openrouter/meta/llama-3")).toEqual({
      providerID: "openrouter",
      modelID: "meta/llama-3",
    });
  });

  test("rejects non-pi ids and malformed remainders", () => {
    expect(parsePiModel("opencode/anthropic/claude-opus-5")).toBeNull();
    expect(parsePiModel("claude-opus-5")).toBeNull();
    expect(parsePiModel("pi/anthropic")).toBeNull();
    expect(parsePiModel("pi/anthropic/")).toBeNull();
    expect(parsePiModel("pi//claude-opus-5")).toBeNull();
  });
});

describe("piGateReason", () => {
  test("interactive and unattended kinds pass", () => {
    for (const kind of ["prompt", "goal", "create", "linear", "slack", "workflow"]) {
      expect(piGateReason({ journal: { kind } })).toBeNull();
    }
    for (const kind of ["automation", "plain", "action", "security-scan", "github-review"]) {
      expect(piGateReason({ journal: { kind } })).toBeNull();
    }
  });

  test("resume/rerun/fallback suffixes resolve to the base kind", () => {
    expect(piGateReason({ journal: { kind: "prompt-resume" } })).toBeNull();
    expect(piGateReason({ journal: { kind: "automation-resume-fallback" } })).toBeNull();
  });

  test("kind-less runs are refused (deny by default)", () => {
    expect(piGateReason({})).toMatch(/explicit run kind/);
    expect(piGateReason({ journal: {} })).toMatch(/explicit run kind/);
  });

  test("unknown kinds are refused by name", () => {
    expect(piGateReason({ journal: { kind: "mystery" } })).toContain('"mystery"');
  });

  test("the smoke kind is refused unless the harness armed its bypass", () => {
    // Request/automation data can NAME the kind, but only runPiSmokeTurn can
    // arm the module-scoped bypass — from out here it must stay refused.
    expect(piGateReason({ journal: { kind: "pi-smoke" } })).toContain('"pi-smoke"');
  });
});

describe("local-tool path containment", () => {
  const ws = mkdtempSync(join(tmpdir(), "pi-guard-"));
  const realWs = realpathSync(ws);
  mkdirSync(join(ws, "sub"));
  writeFileSync(join(ws, "sub", "inside.txt"), "needle-inside\n");
  writeFileSync(join(ws, "top.ts"), "export {};\n");
  symlinkSync("/etc", join(ws, "esc"));
  afterAll(() => rmSync(ws, { recursive: true, force: true }));

  test("assertContainedPiPath allows workspace paths, incl. not-yet-created ones", () => {
    expect(assertContainedPiPath(join(ws, "sub", "inside.txt"), realWs)).toBe(
      join(realWs, "sub", "inside.txt")
    );
    expect(assertContainedPiPath(ws, realWs)).toBe(realWs);
    // write/edit targets that don't exist yet are contained via their
    // nearest existing ancestor
    expect(assertContainedPiPath(join(ws, "newdir", "new.txt"), realWs)).toBe(
      join(realWs, "newdir", "new.txt")
    );
  });

  test("rejects absolute escapes, /proc//sys//dev, and .. traversal", () => {
    expect(() => assertContainedPiPath("/etc/passwd", realWs)).toThrow(/outside the session workspace/);
    expect(() => assertContainedPiPath("/proc/self/environ", realWs)).toThrow(/not accessible/);
    expect(() => assertContainedPiPath("/sys/kernel", realWs)).toThrow(/not accessible/);
    expect(() => assertContainedPiPath("/dev/stdin", realWs)).toThrow(/not accessible/);
    expect(() =>
      assertContainedPiPath(join(ws, "..", "..", "..", "..", "etc", "passwd"), realWs)
    ).toThrow(/outside the session workspace|not accessible/);
  });

  test("rejects symlink escapes, existing and dangling targets", () => {
    expect(() => assertContainedPiPath(join(ws, "esc", "passwd"), realWs)).toThrow(
      /outside the session workspace|not accessible/
    );
    // non-existent path UNDER an escaping symlink still resolves out
    expect(() =>
      assertContainedPiPath(join(ws, "esc", "nope", "x.txt"), realWs)
    ).toThrow(/outside the session workspace|not accessible/);
  });

  test("guarded read/ls/write ops enforce containment; inside paths work", async () => {
    const ops = makeGuardedToolOps(ws);
    expect((await ops.read.readFile(join(ws, "sub", "inside.txt"))).toString()).toContain(
      "needle-inside"
    );
    await expect(ops.read.readFile("/etc/passwd")).rejects.toThrow(/outside/);
    await expect(ops.read.access("/proc/self/environ")).rejects.toThrow(/not accessible/);
    await expect(ops.read.readFile(join(ws, "esc", "passwd"))).rejects.toThrow(/outside/);
    expect(await ops.ls.readdir(ws)).toContain("sub");
    await expect(ops.ls.readdir("/etc")).rejects.toThrow(/outside/);
    await ops.write.mkdir(join(ws, "made"));
    await ops.write.writeFile(join(ws, "made", "ok.txt"), "ok");
    expect((await ops.read.readFile(join(ws, "made", "ok.txt"))).toString()).toBe("ok");
    await expect(ops.write.writeFile("/tmp/pi-guard-escape.txt", "x")).rejects.toThrow(
      /outside/
    );
    await expect(ops.edit.access("/etc/hosts")).rejects.toThrow(/outside/);
  });

  test("guarded find.glob walks in-process, contained, with ignores", async () => {
    const ops = makeGuardedToolOps(ws);
    const hits = await ops.find.glob("*.ts", ws, {
      ignore: ["**/node_modules/**", "**/.git/**"],
      limit: 100,
    });
    expect(hits).toContain(join(ws, "top.ts"));
    await expect(
      Promise.resolve(ops.find.glob("*", "/etc", { ignore: [], limit: 10 }))
    ).rejects.toThrow(/outside/);
  });

  test("guarded grep rejects escapes before any rg spawn", async () => {
    const ops = makeGuardedToolOps(ws);
    const grep = makeGuardedGrepExecute(ws, { PATH: process.env.PATH || "" }, ops.guard);
    await expect(grep("t", { pattern: ".", path: "/proc/self/environ" })).rejects.toThrow(
      /not accessible/
    );
    await expect(grep("t", { pattern: ".", path: "/etc" })).rejects.toThrow(/outside/);
  });

  test.skipIf(!Bun.which("rg"))("guarded grep finds matches via rg with the minimal env", async () => {
    const ops = makeGuardedToolOps(ws);
    const grep = makeGuardedGrepExecute(ws, { PATH: process.env.PATH || "" }, ops.guard);
    const res = await grep("t", { pattern: "needle-inside", path: ws });
    expect(res.content[0]?.text).toMatch(/inside\.txt:1:/);
    expect(res.content[0]?.text).toContain("needle-inside");
  });
});

describe("makePiBashTool exit-gated completion", () => {
  const env = { PATH: process.env.PATH || "/usr/bin:/bin" };
  const tool = makePiBashTool({ cwd: tmpdir(), env, gated: false, unattended: false });

  test("a background child holding stdout does not wedge the tool", async () => {
    const started = Date.now();
    const res = (await (tool as any).execute(
      "t1",
      { command: "echo hi; sleep 15 & echo bye" },
      undefined,
      undefined
    )) as { content: Array<{ text: string }> };
    // Old drain-gated flow blocked on the orphan's inherited pipe for the
    // full 15s (forever for a daemon); exit-gated returns after exit+grace.
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(res.content[0]?.text).toContain("hi");
    expect(res.content[0]?.text).toContain("bye");
  });

  test("timeout kills the process group and reports promptly", async () => {
    const started = Date.now();
    await expect(
      (tool as any).execute("t2", { command: "sleep 60", timeout: 1 }, undefined, undefined)
    ).rejects.toThrow(/timed out/);
    expect(Date.now() - started).toBeLessThan(8_000);
  });

  test("abort kills the process group and reports promptly", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 200);
    const started = Date.now();
    await expect(
      (tool as any).execute("t3", { command: "sleep 60" }, ac.signal, undefined)
    ).rejects.toThrow(/aborted/i);
    expect(Date.now() - started).toBeLessThan(8_000);
  });
});

describe("runPiSmokeTurn with the engine disabled", () => {
  test("pure dry run: config-gate error only, no bridge/SDK/store rows", async () => {
    // Force-disable regardless of the instance's real ~/.opensession-pi.json —
    // this test must never execute a live turn (OPENSESSION_PI_CONFIG is the
    // documented test seam and pi-config reads it fresh per call).
    const prev = process.env.OPENSESSION_PI_CONFIG;
    process.env.OPENSESSION_PI_CONFIG = "/nonexistent/opensession-pi-test.json";
    try {
      const res = await runPiSmokeTurn({ timeoutMs: 5_000 });
      expect(res.ok).toBe(false);
      expect(res.enabled).toBe(false);
      expect(res.dryRun).toBe(true);
      expect(res.eventTypes).toEqual(["error"]);
      expect(res.error || "").toContain("not enabled");
      expect(res.reason || "").toContain("disabled");
      expect(res.storeRows).toBe(0);
      expect(res.timedOut).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.OPENSESSION_PI_CONFIG;
      else process.env.OPENSESSION_PI_CONFIG = prev;
    }
  });
});
