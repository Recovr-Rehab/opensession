import { chmod, lstat, rename, unlink } from "node:fs/promises";
import { dirname, isAbsolute, parse, resolve, sep } from "node:path";
import { connect, createServer, type Server, type Socket } from "node:net";
import type { LinuxPeerCredentialVerifier, PeerCredentialPolicy, VerifiedPeer } from "./linux-peer-credentials";

export interface UnixPathPolicy {
  readonly uid: number;
  readonly gid?: number;
  /** Exact permission bits, for example 0o700 or 0o600. */
  readonly mode: number;
}

export interface VerifiedAcceptedSocket {
  readonly socket: Socket;
  /** Throws after this exact physical socket closes or loses its binding. */
  readonly peer: VerifiedPeer;
  /** Unique per physical accepted Socket object. Audit/fencing metadata only. */
  readonly socketIdentity: symbol;
  assertCurrent(): VerifiedPeer;
}

function validPathPolicy(policy: UnixPathPolicy): void {
  if (!policy || !Number.isSafeInteger(policy.uid) || policy.uid < 0 || policy.uid > 0xffff_ffff ||
      (policy.gid !== undefined && (!Number.isSafeInteger(policy.gid) || policy.gid < 0 || policy.gid > 0xffff_ffff)) ||
      !Number.isSafeInteger(policy.mode) || policy.mode < 0 || policy.mode > 0o7777)
    throw new Error("Malformed Unix socket path policy");
}

function assertMetadata(stat: Awaited<ReturnType<typeof lstat>>, policy: UnixPathPolicy, kind: "directory" | "socket") {
  if (kind === "directory" ? !stat.isDirectory() : !stat.isSocket())
    throw new Error(`Unix ${kind} path has wrong file type`);
  if (stat.isSymbolicLink()) throw new Error(`Unix ${kind} path must not be a symlink`);
  if (stat.uid !== policy.uid || (policy.gid !== undefined && stat.gid !== policy.gid))
    throw new Error(`Unix ${kind} path owner rejected`);
  if ((Number(stat.mode) & 0o7777) !== policy.mode) throw new Error(`Unix ${kind} path mode rejected`);
}

async function assertProtectedPathComponents(path: string, policy: UnixPathPolicy): Promise<void> {
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error("Unix socket path must be absolute and normalized");
  const root = parse(path).root;
  const pieces = path.slice(root.length).split(sep).filter(Boolean);
  let current = root;
  for (const piece of pieces) {
    current = resolve(current, piece);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`Unix path contains symlink component: ${current}`);
    if (stat.uid !== 0 && stat.uid !== policy.uid)
      throw new Error(`Unix path component has an untrusted owner: ${current}`);
    if ((Number(stat.mode) & 0o022) !== 0)
      throw new Error(`Unix path component is writable by an untrusted principal: ${current}`);
  }
}

export async function validateUnixSocketParent(path: string, policy: UnixPathPolicy): Promise<void> {
  validPathPolicy(policy);
  await assertProtectedPathComponents(path, policy);
  assertMetadata(await lstat(path), policy, "directory");
}

export async function validateUnixSocketPath(path: string, policy: UnixPathPolicy): Promise<void> {
  validPathPolicy(policy);
  await assertProtectedPathComponents(path, policy);
  assertMetadata(await lstat(path), policy, "socket");
}

/**
 * Removes only the exact stale socket inode inspected by this call. It first
 * proves the parent and every ancestor are protected, then uses an atomic
 * rename so a later path replacement is never unlinked.
 */
export function isProvenStaleSocketConnectError(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "ECONNREFUSED";
}

export async function removeProvenStaleUnixSocket(
  path: string,
  policy: UnixPathPolicy,
  parentPolicy: UnixPathPolicy,
): Promise<void> {
  validPathPolicy(policy);
  await validateUnixSocketParent(dirname(path), parentPolicy);
  const original = await lstat(path);
  assertMetadata(original, policy, "socket");
  await new Promise<void>((resolveStale, rejectUnproven) => {
    const probe = connect(path);
    const timer = setTimeout(() => {
      probe.destroy();
      rejectUnproven(new Error("Unix socket stale probe timed out"));
    }, 250);
    timer.unref?.();
    probe.once("connect", () => {
      clearTimeout(timer);
      probe.destroy();
      rejectUnproven(new Error("Refusing to remove an active Unix socket"));
    });
    probe.once("error", (error) => {
      clearTimeout(timer);
      if (isProvenStaleSocketConnectError(error)) resolveStale();
      else rejectUnproven(new Error("Unix socket staleness was not proven", { cause: error }));
    });
  });
  const afterProbe = await lstat(path);
  if (afterProbe.dev !== original.dev || afterProbe.ino !== original.ino)
    throw new Error("Unix socket identity changed during stale probe");
  const quarantine = `${path}.stale-${process.pid}-${crypto.randomUUID()}`;
  await rename(path, quarantine);
  const moved = await lstat(quarantine);
  if (moved.dev !== original.dev || moved.ino !== original.ino || !moved.isSocket() || moved.uid !== original.uid) {
    throw new Error(`Stale Unix socket identity changed during atomic removal; retained at ${quarantine}`);
  }
  await unlink(quarantine);
}

/**
 * Installs a fail-closed accepted-socket gate. The socket is paused and verified
 * before user code can attach protocol readers or allocate session state.
 */
export interface VerifiedUnixSocketGate {
  close(): void;
  closeAndDrain(): Promise<void>;
}

function installVerifiedUnixSocketGate(
  server: Server,
  verifier: LinuxPeerCredentialVerifier,
  policy: PeerCredentialPolicy,
  accept: (accepted: VerifiedAcceptedSocket) => void | Promise<void>,
): VerifiedUnixSocketGate {
  if (server.listenerCount("connection") !== 0)
    throw new Error("Verified Unix socket gate must be the first connection listener");
  const identities = new WeakMap<Socket, symbol>();
  const sockets = new Set<Socket>();
  const closeWaiters = new Set<Promise<void>>();
  const jobs = new Set<Promise<void>>();
  let closed = false;
  const onConnection = (socket: Socket) => {
    socket.pause();
    // Untrusted peers can race a reset with rejection. Consume ordinary socket
    // errors so an unauthorized connection cannot raise an uncaught exception.
    socket.on("error", () => {});
    if (closed) { socket.destroy(); return; }
    sockets.add(socket);
    const closeWaiter = new Promise<void>((resolve) => socket.once("close", () => {
      sockets.delete(socket);
      identities.delete(socket);
      resolve();
    }));
    closeWaiters.add(closeWaiter);
    void closeWaiter.finally(() => closeWaiters.delete(closeWaiter));
    const identity = Symbol("accepted-unix-socket");
    identities.set(socket, identity);
    let peer: VerifiedPeer;
    try {
      peer = verifier.verify(socket, policy);
      if (socket.destroyed || identities.get(socket) !== identity)
        throw new Error("Accepted socket changed before admission");
    } catch {
      socket.destroy();
      return;
    }
    const assertCurrent = () => {
      if (socket.destroyed || identities.get(socket) !== identity)
        throw new Error("Verified socket binding is no longer current");
      return peer;
    };
    const accepted = Object.freeze({
      socket,
      get peer() { return assertCurrent(); },
      socketIdentity: identity,
      assertCurrent,
    });
    let result: void | Promise<void>;
    try { result = accept(accepted); }
    catch { socket.destroy(); return; }
    const job = Promise.resolve(result).catch(() => { socket.destroy(); });
    jobs.add(job);
    void job.finally(() => jobs.delete(job));
  };
  server.prependListener("connection", onConnection);
  const close = () => {
    if (closed) return;
    closed = true;
    server.off("connection", onConnection);
    for (const socket of sockets) socket.destroy();
  };
  return Object.freeze({
    close,
    async closeAndDrain() {
      close();
      await Promise.allSettled([...jobs, ...closeWaiters]);
    },
  });
}

export interface VerifiedUnixSocketListenOptions {
  readonly path: string;
  readonly parentPolicy: UnixPathPolicy;
  readonly socketPolicy: UnixPathPolicy;
}

export interface VerifiedUnixSocketServer {
  listen(options: VerifiedUnixSocketListenOptions): Promise<void>;
  closeAndDrain(timeoutMs?: number): Promise<void>;
}

/** Owns the raw server so unverified sockets cannot reach another listener. */
export function createVerifiedUnixSocketServer(
  verifier: LinuxPeerCredentialVerifier,
  policy: PeerCredentialPolicy,
  accept: (accepted: VerifiedAcceptedSocket) => void | Promise<void>,
  onServerError: (error: Error) => void = () => {},
): VerifiedUnixSocketServer {
  const server = createServer();
  const gate = installVerifiedUnixSocketGate(server, verifier, policy, accept);
  let listening = false;
  let terminalError: Error | undefined;
  server.on("error", (error) => {
    terminalError ??= error;
    gate.close();
    if (listening) server.close();
    listening = false;
    try { onServerError(error); } catch {}
  });
  return Object.freeze({
    async listen(options: VerifiedUnixSocketListenOptions) {
      if (listening) throw new Error("Verified Unix socket server is already listening");
      if (terminalError) throw new Error("Verified Unix socket server has failed", { cause: terminalError });
      await validateUnixSocketParent(dirname(options.path), options.parentPolicy);
      await new Promise<void>((resolveListen, rejectListen) => {
        const onError = (error: Error) => rejectListen(error);
        server.once("error", onError);
        server.listen(options.path, async () => {
          server.off("error", onError);
          try {
            await chmod(options.path, options.socketPolicy.mode);
            await validateUnixSocketPath(options.path, options.socketPolicy);
            listening = true;
            resolveListen();
          } catch (error) {
            terminalError = error instanceof Error ? error : new Error("Unix socket path validation failed");
            gate.close();
            server.close();
            rejectListen(error);
          }
        });
      });
    },
    async closeAndDrain(timeoutMs = 5_000) {
      if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000)
        throw new Error("Invalid verified socket drain timeout");
      const stopped = listening
        ? new Promise<void>((resolveClose) => server.close(() => resolveClose()))
        : Promise.resolve();
      listening = false;
      const drain = gate.closeAndDrain();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          drain,
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("Verified Unix socket drain timed out")), timeoutMs);
            timer.unref?.();
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
        await stopped;
      }
    },
  });
}

export interface PeerCredentialDoctorReport {
  readonly ok: boolean;
  readonly platform: string;
  readonly runtime: string;
  readonly expectedUid: number;
  readonly reason?: string;
}

/** No work occurs until called; the report intentionally omits pid/gid/uid evidence. */
export async function doctorLinuxPeerCredentials(
  socket: Socket,
  expectedUid: number,
  createVerifier: () => Promise<LinuxPeerCredentialVerifier>,
): Promise<PeerCredentialDoctorReport> {
  const runtime = typeof Bun === "undefined" ? "unsupported" : `bun-${Bun.version}`;
  const base = { platform: process.platform, runtime, expectedUid };
  let verifier: LinuxPeerCredentialVerifier | undefined;
  try {
    verifier = await createVerifier();
    verifier.verify(socket, { uid: expectedUid });
    return Object.freeze({ ok: true, ...base });
  } catch (error) {
    return Object.freeze({ ok: false, ...base, reason: error instanceof Error ? error.message : "verification failed" });
  } finally {
    verifier?.close();
  }
}
