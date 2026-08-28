import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { resolve } from "node:path";
import {
  gatewayRole,
  waitForGatewayActivationIfStandby,
  type GatewayPreloadedMessage,
} from "./gateway-activation";

class FakePort extends EventEmitter {
  pid = 42;
  sent: GatewayPreloadedMessage[] = [];
  send = (message: GatewayPreloadedMessage) => {
    this.sent.push(message);
    return true;
  };
}

describe("gateway activation preload barrier", () => {
  test("keeps the compatibility path active by default", async () => {
    expect(gatewayRole({})).toBe("active");
    await expect(waitForGatewayActivationIfStandby({ env: {} })).resolves.toBeUndefined();
  });

  test("rejects unknown roles and unsupervised standby launches", async () => {
    expect(() => gatewayRole({ OPENSESSION_GATEWAY_ROLE: "candidate" })).toThrow(
      "Invalid OPENSESSION_GATEWAY_ROLE",
    );
    await expect(
      waitForGatewayActivationIfStandby({
        env: { OPENSESSION_GATEWAY_ROLE: "standby" },
        processPort: new FakePort(),
      }),
    ).rejects.toThrow("requires OPENSESSION_GATEWAY_NONCE");
    await expect(
      waitForGatewayActivationIfStandby({
        env: {
          OPENSESSION_GATEWAY_ROLE: "standby",
          OPENSESSION_GATEWAY_NONCE: "nonce-one",
        },
        processPort: {
          pid: 42,
          on() {},
          removeListener() {},
        },
      }),
    ).rejects.toThrow("requires a supervised IPC channel");
  });

  test("announces preload and waits for the exact parent activation", async () => {
    const port = new FakePort();
    let activated = false;
    const waiting = waitForGatewayActivationIfStandby({
      env: {
        OPENSESSION_GATEWAY_ROLE: "standby",
        OPENSESSION_GATEWAY_NONCE: "nonce-one",
      },
      processPort: port,
    }).then(() => {
      activated = true;
    });

    expect(port.sent).toEqual([
      { type: "opensession_gateway_preloaded", nonce: "nonce-one", pid: 42 },
    ]);
    port.emit("message", { type: "unrelated" });
    await Promise.resolve();
    expect(activated).toBe(false);
    port.emit("message", {
      type: "opensession_gateway_activate",
      nonce: "nonce-one",
    });
    await waiting;
    expect(activated).toBe(true);
    expect(port.listenerCount("message")).toBe(0);
  });

  test("entrypoint waits before every production boot effect", async () => {
    const entry = await Bun.file(resolve(import.meta.dir, "../../opensession.ts")).text();
    const barrier = entry.indexOf("await waitForGatewayActivationIfStandby()");
    expect(barrier).toBeGreaterThan(0);
    for (const effect of [
      "devInstanceBootError()",
      "startRunRpcServer()",
      "startMcpHttpServer()",
      "startTimerPoisonHeartbeat()",
      "mkdirSync(SESSIONS_DIR",
      "await startSessionKernelActor()",
      "await ensureFrontendBuilt()",
    ]) {
      expect(entry.indexOf(effect)).toBeGreaterThan(barrier);
    }
  });

  test("fails closed on an activation nonce mismatch", async () => {
    const port = new FakePort();
    const waiting = waitForGatewayActivationIfStandby({
      env: {
        OPENSESSION_GATEWAY_ROLE: "standby",
        OPENSESSION_GATEWAY_NONCE: "nonce-one",
      },
      processPort: port,
    });
    port.emit("message", {
      type: "opensession_gateway_activate",
      nonce: "nonce-two",
    });
    await expect(waiting).rejects.toThrow("nonce mismatch");
    expect(port.listenerCount("message")).toBe(0);
  });
});
