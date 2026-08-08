#!/usr/bin/env bun
/**
 * Visual gate for the Tailwind migration: screenshots the running app across
 * routes x {desktop, mobile} x {dark, light} so a CSS change can be diffed
 * against a baseline.
 *
 *   bun scripts/css-shots.ts baseline          # capture a baseline
 *   ...make a change, rebuild the frontend...
 *   bun scripts/css-shots.ts after            # capture again
 *   bun scripts/css-shots.ts --diff baseline after
 *
 * Shots land in .frontend-dist/../.css-shots/<name>/ (gitignored).
 *
 * Needs a Chrome with remote debugging on CDP_PORT (default 9222). On a
 * headless box Chrome 146 has no usable headless mode for this app — the page
 * reaches "interactive" with an empty #root — so run headful on a virtual
 * display:
 *
 *   Xvfb :94 -screen 0 1600x1000x24 </dev/null >/tmp/xvfb.log 2>&1 &
 *   DISPLAY=:94 google-chrome --remote-debugging-port=9222 --no-sandbox \
 *     --disable-gpu --user-data-dir=/tmp/css-shots-profile about:blank \
 *     </dev/null >/tmp/chrome.log 2>&1 &
 *
 * Determinism matters more than it looks. Three things made early runs report
 * differences that were not there:
 *   · flipping the theme after load animates, so a capture can catch a dark
 *     sidebar against a still-light pane — the theme is seeded before navigation;
 *   · transitions/animations are frozen during capture;
 *   · the app renders live session data, so a fixed delay races it — each shot
 *     polls until two consecutive frames are identical.
 * Even so, list routes carry a noise floor of a few hundred pixels as
 * timestamps tick over. Capture two baselines back to back to measure it
 * before believing any small diff.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SHOTS = join(ROOT, ".css-shots");
const PORT = Number(process.env.CDP_PORT ?? 9222);
const APP = process.env.OPENSESSION_URL ?? "http://127.0.0.1:3850";

const ROUTES: [string, string][] = [
	["home", "/"],
	["settings", "/settings"],
	["appearance", "/settings/appearance"],
	["reviews", "/reviews"],
	["notes", "/notes"],
	["automations", "/automations"],
];
const VIEWPORTS: [string, number, number][] = [
	["desktop", 1440, 900],
	["mobile", 390, 844],
];
const THEMES = ["dark", "light"];

const FREEZE = `
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
    caret-color: transparent !important;
  }
  html { scroll-behavior: auto !important; }
`;

// ── diff mode ───────────────────────────────────────────────────────────────
if (process.argv[2] === "--diff") {
	const [a, b] = [process.argv[3], process.argv[4]];
	if (!a || !b) {
		console.error("usage: bun scripts/css-shots.ts --diff <baseline> <after>");
		process.exit(2);
	}
	let worst = 0;
	for (const name of readdirSync(join(SHOTS, a)).sort()) {
		if (!name.endsWith(".png")) continue;
		let x: Buffer, y: Buffer;
		try {
			x = readFileSync(join(SHOTS, a, name));
			y = readFileSync(join(SHOTS, b, name));
		} catch {
			console.log(`  ${name.padEnd(38)} MISSING`);
			continue;
		}
		// Byte equality is the fast path; anything else needs a real look.
		const same = x.length === y.length && x.equals(y);
		if (!same) worst++;
		console.log(`  ${name.padEnd(38)} ${same ? "identical" : "DIFFERS — inspect"}`);
	}
	console.log(
		`\n${worst} frame(s) differ. Byte-compare only: list routes tick timestamps,` +
			"\nso inspect the crops before concluding the CSS caused it.",
	);
	process.exit(0);
}

const OUT = join(SHOTS, process.argv[2] ?? "shots");
mkdirSync(OUT, { recursive: true });

// ── capture ─────────────────────────────────────────────────────────────────
let id = 0;
const pending = new Map<number, (v: any) => void>();
const target = await fetch(`http://127.0.0.1:${PORT}/json/new?url=about:blank`, {
	method: "PUT",
}).then((r) => r.json());
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
ws.onmessage = (e) => {
	const m = JSON.parse(e.data as string);
	if (m.id && pending.has(m.id)) {
		pending.get(m.id)!(m.result);
		pending.delete(m.id);
	}
};
const send = (method: string, params: any = {}) => {
	const i = ++id;
	ws.send(JSON.stringify({ id: i, method, params }));
	return new Promise<any>((res) => pending.set(i, res));
};

const token = JSON.parse(
	readFileSync(`${process.env.HOME}/.opensession-web-sessions.json`, "utf8"),
).sessions[0].token;

await send("Page.enable");
await send("Network.enable");
await send("Runtime.enable");
await send("Emulation.setEmulatedMedia", {
	features: [{ name: "prefers-reduced-motion", value: "reduce" }],
});
await send("Network.setCookie", { name: "opensession_auth", value: token, url: APP, path: "/" });
await send("Page.addScriptToEvaluateOnNewDocument", {
	source: `
    try { localStorage.setItem('opensession-theme', window.__theme); } catch (e) {}
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.setAttribute('data-theme', window.__theme);
      const s = document.createElement('style');
      s.textContent = ${JSON.stringify(FREEZE)};
      document.head.appendChild(s);
    });
  `,
});

/** Screenshot repeatedly until two consecutive frames match, or we give up. */
async function settledShot(maxMs = 20000): Promise<string> {
	const t0 = Date.now();
	let prev = "";
	while (Date.now() - t0 < maxMs) {
		const s = await send("Page.captureScreenshot", { format: "png" });
		const cur = s?.data ?? "";
		if (cur && cur === prev) return cur;
		prev = cur;
		await new Promise((r) => setTimeout(r, 600));
	}
	return prev;
}

for (const [rname, path] of ROUTES) {
	for (const [vname, w, h] of VIEWPORTS) {
		await send("Emulation.setDeviceMetricsOverride", {
			width: w,
			height: h,
			deviceScaleFactor: 2,
			mobile: vname === "mobile",
			screenWidth: w,
			screenHeight: h,
		});
		for (const theme of THEMES) {
			await send("Page.addScriptToEvaluateOnNewDocument", {
				source: `window.__theme = ${JSON.stringify(theme)};`,
			});
			await send("Page.navigate", { url: "about:blank" });
			await new Promise((r) => setTimeout(r, 200));
			await send("Page.navigate", { url: APP + path });
			await new Promise((r) => setTimeout(r, 2500));
			const data = await settledShot();
			const file = join(OUT, `${rname}__${vname}__${theme}.png`);
			if (!data) {
				console.log(`  FAILED ${rname}/${vname}/${theme}`);
				continue;
			}
			writeFileSync(file, Buffer.from(data, "base64"));
			console.log(`  ${file.replace(ROOT + "/", "")}`);
		}
	}
}
ws.close();
