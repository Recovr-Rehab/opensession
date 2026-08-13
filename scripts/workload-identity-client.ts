#!/usr/bin/env bun
/** The sandbox-only client behind `opensession sandbox id-token`. */

export {};

function fail(message: string): never {
  console.error(`opensession sandbox id-token: ${message}`);
  process.exit(2);
}

const args = process.argv.slice(2);
if (args[0] !== "sandbox" || args[1] !== "id-token") {
  fail("usage: opensession sandbox id-token --audience <audience> [--ttl-seconds <60..3600>]");
}

function option(name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

const audience = option("--audience");
const rawTtl = option("--ttl-seconds");
if (!audience || args.some((arg) => arg.startsWith("-") && !["--audience", "--ttl-seconds"].includes(arg))) {
  fail("usage: opensession sandbox id-token --audience <audience> [--ttl-seconds <60..3600>]");
}
const parsedTtl = rawTtl === undefined ? undefined : Number(rawTtl);
if (parsedTtl !== undefined && (!Number.isInteger(parsedTtl) || parsedTtl < 60 || parsedTtl > 3600)) {
  fail("--ttl-seconds must be an integer between 60 and 3600");
}
const ttlSeconds: number | undefined = parsedTtl;
const endpoint = process.env.OPENSESSION_WORKLOAD_IDENTITY_URL;
const exchangeToken = process.env.OPENSESSION_WORKLOAD_IDENTITY_TOKEN;
if (!endpoint || !exchangeToken) {
  fail("this command is available only inside an OpenSession-managed sandbox command");
}

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    authorization: `Bearer ${exchangeToken}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ audience, ...(ttlSeconds === undefined ? {} : { ttl_seconds: ttlSeconds }) }),
});
const text = await response.text();
if (!response.ok) fail(`${response.status} ${text || response.statusText}`);
process.stdout.write(`${text.trim()}\n`);
