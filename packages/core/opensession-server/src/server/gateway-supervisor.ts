#!/usr/bin/env bun

import {
  chmodSync,
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from "fs";
import { join, resolve } from "path";

export const GATEWAY_CONTROL_SOCKET =
  process.env.OPENSESSION_GATEWAY_CONTROL_SOCKET ||
  "/run/opensession-gateway/control.sock";

const READY_URL = process.env.OPENSESSION_HEALTH_URL || "http://127.0.0.1:3850/ready";
const PRELOAD_TIMEOUT_MS = 30_000;
const EXIT_TIMEOUT_MS = 90_000;
const READY_TIMEOUT_MS = 60_000;

type GatewayIpcMessage = {
  type: string;
  nonce?: string;
  pid?: number;
};

type HandoffRequest = {
  type: "handoff";
  releaseRoot: string;
  sha: string;
};

type ControlResponse = {
  ok: boolean;
  message: string;
  pid?: number;
};

export interface ManagedGateway {
  pid: number;
  releaseRoot: string;
  exited: Promise<number>;
  kill(signal?: number): void;
  activate?(nonce: string): void;
  preloaded?: Promise<void>;
}

export interface GatewaySupervisorDependencies {
  spawn(releaseRoot: string, role: "active" | "standby", nonce?: string): ManagedGateway;
  waitReady(gateway: ManagedGateway): Promise<void>;
  validateRelease(releaseRoot: string, sha: string): string;
  promoteCurrent(releaseRoot: string): void;
  onUnexpectedExit?(gateway: ManagedGateway, code: number): void;
}

function timeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer!));
}

export class GatewaySupervisor {
  private handoffPromise: Promise<ControlResponse> | null = null;
  private standby: ManagedGateway | null = null;
  private shuttingDown = false;

  constructor(
    private active: ManagedGateway,
    private readonly dependencies: GatewaySupervisorDependencies,
  ) {
    this.watchActive(active);
  }

  private watchActive(gateway: ManagedGateway): void {
    void gateway.exited.then((code) => {
      setTimeout(() => {
        if (this.active === gateway && !this.handoffPromise) {
          this.dependencies.onUnexpectedExit?.(gateway, code);
        }
      }, 0);
    });
  }

  private selectActive(gateway: ManagedGateway): void {
    this.active = gateway;
    this.watchActive(gateway);
  }

  activeGateway(): ManagedGateway {
    return this.active;
  }

  handoff(request: HandoffRequest): Promise<ControlResponse> {
    if (this.shuttingDown) {
      return Promise.resolve({ ok: false, message: "gateway supervisor is shutting down" });
    }
    if (this.handoffPromise) {
      return Promise.resolve({ ok: false, message: "a gateway handoff is already in progress" });
    }
    this.handoffPromise = this.performHandoff(request).finally(() => {
      this.handoffPromise = null;
    });
    return this.handoffPromise;
  }

  async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    const children = new Set([this.active, this.standby].filter(Boolean) as ManagedGateway[]);
    for (const child of children) child.kill(child === this.active ? 15 : 9);
    await Promise.all([...children].map((child) => child.exited.catch(() => 0)));
  }

  private async performHandoff(request: HandoffRequest): Promise<ControlResponse> {
    const releaseRoot = this.dependencies.validateRelease(request.releaseRoot, request.sha);
    if (releaseRoot === this.active.releaseRoot) {
      return { ok: true, message: "gateway already runs the requested release", pid: this.active.pid };
    }

    const previous = this.active;
    const nonce = crypto.randomUUID();
    const candidate = this.dependencies.spawn(releaseRoot, "standby", nonce);
    this.standby = candidate;
    let previousExited = false;
    try {
      if (!candidate.preloaded || !candidate.activate) {
        throw new Error("standby gateway did not expose the activation protocol");
      }
      await timeout(
        candidate.preloaded,
        PRELOAD_TIMEOUT_MS,
        "candidate gateway did not preload in time",
      );

      if (this.shuttingDown) throw new Error("gateway supervisor is shutting down");
      previous.kill(15);
      try {
        await timeout(
          previous.exited,
          EXIT_TIMEOUT_MS,
          "active gateway did not exit before the handoff deadline",
        );
      } catch {
        console.warn("[gateway-supervisor] active gateway missed its exit deadline; forcing the fenced process down");
        previous.kill(9);
        await timeout(
          previous.exited,
          5_000,
          "active gateway survived SIGKILL",
        );
      }
      previousExited = true;
      if (this.shuttingDown) throw new Error("gateway supervisor is shutting down");

      // Pointer and process authority move as one transaction. A supervisor or
      // host crash from here boots the candidate; failure below restores the
      // pointer before the previous release is started again.
      this.dependencies.promoteCurrent(releaseRoot);
      candidate.activate(nonce);
      this.selectActive(candidate);
      await timeout(
        this.dependencies.waitReady(candidate),
        READY_TIMEOUT_MS,
        "candidate gateway did not become ready in time",
      );
      this.standby = null;
      return {
        ok: true,
        message: "gateway handoff completed",
        pid: candidate.pid,
      };
    } catch (error) {
      candidate.kill(9);
      await candidate.exited.catch(() => 0);
      if (this.standby === candidate) this.standby = null;
      const message = error instanceof Error ? error.message : String(error);
      if (this.shuttingDown) {
        return { ok: false, message };
      }
      if (!previousExited) {
        return { ok: false, message: `candidate rejected before cut-over: ${message}` };
      }

      this.dependencies.promoteCurrent(previous.releaseRoot);
      const rollback = this.dependencies.spawn(previous.releaseRoot, "active");
      this.selectActive(rollback);
      try {
        await timeout(
          this.dependencies.waitReady(rollback),
          READY_TIMEOUT_MS,
          "rollback gateway did not become ready in time",
        );
        return { ok: false, message: `candidate failed after cut-over; previous gateway restored: ${message}` };
      } catch (rollbackError) {
        console.error("[gateway-supervisor] rollback failed", rollbackError);
        process.exitCode = 1;
        setTimeout(() => process.exit(1), 0);
        return { ok: false, message: `candidate and rollback gateway failed: ${message}` };
      }
    }
  }
}

function deferred(): {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
} {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

export function spawnGateway(
  releaseRoot: string,
  role: "active" | "standby",
  nonce?: string,
  entry = "packages/core/opensession-server/opensession.ts",
): ManagedGateway {
  const preloaded = deferred();
  let expectedNonce = nonce;
  const child = Bun.spawn(
    [process.execPath, "run", entry],
    {
      cwd: releaseRoot,
      env: {
        ...process.env,
        OPENSESSION_GATEWAY_ROLE: role,
        ...(nonce ? { OPENSESSION_GATEWAY_NONCE: nonce } : {}),
      },
      stdin: "ignore",
      stdout: "inherit",
      stderr: "inherit",
      ipc(message) {
        const value = message as GatewayIpcMessage;
        if (
          role === "standby" &&
          value?.type === "opensession_gateway_preloaded" &&
          value.nonce === expectedNonce &&
          value.pid === child.pid
        ) {
          preloaded.resolve();
        }
      },
    },
  );
  const exited = child.exited.then((code) => {
    if (role === "standby") {
      preloaded.reject(new Error(`candidate gateway exited during preload (${code})`));
    }
    return code;
  });
  return {
    pid: child.pid,
    releaseRoot,
    exited,
    kill(signal = 15) {
      child.kill(signal);
    },
    ...(role === "standby"
      ? {
          preloaded: preloaded.promise,
          activate(activationNonce: string) {
            if (activationNonce !== expectedNonce) {
              throw new Error("gateway activation nonce mismatch");
            }
            child.send({
              type: "opensession_gateway_activate",
              nonce: activationNonce,
            });
            expectedNonce = undefined;
          },
        }
      : {}),
  };
}

export function validateGatewayRelease(
  releaseRoot: string,
  sha: string,
  releasesRoot = process.env.OPENSESSION_DEPLOY_STATE
    ? join(process.env.OPENSESSION_DEPLOY_STATE, "releases")
    : join(process.env.HOME || "", ".opensession/deploy/releases"),
): string {
  if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error("invalid release sha");
  const root = realpathSync(releaseRoot);
  const allowed = `${realpathSync(releasesRoot)}/`;
  if (!root.startsWith(allowed)) throw new Error("candidate is outside the immutable release store");
  const marker = readFileSync(join(root, ".opensession-release"), "utf8").trim();
  if (marker !== sha) throw new Error("candidate release marker does not match the requested sha");
  if (!existsSync(join(root, ".frontend-dist", ".bundle-meta.json"))) {
    throw new Error("candidate frontend was not prepared");
  }
  return root;
}

async function waitForGatewayReady(gateway: ManagedGateway): Promise<void> {
  for (;;) {
    const state = await Promise.race([
      gateway.exited.then((code) => ({ exited: code } as const)),
      fetch(READY_URL, { signal: AbortSignal.timeout(1_000) })
        .then(async (response) => ({
          ready: response.ok && (await response.json() as { ok?: boolean }).ok === true,
        } as const))
        .catch(() => ({ ready: false } as const)),
    ]);
    if ("exited" in state) throw new Error(`gateway exited before readiness (${state.exited})`);
    if (state.ready) return;
    await Bun.sleep(100);
  }
}

export function promoteGatewayCurrent(
  releaseRoot: string,
  state = process.env.OPENSESSION_DEPLOY_STATE ||
    join(process.env.HOME || "", ".opensession/deploy"),
): void {
  const target = realpathSync(releaseRoot);
  const current = join(state, "current");
  const next = join(state, `.gateway-current.${process.pid}`);
  if (existsSync(next)) unlinkSync(next);
  symlinkSync(target, next);
  renameSync(next, current);
}

function currentReleaseRoot(): string {
  const state = process.env.OPENSESSION_DEPLOY_STATE ||
    join(process.env.HOME || "", ".opensession/deploy");
  return realpathSync(join(state, "current"));
}

function serveControl(supervisor: GatewaySupervisor): ReturnType<typeof Bun.listen> {
  if (existsSync(GATEWAY_CONTROL_SOCKET)) unlinkSync(GATEWAY_CONTROL_SOCKET);
  const listener = Bun.listen({
    unix: GATEWAY_CONTROL_SOCKET,
    socket: {
      open(socket) {
        (socket as any).__buffer = "";
      },
      data(socket, chunk) {
        const value = `${(socket as any).__buffer}${Buffer.from(chunk).toString("utf8")}`;
        const newline = value.indexOf("\n");
        if (newline === -1) {
          if (value.length > 16_384) socket.end();
          else (socket as any).__buffer = value;
          return;
        }
        (socket as any).__buffer = "";
        void (async () => {
          let response: ControlResponse;
          try {
            const request = JSON.parse(value.slice(0, newline)) as HandoffRequest;
            if (request.type !== "handoff") throw new Error("unknown supervisor request");
            response = await supervisor.handoff(request);
          } catch (error) {
            response = { ok: false, message: error instanceof Error ? error.message : String(error) };
          }
          socket.end(`${JSON.stringify(response)}\n`);
        })();
      },
      error(_socket, error) {
        console.error("[gateway-supervisor] control socket error", error);
      },
    },
  });
  chmodSync(GATEWAY_CONTROL_SOCKET, 0o600);
  return listener;
}

async function requestHandoff(releaseRoot: string, sha: string): Promise<ControlResponse> {
  return new Promise((resolveResponse, reject) => {
    let body = "";
    const timer = setTimeout(() => reject(new Error("gateway supervisor request timed out")), 190_000);
    Bun.connect({
      unix: GATEWAY_CONTROL_SOCKET,
      socket: {
        open(socket) {
          socket.write(`${JSON.stringify({ type: "handoff", releaseRoot, sha })}\n`);
        },
        data(socket, chunk) {
          body += Buffer.from(chunk).toString("utf8");
          const newline = body.indexOf("\n");
          if (newline === -1) return;
          clearTimeout(timer);
          socket.end();
          try {
            resolveResponse(JSON.parse(body.slice(0, newline)) as ControlResponse);
          } catch (error) {
            reject(error);
          }
        },
        close() {
          if (!body.includes("\n")) {
            clearTimeout(timer);
            reject(new Error("gateway supervisor closed without a response"));
          }
        },
        connectError(_socket, error) {
          clearTimeout(timer);
          reject(error);
        },
        error(_socket, error) {
          clearTimeout(timer);
          reject(error);
        },
      },
    }).catch(reject);
  });
}

async function runSupervisor(): Promise<void> {
  const releaseRoot = currentReleaseRoot();
  const active = spawnGateway(releaseRoot, "active");
  let stopping = false;
  const supervisor = new GatewaySupervisor(active, {
    spawn: spawnGateway,
    waitReady: waitForGatewayReady,
    validateRelease: validateGatewayRelease,
    promoteCurrent: promoteGatewayCurrent,
    onUnexpectedExit(gateway, code) {
      if (stopping) return;
      console.error(`[gateway-supervisor] active gateway ${gateway.pid} exited unexpectedly (${code})`);
      process.exit(1);
    },
  });
  const listener = serveControl(supervisor);
  console.log(`[gateway-supervisor] managing gateway ${active.pid} from ${releaseRoot}`);

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    listener.stop();
    await supervisor.shutdown();
    process.exit(0);
  };
  process.on("SIGTERM", () => void stop());
  process.on("SIGINT", () => void stop());

  await new Promise<void>(() => {});
}

if (import.meta.main) {
  if (process.argv[2] === "handoff") {
    const releaseRoot = resolve(process.argv[3] || "");
    const sha = process.argv[4] || "";
    const response = await requestHandoff(releaseRoot, sha);
    console.log(JSON.stringify(response));
    process.exit(response.ok ? 0 : 1);
  }
  await runSupervisor();
}
