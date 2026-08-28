#!/usr/bin/env bun

import { isGatewayHandoffRelease } from "../packages/core/opensession-server/src/server/self-deploy";

export async function changedPaths(
  checkout: string,
  fromSha: string,
  toSha: string,
): Promise<string[]> {
  const process = Bun.spawn([
    "git",
    "-C",
    checkout,
    "diff",
    "--no-renames",
    "--name-only",
    "-z",
    fromSha,
    toSha,
    "--",
  ], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(process.stdout).arrayBuffer(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (code !== 0) throw new Error(`git diff failed: ${stderr.trim()}`);
  return new TextDecoder().decode(stdout).split("\0").filter(Boolean);
}

if (import.meta.main) {
  const [checkout, fromSha, toSha] = process.argv.slice(2);
  if (!checkout || !/^[0-9a-f]{40,64}$/.test(fromSha || "") || !/^[0-9a-f]{40,64}$/.test(toSha || "")) {
    console.error("usage: release-impact.ts <checkout> <from-sha> <to-sha>");
    process.exit(2);
  }
  const paths = await changedPaths(checkout, fromSha, toSha);
  console.log(isGatewayHandoffRelease(paths) ? "gateway-handoff" : "coordinated");
}
