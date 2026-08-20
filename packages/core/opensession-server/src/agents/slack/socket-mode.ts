/**
 * Slack Socket Mode transport.
 *
 * Instead of Slack POSTing events and interactivity to a public HTTPS URL, the
 * app opens an OUTBOUND WebSocket to Slack and receives the same payloads down
 * it. That means the Slack integration works with zero inbound internet
 * exposure: no public URL, no reverse proxy, no signing secret.
 *
 * Flow: POST `apps.connections.open` with the app-level token (`xapp-…`, which
 * is distinct from the bot `xoxb-…` token) → Slack returns a short-lived `wss://`
 * URL → dial it. Slack then pushes envelopes:
 *   - `hello`        — connection acknowledged (log only)
 *   - `disconnect`   — Slack is rotating the socket (~hourly) or asking us to
 *                      refresh; open a NEW connection and drop the old one only
 *                      once the new one is live, so no event is missed.
 *   - `events_api`   — the Events API JSON we would have received over HTTP,
 *                      dispatched into the shared `dispatchSlackEvent`.
 *   - `interactive`  — Block Kit / modal interactions → `dispatchSlackInteractive`.
 *   - `slash_commands` — only if the app registers any (this agent does not).
 *
 * Every envelope carrying an `envelope_id` is acked immediately (before the
 * work) so Slack does not retry. Slack redelivers on reconnect, so we buffer
 * nothing.
 *
 * Nothing here is armed at import — `startSlackSocket()` is called from
 * `SlackAgent.startup()`, and `stopSlackSocket()` from `shutdown()`. Reading an
 * env var at import is fine; opening the socket is not.
 */

import { fetchWithTimeout } from "../../server/shared/fetch-with-timeout";

const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN || "";

/** True when an app-level token is configured, so Socket Mode owns event intake. */
export function socketModeEnabled(): boolean {
  return SLACK_APP_TOKEN.length > 0;
}

// ── Envelope routing ─────────────────────────────────────────

export interface EnvelopeHandlers {
  onEvent: (payload: any) => Promise<void> | void;
  onInteractive: (payload: any) => Promise<void> | void;
  onSlashCommand?: (payload: any) => Promise<void> | void;
  /** Slack asked us to rotate the socket; open a fresh one. */
  onDisconnect?: () => void;
}

// Dispatch is imported lazily so merely importing this transport module does
// not eagerly pull the whole Slack agent graph (which resolves per-module env
// at import). That keeps the module light and breaks the import cycle with
// index.ts, which imports this module statically.
const liveHandlers: EnvelopeHandlers = {
  onEvent: async (payload) => {
    const { dispatchSlackEvent } = await import("./index");
    await dispatchSlackEvent(payload);
  },
  onInteractive: async (payload) => {
    const { dispatchSlackInteractive } = await import("./index");
    await dispatchSlackInteractive(payload);
  },
  onDisconnect: () => reconnectGraceful(),
};

/**
 * Route one decoded Socket Mode frame: ack first (Slack retries otherwise),
 * then dispatch the payload into the shared handlers. Exported for tests; the
 * live socket wires `send` to the receiving WebSocket and uses `liveHandlers`.
 */
export function handleSocketEnvelope(
  raw: string,
  send: (data: string) => void,
  handlers: EnvelopeHandlers = liveHandlers,
): void {
  let frame: any;
  try {
    frame = JSON.parse(raw);
  } catch (e) {
    console.warn("[slack] Socket Mode: unparseable frame:", e);
    return;
  }

  const type: string = frame?.type;

  if (type === "hello") {
    console.log(
      `[slack] Socket Mode: hello (${frame?.num_connections ?? "?"} connection(s))`,
    );
    return;
  }

  if (type === "disconnect") {
    console.log(`[slack] Socket Mode: disconnect (reason: ${frame?.reason || "unknown"})`);
    handlers.onDisconnect?.();
    return;
  }

  // Ack every envelope that carries an id BEFORE doing any work, so Slack
  // does not retry while we process.
  if (frame?.envelope_id) {
    send(JSON.stringify({ envelope_id: frame.envelope_id }));
  }

  const payload = frame?.payload;
  switch (type) {
    case "events_api":
      void handlers.onEvent(payload);
      break;
    case "interactive":
      void handlers.onInteractive(payload);
      break;
    case "slash_commands":
      if (handlers.onSlashCommand) void handlers.onSlashCommand(payload);
      else console.log("[slack] Socket Mode: slash_commands received but no handler");
      break;
    default:
      console.log(`[slack] Socket Mode: ignoring frame type "${type}"`);
  }
}

// ── Connection lifecycle ─────────────────────────────────────

const MAX_RECONNECT_MS = 30_000;

let socket: WebSocket | null = null;
let stopped = false;
let reconnectAttempts = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

/** Call `apps.connections.open` and return the `wss://` URL, or null on failure. */
async function openConnection(): Promise<string | null> {
  try {
    const resp = await fetchWithTimeout("https://slack.com/api/apps.connections.open", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Bearer ${SLACK_APP_TOKEN}`,
      },
    });
    const data = (await resp.json()) as any;
    if (!data?.ok || !data?.url) {
      console.error("[slack] Socket Mode: apps.connections.open failed:", data?.error || data);
      return null;
    }
    return data.url as string;
  } catch (e) {
    console.error("[slack] Socket Mode: apps.connections.open error:", e);
    return null;
  }
}

function scheduleReconnect(): void {
  if (stopped || reconnectTimer) return;
  const delay = Math.min(MAX_RECONNECT_MS, 1000 * 2 ** reconnectAttempts);
  // Full jitter so many workers don't reconnect in lockstep after an outage.
  const wait = Math.round(delay / 2 + Math.random() * (delay / 2));
  reconnectAttempts++;
  console.log(`[slack] Socket Mode: reconnecting in ${wait}ms`);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void connect(null);
  }, wait);
}

function wire(ws: WebSocket, previous: WebSocket | null): void {
  ws.onopen = () => {
    reconnectAttempts = 0;
    console.log("[slack] Socket Mode: connected");
    // Graceful rotation: the new socket is live, so it is now safe to drop the
    // old one without missing events.
    if (previous) {
      try {
        previous.close();
      } catch {}
    }
  };

  ws.onmessage = (ev: MessageEvent) => {
    const data = typeof ev.data === "string" ? ev.data : String(ev.data);
    handleSocketEnvelope(
      data,
      (out) => {
        try {
          ws.send(out);
        } catch (e) {
          console.warn("[slack] Socket Mode: ack send failed:", e);
        }
      },
      liveHandlers,
    );
  };

  ws.onerror = (ev: Event) => {
    console.warn("[slack] Socket Mode: socket error:", (ev as any)?.message || "");
  };

  ws.onclose = () => {
    if (stopped) return;
    // A socket superseded by a newer one (graceful rotation) must not trigger a
    // reconnect — only the current live socket closing does.
    if (socket !== ws) return;
    console.warn("[slack] Socket Mode: socket closed — reconnecting");
    scheduleReconnect();
  };
}

async function connect(previous: WebSocket | null): Promise<void> {
  if (stopped) return;
  const url = await openConnection();
  if (!url) {
    scheduleReconnect();
    return;
  }
  const ws = new WebSocket(url);
  socket = ws;
  wire(ws, previous);
}

/**
 * Handle a `disconnect` frame: open a NEW connection and keep the current one
 * until the replacement is live (its `onopen` closes the old one). Slack sends
 * this before it drops the socket, so there is no gap.
 */
function reconnectGraceful(): void {
  if (stopped) return;
  void connect(socket);
}

/** Arm Socket Mode. No-op unless SLACK_APP_TOKEN is set. Idempotent. */
export function startSlackSocket(): void {
  if (!socketModeEnabled()) return;
  if (socket || reconnectTimer) return; // already running
  stopped = false;
  reconnectAttempts = 0;
  console.log("[slack] Socket Mode: starting (outbound WebSocket, no inbound HTTP)");
  void connect(null);
}

/** Close the socket and stop reconnecting. Safe to call when not running. */
export function stopSlackSocket(): void {
  stopped = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    try {
      socket.close();
    } catch {}
    socket = null;
  }
}
