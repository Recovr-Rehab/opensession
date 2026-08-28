/**
 * Fail-closed preload barrier for a future supervised gateway handoff.
 *
 * A standby process may parse and statically import the gateway graph, but it
 * must stop here before touching the shared state namespace, binding a socket,
 * starting a Worker/timer, or contacting an integration. Only the parent IPC
 * channel that launched it can release the barrier, using the exact nonce.
 */
export type GatewayRole = "active" | "standby";

export type GatewayActivationMessage = {
  type: "opensession_gateway_activate";
  nonce: string;
};

export type GatewayPreloadedMessage = {
  type: "opensession_gateway_preloaded";
  nonce: string;
  pid: number;
};

type ProcessPort = {
  pid: number;
  send?: (message: GatewayPreloadedMessage) => boolean;
  on(event: "message", listener: (message: unknown) => void): unknown;
  removeListener(event: "message", listener: (message: unknown) => void): unknown;
};

export function gatewayRole(env: NodeJS.ProcessEnv = process.env): GatewayRole {
  const value = env.OPENSESSION_GATEWAY_ROLE?.trim() || "active";
  if (value !== "active" && value !== "standby") {
    throw new Error(`Invalid OPENSESSION_GATEWAY_ROLE: ${value}`);
  }
  return value;
}

function activationMessage(value: unknown): GatewayActivationMessage | null {
  if (!value || typeof value !== "object") return null;
  const message = value as Partial<GatewayActivationMessage>;
  return message.type === "opensession_gateway_activate" &&
    typeof message.nonce === "string"
    ? message as GatewayActivationMessage
    : null;
}

export async function waitForGatewayActivationIfStandby(options: {
  env?: NodeJS.ProcessEnv;
  processPort?: ProcessPort;
} = {}): Promise<void> {
  const env = options.env ?? process.env;
  if (gatewayRole(env) === "active") return;

  const nonce = env.OPENSESSION_GATEWAY_NONCE?.trim();
  if (!nonce) {
    throw new Error("A standby gateway requires OPENSESSION_GATEWAY_NONCE");
  }
  const port = options.processPort ?? process;
  if (typeof port.send !== "function") {
    throw new Error("A standby gateway requires a supervised IPC channel");
  }

  await new Promise<void>((resolve, reject) => {
    const onMessage = (raw: unknown) => {
      const message = activationMessage(raw);
      if (!message) return;
      port.removeListener("message", onMessage);
      if (message.nonce !== nonce) {
        reject(new Error("Gateway activation nonce mismatch"));
        return;
      }
      resolve();
    };
    port.on("message", onMessage);
    const sent = port.send!({
      type: "opensession_gateway_preloaded",
      nonce,
      pid: port.pid,
    });
    if (sent === false) {
      port.removeListener("message", onMessage);
      reject(new Error("Gateway preload acknowledgement was not delivered"));
    }
  });
}
