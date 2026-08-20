import { describe, expect, test } from "bun:test";
import { handleSocketEnvelope, type EnvelopeHandlers } from "./socket-mode";

/**
 * Feed synthetic Socket Mode frames through the envelope router and assert the
 * right shared handler is invoked and that an ack carrying the envelope_id is
 * sent — before the work — for every envelope that has one. The live socket is
 * never opened here.
 */

function harness() {
  const sent: string[] = [];
  const order: string[] = [];
  const events: any[] = [];
  const interactives: any[] = [];
  const slashes: any[] = [];
  let disconnects = 0;

  const handlers: EnvelopeHandlers = {
    onEvent: (p) => {
      order.push("dispatch");
      events.push(p);
    },
    onInteractive: (p) => {
      order.push("dispatch");
      interactives.push(p);
    },
    onSlashCommand: (p) => {
      order.push("dispatch");
      slashes.push(p);
    },
    onDisconnect: () => {
      disconnects++;
    },
  };

  const send = (data: string) => {
    order.push("ack");
    sent.push(data);
  };

  return { sent, order, events, interactives, slashes, get disconnects() { return disconnects; }, handlers, send };
}

describe("handleSocketEnvelope", () => {
  test("events_api → dispatchSlackEvent with the payload, acked first", () => {
    const h = harness();
    const payload = { type: "event_callback", event: { type: "message", text: "hi" } };
    handleSocketEnvelope(
      JSON.stringify({ type: "events_api", envelope_id: "env-1", payload }),
      h.send,
      h.handlers,
    );

    expect(h.events).toEqual([payload]);
    expect(h.interactives).toEqual([]);
    // Ack sent with exactly the envelope_id, and before the handler ran.
    expect(h.sent).toEqual([JSON.stringify({ envelope_id: "env-1" })]);
    expect(h.order).toEqual(["ack", "dispatch"]);
  });

  test("interactive → dispatchSlackInteractive with the payload, acked first", () => {
    const h = harness();
    const payload = { type: "block_actions", actions: [{ action_id: "stop:abc" }] };
    handleSocketEnvelope(
      JSON.stringify({ type: "interactive", envelope_id: "env-2", payload }),
      h.send,
      h.handlers,
    );

    expect(h.interactives).toEqual([payload]);
    expect(h.events).toEqual([]);
    expect(h.sent).toEqual([JSON.stringify({ envelope_id: "env-2" })]);
    expect(h.order).toEqual(["ack", "dispatch"]);
  });

  test("slash_commands → onSlashCommand when present, acked first", () => {
    const h = harness();
    const payload = { command: "/model", text: "opus" };
    handleSocketEnvelope(
      JSON.stringify({ type: "slash_commands", envelope_id: "env-3", payload }),
      h.send,
      h.handlers,
    );

    expect(h.slashes).toEqual([payload]);
    expect(h.sent).toEqual([JSON.stringify({ envelope_id: "env-3" })]);
    expect(h.order).toEqual(["ack", "dispatch"]);
  });

  test("hello is ignored: no ack, no dispatch", () => {
    const h = harness();
    handleSocketEnvelope(
      JSON.stringify({ type: "hello", num_connections: 1 }),
      h.send,
      h.handlers,
    );
    expect(h.sent).toEqual([]);
    expect(h.order).toEqual([]);
    expect(h.events).toEqual([]);
    expect(h.interactives).toEqual([]);
  });

  test("disconnect triggers a reconnect, no ack", () => {
    const h = harness();
    handleSocketEnvelope(
      JSON.stringify({ type: "disconnect", reason: "socket_mode_disabled" }),
      h.send,
      h.handlers,
    );
    expect(h.disconnects).toBe(1);
    expect(h.sent).toEqual([]);
  });

  test("unknown frame type: no dispatch, no crash", () => {
    const h = harness();
    handleSocketEnvelope(
      JSON.stringify({ type: "something_new", envelope_id: "env-4", payload: {} }),
      h.send,
      h.handlers,
    );
    // Still acked (it carries an envelope_id) but routed nowhere.
    expect(h.sent).toEqual([JSON.stringify({ envelope_id: "env-4" })]);
    expect(h.events).toEqual([]);
    expect(h.interactives).toEqual([]);
  });

  test("unparseable frame is swallowed", () => {
    const h = harness();
    expect(() => handleSocketEnvelope("not json", h.send, h.handlers)).not.toThrow();
    expect(h.sent).toEqual([]);
  });
});
