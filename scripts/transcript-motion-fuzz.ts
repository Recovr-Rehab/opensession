#!/usr/bin/env bun
/**
 * Fuzz the network-free transcript motion fixture in a real browser.
 *
 * usage: bun scripts/transcript-motion-fuzz.ts [--seeds 30] [--speed 8] [--out /tmp/report.json]
 */
import { writeFileSync } from "node:fs";
import {
	acquireCdpBrowser,
	cdpSender,
	closeCdpTarget,
	releaseCdpBrowser,
} from "./lib/cdp-browser";
import { localAutomationToken } from "./lib/local-auth";

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
	const index = argv.indexOf(`--${name}`);
	return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
};
const SEEDS = Math.max(1, Number(flag("seeds", "24")) || 24);
const SPEED = Math.min(20, Math.max(0.1, Number(flag("speed", "8")) || 8));
const OUT = flag("out", "");
const APP = process.env.OPENSESSION_URL ?? "http://127.0.0.1:3850";
const INIT = `(() => {
  const F = window.__transcriptMotionFuzz = { shifts: [], samples: [], errors: [] };
  addEventListener("error", event => F.errors.push(String(event.error?.stack || event.message)));
  addEventListener("unhandledrejection", event => F.errors.push(String(event.reason?.stack || event.reason)));
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) F.shifts.push({
        t: Math.round(entry.startTime), value: entry.value,
        input: entry.hadRecentInput,
        sources: (entry.sources || []).map(source => String(source.node?.className || source.node?.nodeName || "")),
      });
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
  let previous = new Map();
  const sample = () => {
    const scroller = document.querySelector("[data-transcript-motion-scroller]");
    const root = document.querySelector("[data-virtual-transcript]");
    if (scroller && root) {
      const box = scroller.getBoundingClientRect();
      const rows = [...root.children].filter(node => node.matches("[data-index]")).map(node => {
        const rect = node.getBoundingClientRect();
        return { key: node.dataset.transcriptKey || node.getAttribute("data-eid"), index: Number(node.dataset.index), top: rect.top - box.top, bottom: rect.bottom - box.top };
      });
      let maxJump = 0;
      for (const row of rows) {
        const old = previous.get(row.key);
        if (old !== undefined) maxJump = Math.max(maxJump, Math.abs(row.top - old));
      }
      previous = new Map(rows.map(row => [row.key, row.top]));
      F.samples.push({ t: performance.now(), top: scroller.scrollTop, height: scroller.scrollHeight, client: scroller.clientHeight, count: Number(root.dataset.virtualCount || 0), maxJump });
    }
    requestAnimationFrame(sample);
  };
  requestAnimationFrame(sample);
})();`;

type Result = {
	seed: number;
	width: number;
	reducedMotion: boolean;
	cpuRate: number;
	durationMs: number;
	apiRequests: string[];
	errors: string[];
	cls: number;
	shiftCount: number;
	maxSampledJump: number;
	horizontalOverflow: number;
	settledOverlap: number;
	distanceFromBottom: number;
	virtualCount: number;
	mountedRows: number;
	passed: boolean;
};

const lease = await acquireCdpBrowser();
const results: Result[] = [];
try {
	for (let seed = 1; seed <= SEEDS; seed++) {
		const width = [390, 720, 1_440][(seed - 1) % 3] ?? 390;
		const height = width <= 720 ? 844 : 900;
		const reducedMotion = seed % 5 === 0;
		const cpuRate = seed % 4 === 0 ? 6 : 1;
		const target = await fetch(
			`http://127.0.0.1:${lease.port}/json/new?url=about:blank`,
			{ method: "PUT" },
		).then((response) => response.json());
		const socket = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise<void>((resolve, reject) => {
			socket.onopen = () => resolve();
			socket.onerror = () => reject(new Error("CDP connection failed"));
		});
		const apiRequests: string[] = [];
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(String((event as MessageEvent).data));
			if (message.method !== "Network.requestWillBeSent") return;
			const url = String(message.params?.request?.url ?? "");
			if (url.includes("/api/")) apiRequests.push(url);
		});
		const send = cdpSender(socket);
		const startedAt = performance.now();
		try {
			await send("Page.enable");
			await send("Network.enable");
			await send("Runtime.enable");
			await send("Emulation.setDeviceMetricsOverride", {
				width,
				height,
				deviceScaleFactor: 1,
				mobile: false,
			});
			await send("Emulation.setCPUThrottlingRate", { rate: cpuRate });
			await send("Emulation.setEmulatedMedia", {
				features: [
					{
						name: "prefers-reduced-motion",
						value: reducedMotion ? "reduce" : "no-preference",
					},
				],
			});
			const token = localAutomationToken();
			if (token)
				await send("Network.setCookie", {
					name: "opensession_auth",
					value: token,
					url: APP,
					path: "/",
				});
			await send("Page.addScriptToEvaluateOnNewDocument", { source: INIT });
			await send("Page.navigate", {
				url: `${APP}/__fixtures/transcript-motion?seed=${seed}&speed=${SPEED}`,
			});
			const deadline = performance.now() + 30_000;
			let state = "";
			while (performance.now() < deadline) {
				const response = await send("Runtime.evaluate", {
					expression:
						'document.querySelector("[data-transcript-motion-state]")?.dataset.transcriptMotionState || ""',
					returnByValue: true,
				});
				state = String(response.result.value ?? "");
				if (state === "done") break;
				await Bun.sleep(40);
			}
			if (state !== "done") throw new Error(`seed ${seed} did not settle`);
			const snapshot = await send("Runtime.evaluate", {
				expression: `(() => {
          const F = window.__transcriptMotionFuzz;
          const scroller = document.querySelector("[data-transcript-motion-scroller]");
          const root = document.querySelector("[data-virtual-transcript]");
          const rows = root ? [...root.children].filter(node => node.matches("[data-index]")).map(node => {
            const rect = node.getBoundingClientRect();
            return { index: Number(node.dataset.index), top: rect.top, bottom: rect.bottom };
          }).sort((a, b) => a.index - b.index) : [];
          let overlap = 0;
          for (let index = 1; index < rows.length; index++) overlap = Math.max(overlap, rows[index - 1].bottom - rows[index].top);
          return {
            errors: F.errors,
            shifts: F.shifts,
            maxSampledJump: Math.max(0, ...F.samples.map(sample => sample.maxJump)),
            horizontalOverflow: scroller ? Math.max(0, scroller.scrollWidth - scroller.clientWidth) : -1,
            settledOverlap: Math.max(0, overlap),
            distanceFromBottom: scroller ? Math.max(0, scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) : -1,
            virtualCount: Number(root?.dataset.virtualCount || 0),
            mountedRows: rows.length,
          };
        })()`,
				returnByValue: true,
			});
			const value = snapshot.result.value;
			const shifts = value.shifts.filter(
				(shift: { input: boolean }) => !shift.input,
			);
			const result: Result = {
				seed,
				width,
				reducedMotion,
				cpuRate,
				durationMs: Math.round(performance.now() - startedAt),
				apiRequests,
				errors: value.errors,
				cls: shifts.reduce(
					(total: number, shift: { value: number }) => total + shift.value,
					0,
				),
				shiftCount: shifts.length,
				maxSampledJump: Math.round(value.maxSampledJump),
				horizontalOverflow: Math.round(value.horizontalOverflow),
				settledOverlap: Math.round(value.settledOverlap),
				distanceFromBottom: Math.round(value.distanceFromBottom),
				virtualCount: value.virtualCount,
				mountedRows: value.mountedRows,
				passed:
					apiRequests.length === 0 &&
					value.errors.length === 0 &&
					value.horizontalOverflow <= 1 &&
					value.settledOverlap <= 1 &&
					value.distanceFromBottom <= 2 &&
					value.virtualCount > 0,
			};
			results.push(result);
			console.error(
				`seed ${seed} ${width}px${reducedMotion ? " reduced" : ""}${cpuRate > 1 ? ` ${cpuRate}xCPU` : ""}: ${result.passed ? "ok" : "FAIL"} · CLS ${result.cls.toFixed(4)} · jump ${result.maxSampledJump}px`,
			);
		} catch (error) {
			results.push({
				seed,
				width,
				reducedMotion,
				cpuRate,
				durationMs: Math.round(performance.now() - startedAt),
				apiRequests,
				errors: [error instanceof Error ? error.stack ?? error.message : String(error)],
				cls: 0,
				shiftCount: 0,
				maxSampledJump: 0,
				horizontalOverflow: -1,
				settledOverlap: -1,
				distanceFromBottom: -1,
				virtualCount: 0,
				mountedRows: 0,
				passed: false,
			});
		} finally {
			socket.close();
			await closeCdpTarget(lease.port, target.id);
		}
	}
} finally {
	await releaseCdpBrowser(lease);
}

const report = {
	seeds: SEEDS,
	speed: SPEED,
	passed: results.filter((result) => result.passed).length,
	failed: results.filter((result) => !result.passed).length,
	maxCls: Math.max(0, ...results.map((result) => result.cls)),
	maxSampledJump: Math.max(0, ...results.map((result) => result.maxSampledJump)),
	results,
};
if (OUT) writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (report.failed > 0) process.exit(1);
