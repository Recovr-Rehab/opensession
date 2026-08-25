import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect, type Socket } from "node:net";
import {
	AGENT_HOST_PROTOCOL_VERSION,
	decodeExecutorGrant,
	type AgentHostServerMessage,
	type AgentTurnSpec,
} from "@tellahq/opensession-protocol";
import { AgentHostClient } from "../server/agent-host-client";
import type { AgentTurnDriver, AgentTurnOutput, AgentTurnResult } from "./driver";
import { createAgentHost, type AgentHost } from "./host";
import { BoundedNdjsonDecoder, encodeNdjsonFrame } from "./socket-framing";

const grant = decodeExecutorGrant("test-executor-grant")!;
const fence = { sessionId: "session-1", runId: "run-1", turnId: "turn-1", generation: 3 };
const spec: AgentTurnSpec = {
	fence,
	input: { prompt: "Build it" },
	mode: "code",
	modelPolicy: { model: "test-model" },
	mcpPolicy: { servers: [] },
	transcriptPolicy: { maxAppendBytes: 4096, requireAck: true },
	executorGrant: grant,
};

class FakeDriver implements AgentTurnDriver {
	output?: AgentTurnOutput;
	steers: string[] = [];
	answers: string[] = [];
	acks: string[] = [];
	cancelled = 0;
	shutdowns = 0;
	private resolve!: (result: AgentTurnResult) => void;
	readonly completion = new Promise<AgentTurnResult>((resolve) => { this.resolve = resolve; });
	run(_spec: AgentTurnSpec, output: AgentTurnOutput) { this.output = output; return this.completion; }
	steer(input: { steerId: string; text: string }) { this.steers.push(`${input.steerId}:${input.text}`); }
	answer(askId: string) { this.answers.push(askId); }
	cancel() { this.cancelled += 1; }
	transcriptAck(appendId: string) { this.acks.push(appendId); }
	shutdown() { this.shutdowns += 1; }
	finish(result: AgentTurnResult = { status: "completed" }) { this.resolve(result); }
}

const resources: Array<{ host: AgentHost; dir: string }> = [];
afterEach(async () => {
	for (const resource of resources.splice(0)) {
		await resource.host.stop();
		await rm(resource.dir, { recursive: true, force: true });
	}
});

async function setup() {
	const dir = await mkdtemp(join(tmpdir(), "agent-host-test-"));
	const socketPath = join(dir, "host.sock");
	const driver = new FakeDriver();
	const host = createAgentHost({ socketPath, createDriver: () => driver });
	resources.push({ host, dir });
	await host.start();
	return { host, driver, socketPath };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("Agent Host transport", () => {
	test("runs event, transcript, ask, steer, answer, ack, cancel and finish flow", async () => {
		const { driver, socketPath } = await setup();
		const messages: AgentHostServerMessage[] = [];
		const client = new AgentHostClient({ socketPath, onMessage: (message) => messages.push(message) });
		await client.connect();
		await client.startTurn(spec);
		driver.output!.event({ type: "text_chunk", text: "hello" });
		driver.output!.proposeTranscript("append-1", [{ id: "entry-1", type: "assistant", content: "hello", timestamp: new Date(0).toISOString() }]);
		driver.output!.ask("ask-1", { question: "Continue?" });
		client.steer("continue", "steer-1");
		client.answer("ask-1", { behavior: "deny", message: "no" });
		client.transcriptAck("append-1", 7);
		client.cancel();
		await tick();
		expect(driver.steers).toEqual(["steer-1:continue"]);
		expect(driver.answers).toEqual(["ask-1"]);
		expect(driver.acks).toEqual(["append-1"]);
		expect(driver.cancelled).toBe(1);
		expect(messages.map((message) => message.t)).toEqual(["event", "transcript_proposal", "ask"]);
		driver.finish();
		await tick();
		expect(messages.at(-1)?.t).toBe("turn_finished");
		client.close();
	});

	test("rejects a stale generation and keeps the active turn", async () => {
		const { driver, socketPath } = await setup();
		const client = new AgentHostClient({ socketPath });
		await client.connect();
		await client.startTurn(spec);
		const messages = await rawExchange(socketPath, [
			{ t: "hello", version: AGENT_HOST_PROTOCOL_VERSION, requestId: "hello-2" },
			{ t: "cancel", version: AGENT_HOST_PROTOCOL_VERSION, requestId: "stale", fence: { ...fence, generation: 2 } },
		], 2);
		expect(messages[1]).toMatchObject({ t: "error", code: "stale_generation", requestId: "stale" });
		expect(driver.cancelled).toBe(0);
		client.close();
	});

	test("fails closed on a malformed frame and cancels on owner disconnect", async () => {
		const { driver, socketPath } = await setup();
		const malformed = connect(socketPath);
		await new Promise<void>((resolve) => malformed.once("connect", resolve));
		malformed.write("not-json\n");
		await new Promise<void>((resolve) => malformed.once("close", resolve));

		const client = new AgentHostClient({ socketPath });
		await client.connect();
		await client.startTurn(spec);
		client.close();
		await tick();
		expect(driver.cancelled).toBe(1);
	});

	test("start and stop are idempotent and clean up the socket", async () => {
		const { host, socketPath } = await setup();
		await host.start();
		await host.stop();
		await host.stop();
		expect(await Bun.file(socketPath).exists()).toBe(false);
	});
});

async function rawExchange(socketPath: string, outbound: unknown[], count: number): Promise<AgentHostServerMessage[]> {
	return new Promise((resolve, reject) => {
		const socket: Socket = connect(socketPath);
		const decoder = new BoundedNdjsonDecoder();
		const messages: AgentHostServerMessage[] = [];
		socket.on("connect", () => {
			for (const message of outbound) socket.write(encodeNdjsonFrame(message));
		});
		socket.on("data", (chunk) => {
			try {
				messages.push(...decoder.push(Buffer.from(chunk)) as AgentHostServerMessage[]);
				if (messages.length >= count) { socket.destroy(); resolve(messages); }
			} catch (error) { reject(error); }
		});
		socket.on("error", reject);
	});
}
