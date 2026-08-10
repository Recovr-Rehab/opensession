/**
 * Local Firecracker MicroVM sandbox provider.
 *
 * This reuses the proven preview-pool clone/network/control machinery but
 * requires a separate credential-free, runner-baked golden. Each session gets
 * a COW ext4 disk and restored VM in a transient systemd scope. The engine and
 * volume-style workspace live inside the guest; scoped credentials arrive per
 * launch and the run dials back to Open Session over WebSocket.
 */

import { homeDir } from "../../paths";
import { hostRunBusy } from "../../host-registry";
import { existsSync } from "node:fs";
import { getRepo } from "../../worktree";
import {
  DEFAULT_SANDBOX_PREVIEW_PORTS,
  sandboxCallbackBaseUrl,
  sandboxConfig,
  sandboxProviderConfigured,
} from "../config";
import type {
  PortMap,
  Sandbox,
  SandboxProvider,
  SandboxSessionSpec,
  SandboxStatus,
} from "../provider";
import type { RemotePtyHandle, RemotePtyIo } from "./daytona";
import {
  assertDialbackReachable,
  bootstrapRemoteSandbox,
  findRemoteStateBySession,
  listRemoteStates,
  makeRemoteSandbox,
  readRemoteState,
  remoteCloneUrl,
  removeRemoteState,
  runRemoteLifecycleHook,
  setupRemoteWorkspace,
  touchRemoteState,
  warmRemoteWorkspace,
  withRemoteEnsureLock,
  writeRemoteState,
  type RemoteDriver,
  type RemoteExecOpts,
} from "./bootstrap";
import {
  claimPrewarmOrWait,
  discardClaimedPrewarm,
  type PrewarmAdapter,
} from "../prewarm";

const SCRIPTS = `${process.cwd()}/deploy/sandbox/microvm`;
const CONTROL_PORT = 8080;
const ROOT_CONTROL_PORT = 8081;
const DEFAULT_IDLE_STOP_MINUTES = 5;
const IDLE_SWEEP_MS = 60_000;

function config() {
  const cfg = sandboxConfig().firecrackerMicrovm;
  if (!cfg?.enabled || !sandboxProviderConfigured("microvm")) {
    throw new Error(
      "microvm sandbox provider is not configured — build a clean golden with " +
        "deploy/sandbox/microvm/refresh-sandbox-golden.sh and enable firecrackerMicrovm in ~/.opensession-sandbox.json",
    );
  }
  return cfg;
}

function sandboxId(idx: number): string {
  return `microvm-${idx}`;
}

function indexFromId(id: string): number | null {
  const match = /^microvm-(\d+)$/.exec(id);
  return match ? Number(match[1]) : null;
}

function ipFor(idx: number): string {
  return `10.200.${idx}.2`;
}

function workspacePath(sessionId: string): string {
  const safe = sessionId
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^[^a-zA-Z0-9]+/, "");
  return `${homeDir()}/microvm-workspaces/${safe}`;
}

async function run(
  argv: string[],
  timeoutMs = 180_000,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => proc.kill(9), timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  clearTimeout(timer);
  return { exitCode, stdout, stderr };
}

async function unitRunning(idx: number): Promise<boolean> {
  return (
    await run(
      ["systemctl", "is-active", "--quiet", `os-fc-clone${idx}`],
      5_000,
    )
  ).exitCode === 0;
}

async function request(
  idx: number,
  path: string,
  body?: unknown,
  root = false,
  timeoutMs = 125_000,
): Promise<Response> {
  const response = await fetch(
    `http://${ipFor(idx)}:${root ? ROOT_CONTROL_PORT : CONTROL_PORT}${path}`,
    {
      method: body === undefined ? "GET" : "POST",
      // Firecracker snapshots freeze the guest TCP state. Never let Bun reuse
      // a control connection that predates a restore/clock repair: a stale
      // keep-alive can close before the request receives a response, and POST
      // /exec is not safe to retry blindly after that point.
      headers: {
        Connection: "close",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
  if (!response.ok) {
    throw new Error(
      `Firecracker MicroVM ${idx} ${path} failed: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`,
    );
  }
  return response;
}

function driverFor(idx: number): RemoteDriver {
  return {
    async exec(command: string, opts?: RemoteExecOpts) {
      try {
        const response = await request(
          idx,
          "/exec",
          {
            command,
            cwd: opts?.cwd,
            env: opts?.env,
            timeoutMs: opts?.timeoutMs ?? 120_000,
          },
          false,
          (opts?.timeoutMs ?? 120_000) + 5_000,
        );
        const result = (await response.json()) as {
          exitCode?: number;
          stdout?: string;
          stderr?: string;
        };
        return {
          exitCode: Number(result.exitCode ?? 1),
          stdout: result.stdout || "",
          stderr: result.stderr || "",
        };
      } catch (error) {
        return {
          exitCode: 1,
          stdout: "",
          stderr: String((error as Error)?.message || error),
        };
      }
    },
    async execBackground(command: string, opts?: RemoteExecOpts) {
      await request(idx, "/background", {
        command,
        cwd: opts?.cwd,
        env: opts?.env,
      });
    },
    async writeFile(path: string, content: string) {
      await request(idx, "/files", {
        path,
        content: Buffer.from(content, "utf-8").toString("base64"),
      });
    },
    async ensureStarted() {
      if (!(await unitRunning(idx))) {
        throw new Error(`Firecracker MicroVM ${idx} is not running`);
      }
      await request(idx, "/health", undefined, false, 5_000);
    },
  };
}

const TRANSIENT_CONTROL_ERROR =
  /socket connection was closed|connection reset|econnreset|fetch\(\) failed|fetch failed/i;

/**
 * A restored Firecracker guest can drop its first control connection while
 * the snapshot-frozen network stack settles after the clock repair. Bootstrap
 * commands are deliberately idempotent, so retry only this provisioning
 * driver—not the Sandbox handle used for arbitrary agent execute calls.
 */
export function microvmBootstrapDriver(driver: RemoteDriver): RemoteDriver {
  return {
    ...driver,
    async exec(command: string, opts?: RemoteExecOpts) {
      let result = await driver.exec(command, opts);
      for (let attempt = 1; attempt < 3; attempt++) {
        const detail = `${result.stderr}\n${result.stdout}`;
        if (result.exitCode === 0 || !TRANSIENT_CONTROL_ERROR.test(detail)) {
          return result;
        }
        await Bun.sleep(attempt * 250);
        await driver.ensureStarted().catch(() => {});
        result = await driver.exec(command, opts);
      }
      return result;
    },
  };
}

async function destroyClone(idx: number, storeDir: string): Promise<void> {
  const result = await run(
    ["sudo", "-n", "bash", `${SCRIPTS}/clone.sh`, "destroy", String(idx), storeDir],
    60_000,
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `destroying Firecracker MicroVM ${idx} failed: ${(result.stderr || result.stdout).trim().slice(0, 500)}`,
    );
  }
}

async function pauseClone(idx: number, storeDir: string): Promise<void> {
  const result = await run(
    ["sudo", "-n", "bash", `${SCRIPTS}/clone.sh`, "pause", String(idx), storeDir],
    60_000,
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `pausing Firecracker MicroVM ${idx} failed: ${(result.stderr || result.stdout).trim().slice(0, 500)}`,
    );
  }
}

async function resumeClone(idx: number, storeDir: string): Promise<void> {
  const result = await run(
    ["sudo", "-n", "bash", `${SCRIPTS}/clone.sh`, "resume", String(idx), storeDir],
    180_000,
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `resuming Firecracker MicroVM ${idx} failed: ${(result.stderr || result.stdout).trim().slice(-1000)}`,
    );
  }
}

function cloneDiskExists(idx: number, storeDir: string): boolean {
  return existsSync(`${storeDir}/clone${idx}.ext4`);
}

async function allocateClone(
  storeDir: string,
  indexStart: number,
  indexEnd: number,
): Promise<number> {
  return withRemoteEnsureLock("microvm", "__allocate__", async () => {
    for (let candidate = indexStart; candidate <= indexEnd; candidate++) {
      const result = await run(
        [
          "sudo",
          "-n",
          "bash",
          `${SCRIPTS}/clone.sh`,
          "create",
          String(candidate),
          storeDir,
        ],
        300_000,
      );
      if (result.exitCode === 0) return candidate;
      if (
        result.exitCode === 3 ||
        /already has a live VM/i.test(result.stderr + result.stdout)
      ) {
        continue;
      }
      throw new Error(
        `creating Firecracker MicroVM ${candidate} failed: ${(result.stderr || result.stdout).trim().slice(-1000)}`,
      );
    }
    throw new Error(
      `no free Firecracker MicroVM clone index in ${indexStart}..${indexEnd}`,
    );
  });
}

export class MicrovmProvider implements SandboxProvider {
  readonly id = "microvm" as const;

  ensure(spec: SandboxSessionSpec): Promise<Sandbox> {
    return withRemoteEnsureLock(this.id, spec.sessionId, () =>
      this.ensureInner(spec),
    );
  }

  private async ensureInner(spec: SandboxSessionSpec): Promise<Sandbox> {
    ensureIdleSweep();
    if (spec.attachedDirs?.length) {
      throw new Error(
        "attached repos are not supported in MicroVM sandboxes — detach them or use docker/local",
      );
    }
    const cfg = config();
    let previous = findRemoteStateBySession(this.id, spec.sessionId);
    const repo = getRepo(spec.repo || previous?.repoId);
    const branch = spec.branch || previous?.branch || repo.defaultBranch;
    // Keep workspaces in a guest-only namespace. The runner checkout is baked
    // separately at REMOTE_REPO; the Sandbox handle reports the cloned repo cwd.
    const cwd = previous?.cwd || workspacePath(spec.sessionId);

    let idx = previous ? indexFromId(previous.sandboxId) : null;
    let resumed = false;
    if (idx != null) {
      try {
        if (await unitRunning(idx)) {
          await driverFor(idx).ensureStarted();
        } else if (cloneDiskExists(idx, cfg.storeDir)) {
          await resumeClone(idx, cfg.storeDir);
          await driverFor(idx).ensureStarted();
          resumed = true;
          console.log(`[sandbox:microvm] woke ${sandboxId(idx)} for ${spec.sessionId}`);
        } else {
          throw new Error("durable clone disk is gone");
        }
      } catch {
        await destroyClone(idx, cfg.storeDir).catch(() => {});
        removeRemoteState(this.id, previous!.sandboxId);
        previous = null;
        idx = null;
      }
    }

    let created = false;
    if (idx == null) {
      const claim = await claimPrewarmOrWait(this.id, repo.id, spec.sessionId);
      if (claim) {
        const candidate = indexFromId(claim.sandboxId);
        if (candidate != null) {
          try {
            await driverFor(candidate).ensureStarted();
            idx = candidate;
            created = true;
            console.log(
              `[sandbox:microvm] adopted prewarmed clone ${claim.sandboxId} for ${spec.sessionId}`,
            );
          } catch (error) {
            console.warn(
              `[sandbox:microvm] prewarm adoption failed (cold-creating):`,
              error,
            );
            discardClaimedPrewarm(this.id, claim.sandboxId);
          }
        } else {
          discardClaimedPrewarm(this.id, claim.sandboxId);
        }
      }
    }
    if (idx == null) {
      idx = await allocateClone(cfg.storeDir, cfg.indexStart, cfg.indexEnd);
      created = true;
    }
    if (created) {
      writeRemoteState({
        sandboxId: sandboxId(idx),
        provider: this.id,
        sessionId: spec.sessionId,
        cwd,
        repoId: repo.id,
        branch,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      });
    }

    const driver = driverFor(idx);
    try {
      await driver.ensureStarted();
      // clone.sh repairs the snapshot-frozen clock through the root control
      // port before it returns. Doing it again here can sever an in-flight
      // keep-alive socket when the guest clock jumps.
      const bootstrapDriver = microvmBootstrapDriver(driver);
      const callbackBaseUrl = sandboxCallbackBaseUrl();
      await assertDialbackReachable(
        bootstrapDriver,
        "microvm",
        callbackBaseUrl,
      );
      await bootstrapRemoteSandbox(bootstrapDriver, "microvm");
      await setupRemoteWorkspace(
        driver,
        cwd,
        await remoteCloneUrl(repo),
        branch,
        repo.defaultBranch,
        repo.id,
      );
      if (resumed) {
        await runRemoteLifecycleHook(driver, cwd, "resume", "resume");
      }
    } catch (error) {
      if (created) {
        await destroyClone(idx, cfg.storeDir).catch(() => {});
        removeRemoteState(this.id, sandboxId(idx));
      }
      throw error;
    }
    writeRemoteState({
      sandboxId: sandboxId(idx),
      provider: this.id,
      sessionId: spec.sessionId,
      cwd,
      repoId: repo.id,
      branch,
      createdAt: previous?.createdAt || new Date().toISOString(),
      lastActivityAt: new Date().toISOString(),
    });
    return this.makeHandle(idx, spec.sessionId, cwd);
  }

  private makeHandle(idx: number, sessionId: string, cwd: string): Sandbox {
    const id = sandboxId(idx);
    return makeRemoteSandbox({
      providerId: this.id,
      sandboxId: id,
      sessionId,
      cwd,
      driver: driverFor(idx),
      callbackBaseUrl: sandboxCallbackBaseUrl(),
      async ports(): Promise<PortMap> {
        // The guest veth is host-private, but Caddy runs on this host and can
        // dial it directly. Browser access still goes through the authenticated
        // portal route; the private address is never handed to the client.
        const ports =
          sandboxConfig().previewPorts?.length
            ? sandboxConfig().previewPorts!
            : [...DEFAULT_SANDBOX_PREVIEW_PORTS];
        return Object.fromEntries(
          ports.map((port) => [port, { upstream: `${ipFor(idx)}:${port}` }]),
        );
      },
      async status(): Promise<SandboxStatus> {
        if (!(await unitRunning(idx))) {
          const storeDir =
            sandboxConfig().firecrackerMicrovm?.storeDir ||
            "/opt/firecracker/sandbox-store";
          return cloneDiskExists(idx, storeDir) ? "stopped" : "gone";
        }
        try {
          await request(idx, "/health", undefined, false, 3_000);
          return "running";
        } catch {
          return "stopped";
        }
      },
      touchActivity: () => touchRemoteState(this.id, id),
    });
  }

  async get(id: string): Promise<Sandbox | null> {
    const state = readRemoteState(this.id, id);
    const idx = indexFromId(id);
    if (!state || idx == null) return null;
    if (!(await unitRunning(idx))) {
      return cloneDiskExists(idx, config().storeDir)
        ? this.makeHandle(idx, state.sessionId, state.cwd)
        : null;
    }
    try {
      await driverFor(idx).ensureStarted();
      return this.makeHandle(idx, state.sessionId, state.cwd);
    } catch {
      return null;
    }
  }

  async destroy(id: string): Promise<void> {
    const idx = indexFromId(id);
    if (idx == null) return;
    const cfg = sandboxConfig().firecrackerMicrovm;
    // Cleanup must remain possible after an operator disables/removes the
    // provider block. Custom-store operators should destroy live sessions
    // before removing their config; the default remains recoverable.
    await destroyClone(idx, cfg?.storeDir || "/opt/firecracker/sandbox-store");
    removeRemoteState(this.id, id);
  }

  async pause(id: string): Promise<void> {
    const state = readRemoteState(this.id, id);
    const idx = indexFromId(id);
    if (!state || idx == null || !(await unitRunning(idx))) return;
    if (hostRunBusy(state.sessionId))
      throw new Error(`cannot pause ${id} while its agent run is active`);
    await pauseClone(idx, config().storeDir);
    touchRemoteState(this.id, id);
  }

  async resume(id: string): Promise<Sandbox | null> {
    const state = readRemoteState(this.id, id);
    if (!state) return null;
    return this.ensure({
      sessionId: state.sessionId,
      repo: state.repoId,
      branch: state.branch,
      cwd: state.cwd,
    });
  }
}

/** Real interactive PTY inside a local Firecracker guest. The private control
 * lane exposes bounded start/read/write/resize/close calls; the browser still
 * talks only to Open Session's authenticated UI WebSocket. */
export async function microvmPtySession(
  sandboxIdValue: string,
  cwd: string,
  io: RemotePtyIo,
): Promise<RemotePtyHandle> {
  const idx = indexFromId(sandboxIdValue);
  if (idx == null) throw new Error(`invalid microvm sandbox id ${sandboxIdValue}`);
  const provider = new MicrovmProvider();
  let sandbox = await provider.get(sandboxIdValue);
  if (sandbox && (await sandbox.status()) === "stopped")
    sandbox = await provider.resume(sandboxIdValue);
  if (!sandbox || (await sandbox.status()) !== "running")
    throw new Error(`microvm sandbox ${sandboxIdValue} is unavailable`);
  const started = (await (
    await request(idx, "/pty/start", {
      cwd,
      cols: io.cols,
      rows: io.rows,
    })
  ).json()) as { id?: string };
  if (!started.id) throw new Error("microvm pty did not return an id");
  const id = started.id;
  let closed = false;
  void (async () => {
    try {
      while (!closed) {
        const response = await request(
          idx,
          `/pty/read?id=${encodeURIComponent(id)}&timeoutMs=1000`,
          undefined,
          false,
          5_000,
        );
        const frame = (await response.json()) as {
          data?: string;
          exited?: boolean;
          exitCode?: number | null;
        };
        if (frame.data) io.onData(Buffer.from(frame.data, "base64"));
        if (frame.exited) {
          closed = true;
          io.onExit(frame.exitCode ?? undefined);
        }
      }
    } catch {
      if (!closed) {
        closed = true;
        io.onExit(undefined);
      }
    }
  })();
  const post = (path: string, body: object) =>
    request(idx, path, { id, ...body }).catch(() => undefined);
  return {
    write: (data) => void post("/pty/write", { data: Buffer.from(data).toString("base64") }),
    resize: (cols, rows) => void post("/pty/resize", { cols, rows }),
    close: () => {
      if (closed) return;
      closed = true;
      void post("/pty/close", {});
    },
  };
}

/** Pause idle local MicroVMs while retaining their COW workspace disks. */
export async function sweepIdleMicrovms(onlySandboxId?: string): Promise<void> {
  const cfg = sandboxConfig().firecrackerMicrovm;
  if (!cfg?.enabled) return;
  const idleMs =
    (sandboxConfig().idleStopMinutes || DEFAULT_IDLE_STOP_MINUTES) * 60_000;
  const provider = new MicrovmProvider();
  for (const state of listRemoteStates("microvm")) {
    if (state.sessionId.startsWith("__prewarm__:")) continue;
    if (onlySandboxId && state.sandboxId !== onlySandboxId) continue;
    const idx = indexFromId(state.sandboxId);
    if (idx == null || !(await unitRunning(idx))) continue;
    if (hostRunBusy(state.sessionId)) continue;
    const last = Date.parse(state.lastActivityAt || state.createdAt) || 0;
    if (Date.now() - last < idleMs) continue;
    try {
      console.log(
        `[sandbox:microvm] pausing ${state.sandboxId} after ${Math.round((Date.now() - last) / 60_000)}m idle`,
      );
      await provider.pause(state.sandboxId);
    } catch (error) {
      console.warn(`[sandbox:microvm] idle pause failed for ${state.sandboxId}:`, error);
    }
  }
}

function ensureIdleSweep(): void {
  const globalState = globalThis as any;
  if (globalState.__microvmIdleSweepTimer) return;
  globalState.__microvmIdleSweepTimer = setInterval(() => {
    void sweepIdleMicrovms();
  }, IDLE_SWEEP_MS);
}

// ── Warm-on-typing workspace prewarm hooks ──────────────────────────────────

export const microvmPrewarmAdapter: PrewarmAdapter = {
  async create(labels) {
    const cfg = config();
    const key = labels["opensession.prewarm.key"];
    if (!key?.startsWith("microvm:")) {
      throw new Error(`invalid MicroVM prewarm key: ${key || "(missing)"}`);
    }
    const repoId = key.slice("microvm:".length);
    const idx = await allocateClone(cfg.storeDir, cfg.indexStart, cfg.indexEnd);
    const id = sandboxId(idx);
    try {
      writeRemoteState({
        sandboxId: id,
        provider: "microvm",
        sessionId: `__prewarm__:${key}`,
        cwd: workspacePath(`prewarm-${idx}`),
        repoId,
        createdAt: new Date().toISOString(),
        lastActivityAt: new Date().toISOString(),
      });
      return { sandboxId: id, driver: driverFor(idx) };
    } catch (error) {
      await destroyClone(idx, cfg.storeDir).catch(() => {});
      removeRemoteState("microvm", id);
      throw error;
    }
  },

  async prepare(driver, repo, label) {
    await driver.ensureStarted();
    await bootstrapRemoteSandbox(microvmBootstrapDriver(driver), label);
    if (!(await warmRemoteWorkspace(driver, repo, label, { installDeps: false }))) {
      throw new Error(`MicroVM prewarm could not clone ${repo.id}`);
    }
  },

  async destroy(id) {
    const idx = indexFromId(id);
    if (idx == null) return;
    const cfg = sandboxConfig().firecrackerMicrovm;
    await destroyClone(idx, cfg?.storeDir || "/opt/firecracker/sandbox-store");
    removeRemoteState("microvm", id);
  },

  async listPrewarmed() {
    const out: Array<{ id: string; key: string }> = [];
    for (const state of listRemoteStates("microvm")) {
      if (!state.sessionId.startsWith("__prewarm__:")) continue;
      const idx = indexFromId(state.sandboxId);
      if (idx == null || !(await unitRunning(idx))) continue;
      out.push({
        id: state.sandboxId,
        key: state.sessionId.slice("__prewarm__:".length),
      });
    }
    return out;
  },
};
