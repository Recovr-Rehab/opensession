/**
 * Inbound code.storage webhooks (https://code.storage/docs/guides/webhooks.md).
 *
 * `POST /codestorage/webhook` on the webhook server (registered by
 * CodeStorageIntegration.getRoutes()). Deliveries carry
 * `X-Pierre-Signature: t=<unix_ts>,sha256=<hex>` where the signature is
 * HMAC-SHA256(secret, `${t}.${body}`) — the secret lives at
 * `integrations.codeStorage.webhookSecret`; deliveries are rejected until it
 * is configured (fail-closed).
 *
 * On `push` we drop the PR-host branch cache for the pushed branch of every
 * registered repo backed by that code.storage repo, so branch-review state
 * reacts to external pushes instead of waiting out polling TTLs (mirror of
 * the GitHub flow in pr-webhook.ts, minus the bulk-cache write-through —
 * code.storage payloads carry no PR-shaped data to write through).
 * `repo.sync.*` events are acknowledged but unused for now.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { codeStorageConfig, configuredRepos } from "../config";
import { prHostFor } from "../pr-host";

/** Reject deliveries whose signed timestamp is too far from now (replay cap). */
const TOLERANCE_SECONDS = 300;

export function verifyCsWebhookSignature(
  body: string,
  header: string,
  secret: string,
  nowMs: number = Date.now(),
): boolean {
  const t = header.match(/(?:^|,)t=(\d+)(?:,|$)/)?.[1];
  const sig = header.match(/(?:^|,)sha256=([0-9a-fA-F]+)(?:,|$)/)?.[1];
  if (!t || !sig) return false;
  if (Math.abs(nowMs / 1000 - Number(t)) > TOLERANCE_SECONDS) return false;
  const expected = Buffer.from(
    createHmac("sha256", secret).update(`${t}.${body}`).digest("hex"),
  );
  const provided = Buffer.from(sig.toLowerCase());
  return expected.length === provided.length && timingSafeEqual(expected, provided);
}

export async function handleCsWebhook(req: Request): Promise<Response> {
  const secret = codeStorageConfig()?.webhookSecret;
  if (!secret) {
    return Response.json(
      { error: "integrations.codeStorage.webhookSecret is not configured" },
      { status: 503 },
    );
  }
  const body = await req.text();
  const signature = req.headers.get("x-pierre-signature") || "";
  if (!verifyCsWebhookSignature(body, signature, secret)) {
    console.error("[codestorage] Invalid webhook signature");
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = req.headers.get("x-pierre-event") || "";
  if (event !== "push") return Response.json({ ok: true, ignored: event });

  let payload: {
    repository?: { id?: string; url?: string };
    ref?: string;
  };
  try {
    payload = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid JSON payload" }, { status: 400 });
  }
  const repoPath = payload.repository?.url;
  const repoInternalId = payload.repository?.id;
  const branch =
    typeof payload.ref === "string" ? payload.ref.replace(/^refs\/heads\//, "") : "";
  if (!branch || (!repoPath && !repoInternalId)) return Response.json({ ok: true });

  // `repository.url` is the repo path ("acme/widget") — what Repo.csRepo
  // holds; the internal `repository.id` is matched too in case a config used it.
  for (const repo of Object.values(configuredRepos())) {
    if (repo.host !== "codestorage" || !repo.csRepo) continue;
    if (repo.csRepo !== repoPath && repo.csRepo !== repoInternalId) continue;
    // Advisory (the cs host owns its caches and the dispatch is
    // fire-and-forget) — the next PR-info read re-fetches the branch diff.
    prHostFor(repo).invalidatePrInfo(repo.csRepo, branch);
  }
  return Response.json({ ok: true });
}
