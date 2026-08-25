import { spawn, type ChildProcess } from "node:child_process";
import { O_CREAT, O_NOFOLLOW, O_RDWR, O_TRUNC, O_WRONLY } from "node:constants";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type {
  ExecutorOperation,
  ExecutorOperationOutcome,
  ExecutorStreamEvent,
} from "@tellahq/opensession-protocol/executor";
import {
  ExecutorFailure,
  type Executor,
  type ExecutorContext,
  type ExecutorSuccess,
} from "./contract";

export interface LocalExecutorOptions {
  rootId: string;
  rootPath: string;
  environment?: Readonly<Record<string, string>>;
}

interface LocalProcess {
  child: ChildProcess;
  streamId: string;
  sequence: number;
  pending: ExecutorStreamEvent[];
  exitCode?: number;
  signal?: string;
  exited: boolean;
}

/** Structured local filesystem/process backend confined to one real root. */
export class LocalExecutor implements Executor {
  readonly #rootId: string;
  readonly #root: string;
  readonly #environment: Readonly<Record<string, string>>;
  readonly #processes = new Map<string, LocalProcess>();

  private constructor(options: LocalExecutorOptions, realRoot: string) {
    this.#rootId = options.rootId;
    this.#root = realRoot;
    this.#environment = Object.freeze({
      PATH: "/usr/local/bin:/usr/bin:/bin",
      HOME: realRoot,
      LANG: "C.UTF-8",
      ...options.environment,
    });
  }

  static async create(options: LocalExecutorOptions): Promise<LocalExecutor> {
    if (!options.rootId) throw new Error("rootId is required");
    const root = await realpath(options.rootPath);
    const rootStat = await stat(root);
    if (!rootStat.isDirectory())
      throw new Error("local executor root must be a directory");
    return new LocalExecutor(options, root);
  }

  async execute(
    context: ExecutorContext,
    operation: ExecutorOperation,
  ): Promise<ExecutorSuccess> {
    if (context.rootId !== this.#rootId)
      throw new ExecutorFailure(
        "invalid_grant",
        "executor root binding does not match",
      );
    try {
      switch (operation.kind) {
        case "fs.read":
          return await this.#read(operation);
        case "fs.list":
          return await this.#list(operation.path, operation.recursive ?? false);
        case "fs.stat":
          return await this.#stat(operation.path);
        case "fs.write":
          return await this.#write(operation);
        case "fs.mkdir":
          return await this.#mkdir(
            operation.path,
            operation.recursive ?? false,
          );
        case "fs.remove":
          return await this.#remove(
            operation.path,
            operation.recursive ?? false,
          );
        case "fs.move":
          return await this.#move(
            operation.from,
            operation.to,
            operation.replace ?? false,
          );
        case "process.spawn":
          return await this.#spawn(operation);
        case "process.status":
          return this.#processStatus(operation.processId);
        case "process.signal":
          return this.#signal(operation.processId, operation.signal);
        case "terminal.open":
        case "terminal.write":
        case "terminal.resize":
        case "terminal.close":
        case "service.start":
        case "service.status":
        case "service.stop":
        case "portal.open":
        case "portal.status":
        case "portal.close":
          throw new ExecutorFailure(
            "unsupported",
            `${operation.kind} is not supported by the local executor`,
          );
      }
    } catch (cause) {
      throw normalizeLocalError(cause);
    }
  }

  /** Explicit test/shutdown cleanup; no process or timer is created at import time. */
  async close(): Promise<void> {
    const waits: Promise<unknown>[] = [];
    for (const process of this.#processes.values()) {
      if (!process.exited && process.child.pid) {
        try {
          globalThis.process.kill(-process.child.pid, "SIGKILL");
        } catch {}
        waits.push(
          new Promise((resolveWait) =>
            process.child.once("close", resolveWait),
          ),
        );
      }
    }
    await Promise.allSettled(waits);
    this.#processes.clear();
  }

  async #read(
    operation: Extract<ExecutorOperation, { kind: "fs.read" }>,
  ): Promise<ExecutorSuccess> {
    const path = await this.#existingPath(operation.path, true);
    if (
      operation.offset !== undefined &&
      (!Number.isSafeInteger(operation.offset) || operation.offset < 0)
    ) {
      throw new ExecutorFailure(
        "invalid_request",
        "read offset must be a non-negative safe integer",
      );
    }
    if (
      operation.length !== undefined &&
      (!Number.isSafeInteger(operation.length) || operation.length < 0)
    ) {
      throw new ExecutorFailure(
        "invalid_request",
        "read length must be a non-negative safe integer",
      );
    }
    const contents = await readFile(path);
    const offset = operation.offset ?? 0;
    const selected = contents.subarray(
      offset,
      operation.length === undefined ? undefined : offset + operation.length,
    );
    const streamId = crypto.randomUUID();
    try {
      const data = new TextDecoder("utf-8", { fatal: true }).decode(selected);
      return {
        outcome: {
          kind: "fs.read",
          streamId,
          size: selected.byteLength,
          binary: false,
        },
        events: [
          {
            kind: "text",
            streamId,
            sequence: 0,
            channel: "file",
            data,
            eof: true,
          },
        ],
      };
    } catch {
      return {
        outcome: {
          kind: "fs.read",
          streamId,
          size: selected.byteLength,
          binary: true,
        },
        events: [
          {
            kind: "binary",
            streamId,
            sequence: 0,
            offset: 0,
            data: selected.toString("base64"),
            metadata: { encoding: "base64", byteLength: selected.byteLength },
            eof: true,
          },
        ],
      };
    }
  }

  async #list(input: string, recursive: boolean): Promise<ExecutorSuccess> {
    const start = await this.#existingPath(input, true);
    const startStat = await stat(start);
    if (!startStat.isDirectory())
      throw new ExecutorFailure(
        "invalid_request",
        "list path is not a directory",
      );
    const entries: Extract<
      ExecutorOperationOutcome,
      { kind: "fs.list" }
    >["entries"] = [];
    const visit = async (directory: string): Promise<void> => {
      const children = await readdir(directory, { withFileTypes: true });
      children.sort((a, b) => a.name.localeCompare(b.name));
      for (const child of children) {
        const absolute = resolve(directory, child.name);
        const childStat = await lstat(absolute);
        const type = childStat.isSymbolicLink()
          ? "symlink"
          : childStat.isDirectory()
            ? "directory"
            : "file";
        entries.push({
          path: this.#relativePath(absolute),
          type,
          ...(type === "file" ? { size: childStat.size } : {}),
        });
        if (recursive && type === "directory") await visit(absolute);
      }
    };
    await visit(start);
    return { outcome: { kind: "fs.list", entries } };
  }

  async #stat(input: string): Promise<ExecutorSuccess> {
    const lexical = this.#lexicalPath(input);
    await this.#assertParentConfined(lexical);
    const entryStat = await lstat(lexical);
    const type = entryStat.isSymbolicLink()
      ? "symlink"
      : entryStat.isDirectory()
        ? "directory"
        : "file";
    return {
      outcome: {
        kind: "fs.stat",
        entry: {
          path: this.#relativePath(lexical),
          type,
          size: entryStat.size,
          modifiedAt: entryStat.mtime.toISOString(),
        },
      },
    };
  }

  async #write(
    operation: Extract<ExecutorOperation, { kind: "fs.write" }>,
  ): Promise<ExecutorSuccess> {
    const target = await this.#writablePath(operation.path);
    const data =
      operation.encoding === "base64"
        ? Buffer.from(operation.data, "base64")
        : Buffer.from(operation.data, "utf8");
    const flags =
      operation.create === false
        ? O_RDWR | O_NOFOLLOW
        : O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW;
    const handle = await open(target, flags, 0o666);
    try {
      if (operation.create === false) await handle.truncate(0);
      await handle.writeFile(data);
    } finally {
      await handle.close();
    }
    await this.#existingPath(operation.path, true);
    return {
      outcome: { kind: "fs.changed", path: this.#relativePath(target) },
    };
  }

  async #mkdir(input: string, recursive: boolean): Promise<ExecutorSuccess> {
    const target = await this.#writablePath(input);
    await mkdir(target, { recursive });
    await this.#existingPath(input, true);
    return {
      outcome: { kind: "fs.changed", path: this.#relativePath(target) },
    };
  }

  async #remove(input: string, recursive: boolean): Promise<ExecutorSuccess> {
    const target = this.#lexicalPath(input);
    if (target === this.#root)
      throw new ExecutorFailure(
        "invalid_request",
        "executor root cannot be removed",
      );
    await this.#assertParentConfined(target);
    const targetStat = await lstat(target);
    if (!targetStat.isSymbolicLink())
      await this.#assertRealConfined(await realpath(target));
    await rm(target, { recursive, force: false });
    return {
      outcome: { kind: "fs.changed", path: this.#relativePath(target) },
    };
  }

  async #move(
    fromInput: string,
    toInput: string,
    replace: boolean,
  ): Promise<ExecutorSuccess> {
    const from = await this.#existingPath(fromInput, false);
    if (from === this.#root)
      throw new ExecutorFailure(
        "invalid_request",
        "executor root cannot be moved",
      );
    const to = await this.#writablePath(toInput);
    if (!replace) {
      try {
        await lstat(to);
        throw new ExecutorFailure(
          "conflict",
          "move destination already exists",
        );
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException)?.code !== "ENOENT") throw cause;
      }
    }
    await rename(from, to);
    await this.#assertParentConfined(to);
    return { outcome: { kind: "fs.changed", path: this.#relativePath(to) } };
  }

  async #spawn(
    operation: Extract<ExecutorOperation, { kind: "process.spawn" }>,
  ): Promise<ExecutorSuccess> {
    if (
      !operation.executable ||
      operation.executable.includes("\0") ||
      operation.args.some(
        (arg) => typeof arg !== "string" || arg.includes("\0"),
      )
    ) {
      throw new ExecutorFailure(
        "invalid_request",
        "process executable and arguments must be native strings",
      );
    }
    const cwd = await this.#existingPath(operation.cwd ?? ".", true);
    if (!(await stat(cwd)).isDirectory())
      throw new ExecutorFailure(
        "invalid_request",
        "process cwd is not a directory",
      );
    const child = spawn(operation.executable, operation.args, {
      cwd,
      env: { ...this.#environment } as NodeJS.ProcessEnv,
      detached: true,
      shell: false,
      stdio: [
        operation.stdin === "pipe" ? "pipe" : "ignore",
        "pipe",
        "pipe",
      ] as any,
    }) as ChildProcess;
    const processId = crypto.randomUUID();
    const streamId = crypto.randomUUID();
    const tracked: LocalProcess = {
      child,
      streamId,
      sequence: 0,
      pending: [],
      exited: false,
    };
    this.#processes.set(processId, tracked);
    const collect = (channel: "stdout" | "stderr", chunk: Buffer) => {
      tracked.pending.push({
        kind: "text",
        streamId,
        sequence: tracked.sequence++,
        channel,
        data: chunk.toString("utf8"),
      });
    };
    child.stdout?.on("data", (chunk) => collect("stdout", Buffer.from(chunk)));
    child.stderr?.on("data", (chunk) => collect("stderr", Buffer.from(chunk)));
    child.once("error", (error) => {
      tracked.pending.push({
        kind: "text",
        streamId,
        sequence: tracked.sequence++,
        channel: "stderr",
        data: error.message,
      });
    });
    child.once("close", (code, signal) => {
      tracked.exited = true;
      if (code !== null) tracked.exitCode = code;
      if (signal) tracked.signal = signal;
      tracked.pending.push({
        kind: "exit",
        streamId,
        sequence: tracked.sequence++,
        exitCode: code,
        ...(signal ? { signal } : {}),
      });
    });
    return {
      outcome: { kind: "process", processId, state: "running", streamId },
    };
  }

  #processStatus(processId: string): ExecutorSuccess {
    const tracked = this.#processes.get(processId);
    if (!tracked)
      throw new ExecutorFailure("not_found", "process was not found");
    const events = tracked.pending.splice(0);
    return {
      outcome: {
        kind: "process",
        processId,
        state: tracked.exited ? "exited" : "running",
        ...(tracked.exitCode !== undefined
          ? { exitCode: tracked.exitCode }
          : {}),
        streamId: tracked.streamId,
      },
      ...(events.length ? { events } : {}),
    };
  }

  #signal(
    processId: string,
    signal: "interrupt" | "terminate" | "kill",
  ): ExecutorSuccess {
    const tracked = this.#processes.get(processId);
    if (!tracked)
      throw new ExecutorFailure("not_found", "process was not found");
    if (!tracked.exited && tracked.child.pid) {
      const nativeSignal =
        signal === "interrupt"
          ? "SIGINT"
          : signal === "terminate"
            ? "SIGTERM"
            : "SIGKILL";
      try {
        globalThis.process.kill(-tracked.child.pid, nativeSignal);
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException)?.code !== "ESRCH") throw cause;
      }
    }
    return this.#processStatus(processId);
  }

  #lexicalPath(input: string): string {
    if (
      typeof input !== "string" ||
      input.includes("\0") ||
      isAbsolute(input) ||
      /^[A-Za-z]:[\\/]/.test(input)
    ) {
      throw new ExecutorFailure(
        "invalid_request",
        "executor paths must be relative",
      );
    }
    const segments = input.split(/[\\/]+/);
    if (segments.includes(".."))
      throw new ExecutorFailure(
        "invalid_request",
        "path traversal is not allowed",
      );
    const target = resolve(this.#root, input || ".");
    this.#assertLexicallyConfined(target);
    return target;
  }

  async #existingPath(
    input: string,
    followFinalSymlink: boolean,
  ): Promise<string> {
    const lexical = this.#lexicalPath(input);
    await this.#assertParentConfined(lexical);
    const targetStat = await lstat(lexical);
    if (targetStat.isSymbolicLink() && !followFinalSymlink) return lexical;
    await this.#assertRealConfined(await realpath(lexical));
    return lexical;
  }

  async #writablePath(input: string): Promise<string> {
    const lexical = this.#lexicalPath(input);
    if (lexical === this.#root) return lexical;
    await this.#assertParentConfined(lexical);
    try {
      const targetStat = await lstat(lexical);
      if (targetStat.isSymbolicLink()) {
        try {
          await this.#assertRealConfined(await realpath(lexical));
        } catch (cause) {
          if ((cause as NodeJS.ErrnoException)?.code === "ENOENT") {
            throw new ExecutorFailure(
              "invalid_request",
              "dangling symlink write targets are not allowed",
            );
          }
          throw cause;
        }
      } else {
        await this.#assertRealConfined(await realpath(lexical));
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException)?.code !== "ENOENT") throw cause;
    }
    return lexical;
  }

  async #assertParentConfined(target: string): Promise<void> {
    let current = target === this.#root ? target : resolve(target, "..");
    for (;;) {
      try {
        await this.#assertRealConfined(await realpath(current));
        return;
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException)?.code !== "ENOENT") throw cause;
        const parent = resolve(current, "..");
        if (parent === current)
          throw new ExecutorFailure(
            "invalid_request",
            "path has no confined ancestor",
          );
        current = parent;
      }
    }
  }

  #assertLexicallyConfined(target: string): void {
    const rel = relative(this.#root, target);
    if (rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new ExecutorFailure(
        "invalid_request",
        "path escapes the executor root",
      );
    }
  }

  async #assertRealConfined(target: string): Promise<void> {
    this.#assertLexicallyConfined(target);
  }

  #relativePath(target: string): string {
    return relative(this.#root, target).split(sep).join("/") || ".";
  }
}

function normalizeLocalError(cause: unknown): ExecutorFailure {
  if (cause instanceof ExecutorFailure) return cause;
  const code = (cause as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT" || code === "ESRCH")
    return new ExecutorFailure("not_found", "executor target was not found");
  if (code === "EEXIST" || code === "ENOTEMPTY")
    return new ExecutorFailure(
      "conflict",
      "executor target conflicts with existing state",
    );
  return new ExecutorFailure(
    "operation_failed",
    cause instanceof Error ? cause.message : String(cause),
  );
}
