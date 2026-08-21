/** Shared GitHub webhook intake used by GitHub and Slack-only installations. */

import {
  MAX_WEBHOOK_BODY_BYTES,
  RequestBodyTooLargeError,
  readRequestTextWithinLimit,
  webhookBodyTooLargeResponse,
} from "../../server/shared/bounded-body";
import { verifyGitHubSignature } from "../../server/shared/signature";
import { incrementGithubWebhooks } from "../slack/state";
import {
  isGithubDeliveryProcessed,
  markGithubDeliveryProcessed,
} from "./deliveries";
import {
  firePullRequestReview,
  handleGithubPrEvent,
} from "./webhook";

const GITHUB_WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET || "";

export async function githubWebhookRoute(req: Request): Promise<Response> {
  let body: string;
  try {
    body = await readRequestTextWithinLimit(req, MAX_WEBHOOK_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError)
      return webhookBodyTooLargeResponse(MAX_WEBHOOK_BODY_BYTES);
    throw error;
  }
  const signature = req.headers.get("x-hub-signature-256") || "";
  if (!verifyGitHubSignature(body, signature, GITHUB_WEBHOOK_SECRET)) {
    console.error("[github] Invalid GitHub webhook signature");
    return Response.json({ error: "Invalid signature" }, { status: 401 });
  }
  const deliveryId = req.headers.get("x-github-delivery");
  if (deliveryId) {
    if (isGithubDeliveryProcessed(deliveryId))
      return Response.json({ ok: true, duplicate: true });
    markGithubDeliveryProcessed(deliveryId);
  }
  incrementGithubWebhooks();
  const event = req.headers.get("x-github-event") || "";
  const payload = JSON.parse(body);
  console.log(`[github] webhook: event=${event}, action=${payload.action}`);
  if (event === "pull_request_review") firePullRequestReview(payload);
  import("../../server/pr-webhook")
    .then((m) => m.handlePrWebhookEvent(event, payload))
    .catch((e) => console.error("[github] pr-webhook dispatch failed:", e));
  if (
    event === "pull_request" ||
    event === "issue_comment" ||
    event === "pull_request_review_comment" ||
    event === "workflow_run"
  ) {
    void handleGithubPrEvent(event, payload);
  }
  return Response.json({ ok: true });
}
