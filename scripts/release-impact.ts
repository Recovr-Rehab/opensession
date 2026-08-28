#!/usr/bin/env bun

import { isFrontendOnlyRelease, requiresRootDeploy } from "../packages/core/opensession-server/src/server/self-deploy";

export type ReleaseImpact = "frontend-only" | "gateway-handoff" | "coordinated" | "root";

const ENTRIES = {
  gateway: "packages/core/opensession-server/opensession.ts",
  kernel: "packages/core/opensession-server/src/session-kernel-service.ts",
  executor: "packages/core/opensession-server/src/executor/main.ts",
} as const;

export async function changedPaths(
  checkout: string,
  fromSha: string,
  toSha: string,
): Promise<string[]> {
  const process = Bun.spawn([
    "git", "-C", checkout, "diff", "--no-renames", "--name-only", "-z",
    fromSha, toSha, "--",
  ], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).arrayBuffer(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (code !== 0) throw new Error(`git diff failed: ${stderr.trim()}`);
  return new TextDecoder().decode(stdout).split("\0").filter(Boolean);
}

async function importClosure(root: string, entry: string): Promise<Set<string>> {
  const result = await Bun.build({
    root,
    entrypoints: [entry],
    target: "bun",
    packages: "external",
    metafile: true,
  });
  if (!result.success || !result.metafile) {
    throw new Error(
      `dependency graph failed for ${entry}: ${result.logs.map((log) => log.message).join("; ")}`,
    );
  }
  return new Set(Object.keys(result.metafile.inputs));
}

async function combinedClosure(
  fromRoot: string,
  toRoot: string,
  entry: string,
): Promise<Set<string>> {
  const [before, after] = await Promise.all([
    importClosure(fromRoot, entry),
    importClosure(toRoot, entry),
  ]);
  return new Set([...before, ...after]);
}

export function classifyRuntimeImpact(
  runtimePaths: string[],
  closures: { gateway: Set<string>; kernel: Set<string>; executor: Set<string> },
): "gateway-handoff" | "coordinated" {
  if (runtimePaths.some((path) =>
    path === "package.json" || path === "bun.lock" || path.startsWith("packages/core/protocol/"))) {
    return "coordinated";
  }
  if (runtimePaths.some((path) => closures.kernel.has(path) || closures.executor.has(path))) {
    return "coordinated";
  }
  return runtimePaths.every((path) => closures.gateway.has(path))
    ? "gateway-handoff"
    : "coordinated";
}

export async function classifyReleaseImpact(options: {
  fromRoot: string;
  toRoot: string;
  checkout: string;
  fromSha: string;
  toSha: string;
}): Promise<{ impact: ReleaseImpact; paths: string[]; closures: Record<string, number> }> {
  const paths = await changedPaths(options.checkout, options.fromSha, options.toSha);
  if (requiresRootDeploy(paths)) return { impact: "root", paths, closures: {} };
  if (isFrontendOnlyRelease(paths)) return { impact: "frontend-only", paths, closures: {} };

  const runtimePaths = paths.filter((path) =>
    path !== "AGENTS.md" &&
    !path.startsWith("docs/") &&
    !path.endsWith(".test.ts") &&
    !path.endsWith(".spec.ts") &&
    !path.startsWith("packages/core/opensession-server/src/frontend/"));
  if (runtimePaths.length === 0) return { impact: "frontend-only", paths, closures: {} };

  const [gateway, kernel, executor] = await Promise.all([
    combinedClosure(options.fromRoot, options.toRoot, ENTRIES.gateway),
    combinedClosure(options.fromRoot, options.toRoot, ENTRIES.kernel),
    combinedClosure(options.fromRoot, options.toRoot, ENTRIES.executor),
  ]);
  const closureSizes = { gateway: gateway.size, kernel: kernel.size, executor: executor.size };
  return {
    impact: classifyRuntimeImpact(runtimePaths, { gateway, kernel, executor }),
    paths,
    closures: closureSizes,
  };
}

if (import.meta.main) {
  const [fromRoot, toRoot, checkout, fromSha, toSha] = process.argv.slice(2);
  if (
    !fromRoot || !toRoot || !checkout ||
    !/^[0-9a-f]{40,64}$/.test(fromSha || "") ||
    !/^[0-9a-f]{40,64}$/.test(toSha || "")
  ) {
    console.error("usage: release-impact.ts <from-release> <to-release> <checkout> <from-sha> <to-sha>");
    process.exit(2);
  }
  const result = await classifyReleaseImpact({ fromRoot, toRoot, checkout, fromSha, toSha });
  const manifest = process.env.OPENSESSION_RELEASE_IMPACT_MANIFEST;
  if (manifest) await Bun.write(manifest, `${JSON.stringify({ ...result, generatedAt: new Date().toISOString() }, null, 2)}\n`);
  console.log(result.impact);
}
