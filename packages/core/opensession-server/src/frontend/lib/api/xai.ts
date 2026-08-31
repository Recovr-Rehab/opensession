import { request } from "./request";

/** The one shared xAI (Grok) subscription. Tokens never leave the server, so
 *  nothing here carries one — `connected` is the whole of what a client may
 *  know about the credential. */
export interface XaiStatus {
  connected: boolean;
  /** Epoch ms. */
  connectedAt?: number;
  /** GitHub login of whoever connected it. */
  connectedBy?: string;
  /** Epoch ms the current access token stops being usable. Pi refreshes it
   *  well before this, so it is provenance rather than a deadline. */
  expiresAt?: number;
  /** Whether THIS viewer may connect or disconnect it (workspace admin). The
   *  server gates the mutating routes regardless; this only decides whether
   *  the buttons are worth offering. */
  canManage: boolean;
}

/** A device sign-in the server is running on our behalf. The flow id is a
 *  handle on that server-side flow, never xAI's device code — the code the
 *  person types is `userCode`, and the secret one stays on the server. */
export interface XaiDeviceFlow {
  flowId: string;
  userCode: string;
  verificationUri: string;
  /** Epoch ms. */
  expiresAt: number;
}

export type XaiPollResult =
  | { status: "pending" }
  | { status: "connected"; state: Omit<XaiStatus, "canManage"> }
  | { status: "error"; error: string };

export async function fetchXaiStatus(): Promise<XaiStatus> {
  return request("/xai/status", { label: "Grok status" });
}

export async function startXaiConnect(): Promise<XaiDeviceFlow> {
  return request("/xai/connect", { method: "POST", label: "Grok connect" });
}

export async function pollXaiConnect(flowId: string): Promise<XaiPollResult> {
  return request("/xai/connect/poll", {
    method: "POST",
    body: { flowId },
    label: "Grok connect poll",
  });
}

/** Abandon a sign-in nobody completed, so the server stops waiting on xAI too. */
export async function cancelXaiConnect(
  flowId: string,
): Promise<{ ok: boolean }> {
  return request("/xai/connect/cancel", {
    method: "POST",
    body: { flowId },
    label: "Grok connect cancel",
  });
}

export async function disconnectXai(): Promise<{ ok: boolean }> {
  return request("/xai/disconnect", {
    method: "POST",
    label: "Grok disconnect",
  });
}
