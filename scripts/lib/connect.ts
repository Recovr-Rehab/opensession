/**
 * `opensession connect` — attach this machine to a server as a Runner.
 *
 * The motivating case is platform-locked work: an iOS build needs macOS with
 * Xcode, a Windows build needs MSVC, and neither can happen on the Linux box
 * running the server. Sandboxes do not help — they are ephemeral Linux
 * containers. A Runner is a persistent machine you own.
 *
 * Deliberately NOT the same thing as a tunnel product. Tools like T3 Connect
 * solve *ingress* (reach my box from my phone, through NAT, without a VPN).
 * This solves *execution* (run this build somewhere that can build it), and it
 * requires the tailnet rather than working around the lack of one — which means
 * no relay to operate and no bandwidth to pay for.
 *
 * The credential lives in ~/.opensession/runner.json (0600). Pairing codes are
 * one-time and expire in ten minutes, and the server records the address it saw
 * rather than one we claim.
 */

import { chmodSync, existsSync, mkdirSync } from "fs";
import { arch, hostname, platform } from "os";
import { dirname, join, resolve } from "path";
import { OPENSESSION_HOME } from "./paths";
import { bold, dim, fail, heading, info, ok, run, warn } from "./ui";
import { localAutomationToken } from "./local-auth";

const IDENTITY_PATH = join(OPENSESSION_HOME, "runner.json");
const HEARTBEAT_MS = 60_000;
const RUNNER_HOST_ENTRY = resolve(import.meta.dir, "../../src/runner-host/host.ts");

type Identity = { server: string; id: string; token: string; name: string };

async function readIdentity(): Promise<Identity | undefined> {
  if (!existsSync(IDENTITY_PATH)) return undefined;
  try {
    return JSON.parse(await Bun.file(IDENTITY_PATH).text());
  } catch {
    return undefined;
  }
}

/** What this machine can do that the server's own box may not. */
async function detectCapabilities(): Promise<string[]> {
  const found: string[] = [];
  const has = async (bin: string) => Boolean(Bun.which(bin));

  if (platform() === "darwin") {
    // xcodebuild exists as a stub without the full Xcode; -version fails then.
    if (await has("xcodebuild")) {
      const { code } = await run(["xcodebuild", "-version"]);
      if (code === 0) found.push("xcode");
    }
    if (await has("swift")) found.push("swift");
  }
  if (platform() === "win32" && (await has("msbuild"))) found.push("msbuild");

  for (const [bin, cap] of [
    ["docker", "docker"],
    ["cargo", "rust"],
    ["go", "go"],
    ["bun", "bun"],
  ] as const) {
    if (await has(bin)) found.push(cap);
  }
  return found;
}

function normalizeServer(url: string): string {
  let value = url.trim().replace(/\/+$/, "");
  if (!value) return "";
  if (!/^https?:\/\//.test(value)) value = `http://${value}`;
  return value;
}

export type ConnectOptions = { server?: string; code?: string; name?: string; label?: string };

export async function connect(opts: ConnectOptions): Promise<number> {
  heading("Connect this machine");

  const server = normalizeServer(opts.server ?? "");
  if (!server) {
    fail("--server is required", "e.g. --server http://100.64.12.34:3850");
    return 1;
  }
  if (!opts.code) {
    fail("--code is required", "get one from the server with `opensession runners pair`");
    return 1;
  }

  const name = opts.name?.trim() || hostname().replace(/\.local$/, "");
  const capabilities = await detectCapabilities();

  info(dim(`server        ${server}`));
  info(dim(`this machine  ${name} (${platform()}/${arch()})`));
  info(dim(`capabilities  ${capabilities.join(", ") || "none detected"}`));

  let response: Response;
  try {
    response = await fetch(`${server}/api/runners/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: opts.code,
        name,
        platform: platform(),
        arch: arch(),
        capabilities,
        label: opts.label,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    fail(`could not reach ${server}`, (err as Error).message);
    info(dim("  the server must be reachable from this machine — usually the tailnet"));
    return 1;
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}) as any);
    fail(`registration refused (${response.status})`, body?.error ?? "");
    if (response.status === 403) {
      info(dim("  either the pairing code is wrong/expired, or this machine is not"));
      info(dim("  on the tailnet — see docs/setup/networking.md"));
    }
    return 1;
  }

  const { runner, token } = (await response.json()) as { runner: { id: string }; token: string };

  mkdirSync(OPENSESSION_HOME, { recursive: true });
  await Bun.write(IDENTITY_PATH, JSON.stringify({ server, id: runner.id, token, name }, null, 2) + "\n");
  chmodSync(IDENTITY_PATH, 0o600);

  ok(`registered as ${name}`, runner.id);
  info(dim(`  credential written to ${IDENTITY_PATH} (0600)`));

  heading("Next");
  info(`${bold("opensession runner run")}    hold the outbound control channel open`);
  info(dim("  run it under a service manager to keep this Runner attached across reboots"));
  return 0;
}

/**
 * Long-running: holds the channel open and runs what the server asks.
 *
 * A WebSocket rather than polling, because the server needs to *push* work. The
 * Runner dials out, so nothing has to be reachable on this machine.
 *
 * Everything the server sends runs as this user with this user's privileges.
 * That is the point of attaching a Runner, and it is why registration is
 * tailnet-gated and the tool exposing it is interactive-only.
 */
export async function runnerRun(): Promise<number> {
  const identity = await readIdentity();
  if (!identity) {
    fail("this machine is not connected", "run `opensession connect` first");
    return 1;
  }

  const wsUrl =
    identity.server.replace(/^http/, "ws") + `/runner-ws?id=${encodeURIComponent(identity.id)}`;
  let attempt = 0;
  let stopping = false;

  const connectOnce = () =>
    new Promise<void>((resolve) => {
      const socket = new WebSocket(wsUrl, {
        headers: { authorization: `Bearer ${identity.token}` },
      } as any);
      const running = new Map<string, ReturnType<typeof Bun.spawn>>();
		const persistent = new Map<string, ReturnType<typeof Bun.spawn>>();

      socket.addEventListener("open", async () => {
        attempt = 0;
        ok("attached", identity.server);
        socket.send(JSON.stringify({ t: "hello", version: 1, capabilities: { platform: platform(), toolchains: await detectCapabilities(), tags: [] } }));
      });

      socket.addEventListener("message", async (event: any) => {
        let msg: any;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (msg?.t === "cancel") {
			const proc = running.get(String(msg.id)) || persistent.get(String(msg.id));
          if (proc) proc.kill();
          return;
        }
		if (msg?.t === "workspace_prepare" && msg.version === 1 && msg.operationToken) {
			await prepareWorkspace(socket, msg);
			return;
		}
		if (msg?.t === "run_host" && msg.version === 1 && msg.operationToken) {
			await startRunHost(socket, persistent, msg);
			return;
		}
        if (msg?.t !== "exec" || msg.version !== 1 || !msg.operationToken) return;

        const id = String(msg.id);
        info(dim(`exec ${id}: ${String(msg.command).slice(0, 80)}`));
        try {
          const proc = Bun.spawn(["bash", "-lc", String(msg.command)], {
            cwd: typeof msg.cwd === "string" && msg.cwd ? msg.cwd : undefined,
            stdout: "pipe",
            stderr: "pipe",
          });
          running.set(id, proc);

          // Stream both pipes as they arrive rather than buffering to the end,
          // so a long build reports progress instead of going silent.
          const pump = async (stream: ReadableStream, name: "stdout" | "stderr") => {
            const decoder = new TextDecoder();
            for await (const chunk of stream as any) {
              socket.send(
                JSON.stringify({ t: "out", id, operationToken: msg.operationToken, stream: name, data: decoder.decode(chunk) }),
              );
            }
          };
          await Promise.all([
            pump(proc.stdout as ReadableStream, "stdout"),
            pump(proc.stderr as ReadableStream, "stderr"),
          ]);
          const code = await proc.exited;
          running.delete(id);
          socket.send(JSON.stringify({ t: "exit", id, operationToken: msg.operationToken, code }));
        } catch (err) {
          running.delete(id);
          socket.send(
            JSON.stringify({ t: "out", id, operationToken: msg.operationToken, stream: "stderr", data: String((err as Error).message) }),
          );
          socket.send(JSON.stringify({ t: "exit", id, operationToken: msg.operationToken, code: -1 }));
        }
      });

      socket.addEventListener("close", (event: any) => {
        // 1008/4401 mean the server rejected us outright — retrying is pointless.
        if (event?.code === 1008 || event?.code === 4401) {
          fail("the server refused this Runner", "its credential may have been revoked");
          stopping = true;
        }
		for (const proc of running.values()) proc.kill();
        resolve();
      });

      socket.addEventListener("error", () => {
        // close always follows; let that path do the reconnect bookkeeping.
      });
    });

  info(dim(`attaching to ${identity.server} as ${identity.name} (${identity.id})`));

  while (!stopping) {
    await connectOnce();
    if (stopping) break;
    // Backoff, capped: a Runner may be someone's laptop and the server may be
    // restarting or the tailnet may be briefly down.
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(attempt++, 5));
    if (attempt === 1) warn("disconnected — retrying");
    await new Promise((r) => setTimeout(r, delay));
  }
  return 1;
}

async function prepareWorkspace(socket: WebSocket, msg: any): Promise<void> {
	const id = String(msg.id);
	const token = String(msg.operationToken);
	const workspacePath = typeof msg.workspacePath === "string" ? msg.workspacePath : "";
	const repositoryUrl = typeof msg.repositoryUrl === "string" ? msg.repositoryUrl : "";
	const branch = typeof msg.branch === "string" ? msg.branch : "";
	try {
		if (!workspacePath || !workspacePath.startsWith("/") || workspacePath.includes("\0")) throw new Error("Invalid managed workspace path");
		if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(repositoryUrl)) throw new Error("Runner only accepts an approved GitHub repository URL");
		if (!/^[A-Za-z0-9._/-]{1,240}$/.test(branch) || branch.includes("..")) throw new Error("Invalid branch");
		const env = { PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin", HOME: process.env.HOME || "/tmp", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" };
		if (existsSync(workspacePath)) {
			const origin = await runnerCommand(["git", "-C", workspacePath, "remote", "get-url", "origin"], env);
			if (origin.code !== 0 || origin.stdout.trim() !== repositoryUrl) throw new Error("Managed workspace does not match this session repository");
			const fetch = await runnerCommand(["git", "-C", workspacePath, "fetch", "--prune", "origin"], env);
			if (fetch.code !== 0) throw new Error(fetch.stderr.trim() || "Could not refresh managed workspace");
			const remoteBranch = await runnerCommand(["git", "-C", workspacePath, "show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`], env);
			const checkout = remoteBranch.code === 0
				? await runnerCommand(["git", "-C", workspacePath, "checkout", "-B", branch, `origin/${branch}`], env)
				: await runnerCommand(["git", "-C", workspacePath, "checkout", "-B", branch, "origin/HEAD"], env);
			if (checkout.code !== 0) throw new Error(checkout.stderr.trim() || "Could not check out managed branch");
		} else {
			mkdirSync(dirname(workspacePath), { recursive: true });
			const clone = await runnerCommand(["git", "clone", repositoryUrl, workspacePath], env);
			if (clone.code !== 0) throw new Error(clone.stderr.trim() || "Could not clone managed workspace");
			const remoteBranch = await runnerCommand(["git", "-C", workspacePath, "show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`], env);
			const checkout = remoteBranch.code === 0
				? await runnerCommand(["git", "-C", workspacePath, "checkout", "-B", branch, `origin/${branch}`], env)
				: await runnerCommand(["git", "-C", workspacePath, "checkout", "-B", branch, "origin/HEAD"], env);
			if (checkout.code !== 0) throw new Error(checkout.stderr.trim() || "Could not check out managed branch");
		}
		socket.send(JSON.stringify({ t: "workspace_ready", id, operationToken: token, cwd: workspacePath }));
	} catch (error) {
		socket.send(JSON.stringify({ t: "workspace_error", id, operationToken: token, error: error instanceof Error ? error.message : String(error) }));
	}
}

async function startRunHost(socket: WebSocket, persistent: Map<string, ReturnType<typeof Bun.spawn>>, msg: any): Promise<void> {
	const id = String(msg.id);
	const token = String(msg.operationToken);
	try {
		const spec = msg.spec;
		if (!spec || typeof spec !== "object" || typeof spec.hostId !== "string" || typeof spec.cwd !== "string" || !spec.wsToken) throw new Error("Invalid run-host request");
		if (!existsSync(RUNNER_HOST_ENTRY)) throw new Error("This Runner installation does not include the run-host entrypoint");
		const stateDir = join(spec.cwd, ".opensession-run-hosts", spec.hostId);
		mkdirSync(stateDir, { recursive: true });
		const specPath = join(stateDir, "spec.json");
		await Bun.write(specPath, JSON.stringify(spec));
		const base = String(msg.server || "").replace(/\/$/, "").replace(/^http/, "ws");
		if (!/^wss?:\/\//.test(base)) throw new Error("Invalid Open Session endpoint");
		const env = {
			PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin", HOME: process.env.HOME || "/tmp",
			OPENSESSION_RUN_WS_URL: `${base}/run-ws/${encodeURIComponent(spec.hostId)}`,
			OPENSESSION_RUN_WS_TOKEN: String(spec.wsToken),
			OPENSESSION_RPC_WS_URL: `${base}/rpc-ws`,
			OPENSESSION_RPC_WS_HOST: spec.hostId,
			OPENSESSION_RPC_WS_AUTH: String(spec.wsToken),
		};
		const bun = Bun.which("bun") || process.execPath;
		const proc = Bun.spawn(["setsid", bun, "run", RUNNER_HOST_ENTRY, specPath], { cwd: spec.cwd, env, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
		proc.unref();
		persistent.set(spec.hostId, proc);
		void proc.exited.finally(async () => {
			persistent.delete(spec.hostId);
			try { socket.send(JSON.stringify({ t: "host_exited", hostId: spec.hostId })); } catch {}
		});
		socket.send(JSON.stringify({ t: "host_started", id, operationToken: token, hostId: spec.hostId }));
	} catch (error) {
		socket.send(JSON.stringify({ t: "host_error", id, operationToken: token, error: error instanceof Error ? error.message : String(error) }));
	}
}

async function runnerCommand(cmd: string[], env: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(cmd, { env, stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, stdout: stdout.trim(), stderr: stderr.trim() };
}

export async function runnerStatus(): Promise<number> {
  const identity = await readIdentity();
  heading("This machine");
  if (!identity) {
    info(dim("not connected to any server"));
    info(dim("  opensession connect --server <url> --code <code>"));
    return 0;
  }
  ok(`connected to ${identity.server}`, `${identity.name} (${identity.id})`);
  info(dim(`  capabilities: ${(await detectCapabilities()).join(", ") || "none detected"}`));
  return 0;
}

// ── server side: managing attached Runners ───────────────────────────────────

/** The local server's own address, from the config this CLI can read. */
async function localApi(): Promise<string> {
  const { CONFIG_PATH } = await import("./paths");
  let host = "127.0.0.1";
  let port = 3850;
  if (existsSync(CONFIG_PATH)) {
    try {
      const config = JSON.parse(await Bun.file(CONFIG_PATH).text());
      // 0.0.0.0 is a bind address, not a destination.
      const configured = config?.server?.host;
      if (configured && configured !== "0.0.0.0") host = configured;
      if (config?.server?.port) port = Number(config.server.port);
    } catch {
      // fall through to defaults
    }
  }
  return `http://${host}:${port}/api/runners`;
}

/**
 * A local bearer token, when GitHub web sign-in is active.
 *
 * With sign-in on, every /api/* call needs a session — including this CLI, which
 * runs on the server box and has no browser. Non-browser callers authenticate
 * with a token from the web-sessions store, which is the documented mechanism.
 * Absent (sign-in off) we send nothing and the request is allowed as before.
 */
async function operatorToken(): Promise<string | undefined> {
  try {
    return localAutomationToken() || undefined;
  } catch {
    // The request below reports the ordinary signed-out error without leaking
    // or borrowing a teammate's credential.
  }
  return undefined;
}

async function apiCall(path: string, init?: RequestInit): Promise<any | undefined> {
  const base = await localApi();
  const token = await operatorToken();
  try {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}) as any);
      fail(`server returned ${response.status}`, body?.error ?? "");
      if (response.status === 401) {
        info(dim("  sign-in is active and no local session token was found —"));
        info(dim("  sign in via the UI once, or run this on the server box"));
      }
      return undefined;
    }
    return await response.json();
  } catch (err) {
    fail("could not reach the local server", (err as Error).message);
    info(dim("  is it running? `opensession status`"));
    return undefined;
  }
}

export async function runnersPair(): Promise<number> {
  const result = await apiCall("/pair", { method: "POST" });
  if (!result) return 1;

  heading("Pairing code");
  info(`  ${bold(result.code)}`);
  info(dim(`  valid for 10 minutes, single use`));
  heading("On the machine you want to attach");
  info(dim("  curl -fsSL https://raw.githubusercontent.com/tellahq/opensession/main/install.sh | bash"));
  info(`  opensession connect --server ${(await localApi()).replace("/api/runners", "")} --code ${result.code}`);
  return 0;
}

export async function runnersList(): Promise<number> {
  const result = await apiCall("");
  if (!result) return 1;

  const runners = result.runners ?? [];
  heading("Runners");
  if (!runners.length) {
    info(dim("none attached · `opensession runners pair` to add one"));
    return 0;
  }
  for (const runner of runners) {
    const seen = runner.lastSeenAt
      ? `last seen ${new Date(runner.lastSeenAt).toISOString().replace("T", " ").slice(0, 19)}Z`
      : "never connected";
    info(`${runner.name}  ${dim(`${runner.platform}/${runner.arch}`)}  ${runner.state}`);
    info(dim(`  ${runner.id}  ${runner.address}  ${seen}`));
    if (runner.capabilities?.toolchains?.length) info(dim(`  can: ${runner.capabilities.toolchains.join(", ")}`));
  }
  return 0;
}

export async function runnersRemove(id: string): Promise<number> {
  if (!id) {
    fail("usage: opensession runners remove <runner-id>");
    return 1;
  }
  const result = await apiCall(`/${id}`, { method: "DELETE" });
  if (!result) return 1;
  ok(`removed ${id}`, "its credential no longer authenticates");
  return 0;
}
