#!/usr/bin/env bun
/**
 * Fuzz the network-free transcript motion fixture in a real browser.
 *
 * usage: bun packages/core/opensession-server/src/frontend/tools/transcript-motion-fuzz.ts [--seeds 30] [--speed 8] [--out /tmp/report.json]
 */
import { writeFileSync } from "node:fs";
import {
	acquireCdpBrowser,
	cdpSender,
	closeCdpTarget,
	releaseCdpBrowser,
} from "../../../../../../scripts/lib/cdp-browser";
import { localAutomationToken } from "../../../../../../scripts/lib/local-auth";

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string) => {
	const index = argv.indexOf(`--${name}`);
	return index >= 0 ? (argv[index + 1] ?? fallback) : fallback;
};
const SEEDS = Math.max(1, Number(flag("seeds", "24")) || 24);
const SPEED = Math.min(20, Math.max(0.1, Number(flag("speed", "8")) || 8));
const OUT = flag("out", "");
const APP = process.env.OPENSESSION_URL ?? "http://127.0.0.1:3850";
const MAX_CLS = 0.15;
const MAX_THROTTLED_CLS = 0.2;
const MAX_MOUNTED_ROWS = 64;
const MAX_LONG_TASK_MS = 300;
const MAX_THROTTLED_LONG_TASK_MS = 1_200;
const MAX_FRAME_MS = 300;
const MAX_THROTTLED_FRAME_MS = 1_200;
const INIT = `(() => {
  const F = window.__transcriptMotionFuzz = { shifts: [], longTasks: [], samples: [], errors: [] };
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
  try {
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) F.longTasks.push({
        t: Math.round(entry.startTime), duration: entry.duration,
        event: Number(document.querySelector("[data-transcript-motion-event]")?.dataset.transcriptMotionEvent || 0),
      });
    }).observe({ type: "longtask", buffered: true });
  } catch {}
  let previous = new Map();
  let previousSampleAt = 0;
  const sample = (now) => {
    const scroller = document.querySelector("[data-transcript-motion-scroller]");
    const root = document.querySelector("[data-virtual-transcript]");
    const eventIndex = Number(document.querySelector("[data-transcript-motion-event]")?.dataset.transcriptMotionEvent || 0);
    if (scroller && root && eventIndex > 0) {
      const box = scroller.getBoundingClientRect();
      const rows = [...root.children].filter(node => node.matches("[data-index]")).map(node => {
        const rect = node.getBoundingClientRect();
        return { key: node.dataset.transcriptKey || node.getAttribute("data-eid"), index: Number(node.dataset.index), top: rect.top - box.top, bottom: rect.bottom - box.top };
      });
      let maxJump = 0;
      let maxContentJump = 0;
      for (const row of rows) {
        const old = previous.get(row.key);
        if (old !== undefined) {
          maxJump = Math.max(maxJump, Math.abs(row.top - old.top));
          maxContentJump = Math.max(maxContentJump, Math.abs(row.top + scroller.scrollTop - old.contentTop));
        }
      }
      previous = new Map(rows.map(row => [row.key, { top: row.top, contentTop: row.top + scroller.scrollTop }]));
      F.samples.push({ t: now, frameMs: previousSampleAt ? now - previousSampleAt : 0, top: scroller.scrollTop, height: scroller.scrollHeight, client: scroller.clientHeight, count: Number(root.dataset.virtualCount || 0), maxJump, maxContentJump });
      previousSampleAt = now;
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
	resizeObserverWarnings: number;
	cls: number;
	shiftCount: number;
	shiftSources: string[];
	maxSampledJump: number;
	maxContentJump: number;
	maxFrameMs: number;
	maxLongTaskMs: number;
	longTaskCount: number;
	horizontalOverflow: number;
	settledOverlap: number;
	settledDrift: number;
	distanceFromBottom: number;
	virtualCount: number;
	mountedRows: number;
	streamingRows: number;
	viewportResized: boolean;
	failures: string[];
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
			let viewportResized = false;
			while (performance.now() < deadline) {
				const response = await send("Runtime.evaluate", {
					expression: `(() => ({
					state: document.querySelector("[data-transcript-motion-state]")?.dataset.transcriptMotionState || "",
					event: Number(document.querySelector("[data-transcript-motion-event]")?.dataset.transcriptMotionEvent || 0),
				}))()`,
					returnByValue: true,
				});
				const progress = response.result.value as { state?: string; event?: number };
				state = String(progress.state ?? "");
				if (!viewportResized && width <= 720 && (progress.event ?? 0) >= 3) {
					viewportResized = true;
					// Exercise the phone's keyboard/visual-viewport path while tools and
					// stream rows are still changing, then restore the shipped viewport.
					await send("Emulation.setDeviceMetricsOverride", {
						width,
						height: Math.max(480, height - 260),
						deviceScaleFactor: 1,
						mobile: false,
					});
					await Bun.sleep(80);
					await send("Emulation.setDeviceMetricsOverride", {
						width,
						height,
						deviceScaleFactor: 1,
						mobile: false,
					});
				}
				if (state === "done") break;
				await Bun.sleep(40);
			}
			if (state !== "done") throw new Error(`seed ${seed} did not settle`);
			let previousPositions: Record<string, number> = {};
			let stableFrames = 0;
			for (let attempt = 0; attempt < 60 && stableFrames < 3; attempt++) {
				const positions = await send("Runtime.evaluate", {
					expression: `(() => { const root = document.querySelector("[data-virtual-transcript]"); return Object.fromEntries(root ? [...root.children].filter(node => node.matches("[data-index]")).map(node => [Number(node.dataset.index), node.getBoundingClientRect().top]) : []); })()`,
					returnByValue: true,
				});
				const current = positions.result.value as Record<string, number>;
				const drift = Math.max(
					0,
					...Object.entries(current).map(([index, top]) =>
						Math.abs((previousPositions[index] ?? top) - top),
					),
				);
				stableFrames = drift <= 1 ? stableFrames + 1 : 0;
				previousPositions = current;
				await Bun.sleep(50);
			}
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
          const positions = Object.fromEntries(rows.map(row => [row.index, row.top]));
          return {
            errors: F.errors,
            shifts: F.shifts,
            maxSampledJump: Math.max(0, ...F.samples.map(sample => sample.maxJump)),
            maxContentJump: Math.max(0, ...F.samples.map(sample => sample.maxContentJump)),
            maxFrameMs: Math.max(0, ...F.samples.map(sample => sample.frameMs)),
            maxLongTaskMs: Math.max(0, ...F.longTasks.filter(task => task.event > 0).map(task => task.duration)),
            longTaskCount: F.longTasks.filter(task => task.event > 0).length,
            horizontalOverflow: scroller ? Math.max(0, scroller.scrollWidth - scroller.clientWidth) : -1,
            settledOverlap: Math.max(0, overlap),
            positions,
            distanceFromBottom: scroller ? Math.max(0, scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight) : -1,
            virtualCount: Number(root?.dataset.virtualCount || 0),
            mountedRows: rows.length,
            streamingRows: document.querySelectorAll(".msg-streaming").length,
          };
        })()`,
				returnByValue: true,
			});
			const value = snapshot.result.value;
			await Bun.sleep(50);
			const settledAgain = await send("Runtime.evaluate", {
				expression: `(() => { const root = document.querySelector("[data-virtual-transcript]"); return Object.fromEntries(root ? [...root.children].filter(node => node.matches("[data-index]")).map(node => [Number(node.dataset.index), node.getBoundingClientRect().top]) : []); })()`,
				returnByValue: true,
			});
			const laterPositions = settledAgain.result.value as Record<string, number>;
			const settledDrift = Math.max(
				0,
				...Object.entries(value.positions as Record<string, number>).map(
					([index, top]) => Math.abs((laterPositions[index] ?? top) - top),
				),
			);
			const resizeObserverWarnings = value.errors.filter((error: string) =>
				error.startsWith("ResizeObserver loop completed"),
			).length;
			const errors = value.errors.filter(
				(error: string) => !error.startsWith("ResizeObserver loop completed"),
			);
			const shifts = (value.shifts as Array<{
				input: boolean;
				value: number;
				sources: string[];
			}>).filter((shift) => !shift.input);
			const cls = shifts.reduce(
				(total: number, shift: { value: number }) => total + shift.value,
				0,
			);
			const failures = [
				...(apiRequests.length ? [`${apiRequests.length} API requests`] : []),
				...(errors.length ? [`${errors.length} runtime errors`] : []),
				...(resizeObserverWarnings ? [`${resizeObserverWarnings} ResizeObserver warnings`] : []),
				...(cls > (cpuRate > 1 ? MAX_THROTTLED_CLS : MAX_CLS)
					? [`CLS ${cls.toFixed(3)} > ${cpuRate > 1 ? MAX_THROTTLED_CLS : MAX_CLS}`]
					: []),
				...(value.maxLongTaskMs >
				(cpuRate > 1 ? MAX_THROTTLED_LONG_TASK_MS : MAX_LONG_TASK_MS)
					? [`long task ${Math.round(value.maxLongTaskMs)}ms`]
					: []),
				...(value.maxFrameMs >
				(cpuRate > 1 ? MAX_THROTTLED_FRAME_MS : MAX_FRAME_MS)
					? [`frame ${Math.round(value.maxFrameMs)}ms`]
					: []),
				...(value.horizontalOverflow > 1 ? [`${Math.round(value.horizontalOverflow)}px horizontal overflow`] : []),
				...(value.settledOverlap > 11 ? [`${Math.round(value.settledOverlap)}px row overlap`] : []),
				...(settledDrift > 1 ? [`${Math.round(settledDrift)}px settled drift`] : []),
				...(value.virtualCount <= 0 ? ["no virtual rows"] : []),
				...(value.streamingRows > 0 ? [`${value.streamingRows} stale streaming rows`] : []),
				...(value.mountedRows > MAX_MOUNTED_ROWS
					? [`${value.mountedRows} mounted rows > ${MAX_MOUNTED_ROWS}`]
					: []),
			];
			const result: Result = {
				seed,
				width,
				reducedMotion,
				cpuRate,
				durationMs: Math.round(performance.now() - startedAt),
				apiRequests,
				errors,
				resizeObserverWarnings,
				cls,
				shiftCount: shifts.length,
				shiftSources: [
					...new Set(
						shifts.flatMap((shift: { sources: string[] }) => shift.sources),
					),
				],
				maxSampledJump: Math.round(value.maxSampledJump),
				maxContentJump: Math.round(value.maxContentJump),
				maxFrameMs: Math.round(value.maxFrameMs),
				maxLongTaskMs: Math.round(value.maxLongTaskMs),
				longTaskCount: value.longTaskCount,
				horizontalOverflow: Math.round(value.horizontalOverflow),
				settledOverlap: Math.round(value.settledOverlap),
				settledDrift: Math.round(settledDrift),
				distanceFromBottom: Math.round(value.distanceFromBottom),
				virtualCount: value.virtualCount,
				mountedRows: value.mountedRows,
				streamingRows: value.streamingRows,
				viewportResized,
				failures,
				passed: failures.length === 0,
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
				resizeObserverWarnings: 0,
				cls: 0,
				shiftCount: 0,
				shiftSources: [],
				maxSampledJump: 0,
				maxContentJump: 0,
				maxFrameMs: 0,
				maxLongTaskMs: 0,
				longTaskCount: 0,
				horizontalOverflow: -1,
				settledOverlap: -1,
				settledDrift: -1,
				distanceFromBottom: -1,
				virtualCount: 0,
				mountedRows: 0,
				streamingRows: 0,
				viewportResized: false,
				failures: ["run failed"],
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
	maxClsStandard: Math.max(
		0,
		...results.filter((result) => !result.reducedMotion).map((result) => result.cls),
	),
	maxClsReduced: Math.max(
		0,
		...results.filter((result) => result.reducedMotion).map((result) => result.cls),
	),
	resizeObserverWarnings: results.reduce(
		(total, result) => total + result.resizeObserverWarnings,
		0,
	),
	maxSampledJump: Math.max(0, ...results.map((result) => result.maxSampledJump)),
	maxContentJump: Math.max(0, ...results.map((result) => result.maxContentJump)),
	maxFrameMs: Math.max(0, ...results.map((result) => result.maxFrameMs)),
	maxLongTaskMs: Math.max(0, ...results.map((result) => result.maxLongTaskMs)),
	budgets: {
		maxCls: MAX_CLS,
		maxThrottledCls: MAX_THROTTLED_CLS,
		maxMountedRows: MAX_MOUNTED_ROWS,
		maxLongTaskMs: MAX_LONG_TASK_MS,
		maxThrottledLongTaskMs: MAX_THROTTLED_LONG_TASK_MS,
		maxFrameMs: MAX_FRAME_MS,
		maxThrottledFrameMs: MAX_THROTTLED_FRAME_MS,
	},
	results,
};
if (OUT) writeFileSync(OUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
if (report.failed > 0) process.exit(1);
