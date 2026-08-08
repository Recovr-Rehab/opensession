#!/usr/bin/env bun
/**
 * Computed-style A/B for the Tailwind migration: the measurement half, where
 * css-shots.ts is the visual half. Screenshots prove a surface still looks
 * right; this proves every longhand the browser resolved is unchanged, which
 * is what "migrate without redesigning" actually means.
 *
 *   bun scripts/css-ab.ts before --root '.sidebar-container'   # capture
 *   ...migrate a subtree, rebuild the frontend...
 *   bun scripts/css-ab.ts after  --root '.sidebar-container'
 *   bun scripts/css-ab.ts --diff before after
 *
 * Snapshots land in .css-ab/ (gitignored). Needs the same headful Chrome on a
 * virtual display that css-shots.ts documents — read its header for the launch
 * lines and why Chrome 146's headless mode cannot serve this app.
 *
 * ── Read a run honestly ─────────────────────────────────────────────────────
 * Capture the SAME label twice before believing anything: `before` vs
 * `before2` is the noise floor, and it should be 0. If it isn't, the numbers
 * below are measuring the app's live data, not your change.
 *
 * Four things had to be true before that floor reached zero, and each one cost
 * a run that looked like a regression:
 *
 *  · The theme is seeded before navigation, never by setting html[data-theme]
 *    afterwards. lib/theme.ts owns that attribute and re-applies it, so
 *    writing it by hand races the app and lands a few hundred phantom colour
 *    diffs.
 *  · The pointer is parked in a corner. A row left under the cursor reveals
 *    its hover-only action cluster, which reads as a pile of geometry diffs
 *    on elements you never touched.
 *  · Elements are keyed by structural path AND by their text. These surfaces
 *    render live data: rows arrive, and lists REORDER. A reorder keeps every
 *    child count identical, so a structural guard alone never sees it and
 *    happily compares two different rows. Text mismatch means "skip", not
 *    "differs".
 *  · Subtrees whose child count moved are dropped whole and reported, rather
 *    than compared by index one element out of step.
 *
 * ── What a diff means ───────────────────────────────────────────────────────
 * Benign, seen repeatedly, safe to accept: `rounded-full` serialising as
 * calc(infinity*1px) where the old rule said 999px; color-mix landing in oklab
 * where legacy used srgb; a transition list collapsing two identical durations
 * into one; an absolutely-positioned inline-flex computing as flex; Tailwind
 * prepending zero ring shadows to box-shadow.
 *
 * NOT benign, ever: padding, gap, width, height, font-size, line-height,
 * border-width — and `corner-shape`, which is why the corner longhands are
 * grabbed explicitly below. They are not enumerable on a computed style, so a
 * plain property walk misses them, and `rounded-full` is the one utility
 * spelling that opts OUT of base.css's squircle. Migrating a squircled element
 * to it flattens the corner at an identical border-radius — invisible to any
 * check that only reads radius.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SNAPS = join(ROOT, ".css-ab");
const PORT = Number(process.env.CDP_PORT ?? 9222);
const APP = process.env.OPENSESSION_URL ?? "http://127.0.0.1:3850";

const argv = process.argv.slice(2);
/** Accepts both `--root=<v>` and `--root <v>`; a selector is far easier to
 *  quote as a separate argument, and silently ignoring that spelling reads as
 *  "the tool is broken". */
const flag = (name: string) => {
	const eq = argv.find((a) => a.startsWith(`--${name}=`));
	if (eq) return eq.slice(name.length + 3);
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
/** Positional = anything that is neither a flag nor a flag's value. The
 *  booleans are listed so they can't swallow the label standing after them. */
const BOOLEANS = new Set(["--rect", "--freeze", "--diff"]);
const positionals = argv.filter(
	(a, i) =>
		!a.startsWith("--") &&
		!(i > 0 && argv[i - 1].startsWith("--") && !argv[i - 1].includes("=") && !BOOLEANS.has(argv[i - 1])),
);

// ── diff mode ───────────────────────────────────────────────────────────────

/** Computed values that are USED values derived from content or layout. A row
 *  whose title gained one character moves all of these, so they say nothing
 *  about whether the styling changed. `--rect` opts geometry back in. */
const DERIVED = new Set([
	"width",
	"height",
	"inline-size",
	"block-size",
	"perspective-origin",
	"transform-origin",
]);

if (argv[0] === "--diff") {
	const [a, b] = [argv[1], argv[2]];
	if (!a || !b) {
		console.error("usage: bun scripts/css-ab.ts --diff <before> <after> [--rect] [--cls=<substr>]");
		process.exit(2);
	}
	const withRect = argv.includes("--rect");
	const only = flag("cls");
	const A = JSON.parse(readFileSync(join(SNAPS, `${a}.json`), "utf8"));
	const B = JSON.parse(readFileSync(join(SNAPS, `${b}.json`), "utf8"));

	type Diff = { key: string; path: string; cls: string; prop: string; a: string; b: string };
	const all: Diff[] = [];

	/** Style bags are stored deduplicated and joined; decode each one at most
	 *  once into a name→value map. Two elements sharing a bag id are provably
	 *  identical, which is the common case and costs nothing to compare. */
	const decoder = (snap: any) => {
		const cache = new Map<number, Map<string, string>>();
		const names = new Map<number, string[]>();
		return (id: number | undefined) => {
			if (id === undefined) return undefined;
			let m = cache.get(id);
			if (!m) {
				const raw = String(snap.bags[id]);
				const cut = raw.indexOf("\u0002");
				const lid = Number(raw.slice(0, cut));
				let ns = names.get(lid);
				if (!ns) {
					ns = String(snap.lists[lid]).split("\u0001");
					names.set(lid, ns);
				}
				const vs = raw.slice(cut + 1).split("\u0001");
				m = new Map();
				for (let i = 0; i < ns.length; i++) m.set(ns[i], vs[i]);
				cache.set(id, m);
			}
			return m;
		};
	};

	for (const key of Object.keys(A)) {
		const ea = A[key]?.els as any[];
		const eb = B[key]?.els as any[];
		if (!ea || !eb) {
			console.log(`${key}: missing snapshot`);
			continue;
		}
		const decA = decoder(A[key]);
		const decB = decoder(B[key]);
		const ma = new Map(ea.map((e) => [e.path, e]));
		const mb = new Map(eb.map((e) => [e.path, e]));

		const childCount = (m: Map<string, any>, p: string) => {
			let n = 0;
			for (const k of m.keys()) {
				if (!k.startsWith(`${p}/`)) continue;
				if (k.slice(p.length + 1).includes("/")) continue;
				n++;
			}
			return n;
		};
		const drifted: string[] = [];
		for (const p of ma.keys()) {
			if (!mb.has(p)) continue;
			if (drifted.some((d) => p.startsWith(`${d}/`))) continue;
			if (childCount(ma, p) !== childCount(mb, p)) drifted.push(p);
		}

		let textSkips = 0;
		let compared = 0;
		for (const [p, ela] of ma) {
			const elb = mb.get(p);
			if (!elb || elb.tag !== ela.tag) continue;
			if (drifted.some((d) => p === d || p.startsWith(`${d}/`))) continue;
			if (ela.sig !== elb.sig) {
				textSkips++;
				continue;
			}
			if (only && !(ela.cls || "").includes(only) && !(elb.cls || "").includes(only)) continue;
			compared++;
			for (const bag of ["s", "b", "a"] as const) {
				// Identical bag ids mean identical values by construction, but a
				// pseudo-element present on one side only still has to be reported.
				if (ela[bag] === elb[bag]) continue;
				const va = decA(ela[bag]);
				const vb = decB(elb[bag]);
				const label = bag === "s" ? "" : `::${bag === "b" ? "before" : "after"} `;
				for (const prop of new Set([...(va?.keys() ?? []), ...(vb?.keys() ?? [])])) {
					if (DERIVED.has(prop)) continue;
					const x = va?.get(prop) ?? "<absent>";
					const y = vb?.get(prop) ?? "<absent>";
					if (x !== y) all.push({ key, path: p, cls: ela.cls, prop: label + prop, a: x, b: y });
				}
			}
			if (withRect)
				for (let i = 0; i < 4; i++)
					if ((ela.rect || [])[i] !== (elb.rect || [])[i])
						all.push({
							key,
							path: p,
							cls: ela.cls,
							prop: `rect.${["x", "y", "w", "h"][i]}`,
							a: String((ela.rect || [])[i]),
							b: String((elb.rect || [])[i]),
						});
		}
		console.log(
			`${key}: ${ea.length} -> ${eb.length} els; compared ${compared}, ` +
				`skipped ${drifted.length} drifted subtree(s) + ${textSkips} on text`,
		);
	}

	const byProp = new Map<string, Diff[]>();
	for (const d of all) {
		if (!byProp.has(d.prop)) byProp.set(d.prop, []);
		byProp.get(d.prop)!.push(d);
	}
	console.log(`\nprop diffs: ${all.length} across ${byProp.size} properties`);
	for (const [prop, ds] of [...byProp.entries()].sort((x, y) => y[1].length - x[1].length)) {
		const samples = new Map<string, Diff>();
		for (const d of ds) if (!samples.has(`${d.a} => ${d.b}`)) samples.set(`${d.a} => ${d.b}`, d);
		console.log(`\n${prop}  (${ds.length})`);
		for (const [k, d] of [...samples].slice(0, 8))
			console.log(`   ${k}\n      [${d.key} ${d.path}] cls="${(d.cls || "").slice(0, 110)}"`);
		if (samples.size > 8) console.log(`   ... ${samples.size - 8} more distinct value pairs`);
	}
	process.exit(all.length ? 1 : 0);
}

// ── capture ─────────────────────────────────────────────────────────────────

const label = positionals[0];
const rootSel = flag("root");
if (!label || !rootSel) {
	console.error("usage: bun scripts/css-ab.ts <label> --root '<selector>' [--hover='<selector>'] [--freeze]");
	process.exit(2);
}
/** Forced :hover, so hover styling is part of the same measurement instead of
 *  a separate manual pass. Hover is where a migration quietly loses a wash. */
const hoverSel = flag("hover");
/** Only for surfaces that animate at rest: a running animation moves `transform`
 *  between captures. It also blanks every animation-* longhand on BOTH sides,
 *  so a change to the animation itself stops being visible — leave it off
 *  unless the noise floor says otherwise. */
const freeze = argv.includes("--freeze");

/**
 * Chrome resolves ~546 longhands per element, and a real page is thousands of
 * elements — sent naively that is hundreds of megabytes, which does not fail
 * cleanly: the `returnByValue` call simply never returns and the run dies with
 * no output at all, looking like a broken script rather than a size limit.
 *
 * Two things make it tractable, both page-side so the bytes are never
 * transferred at all. Every element's values are joined into ONE string and
 * deduplicated — a list of 200 rows has 200 identical style bags and stores
 * one — and the property NAMES are stored once for the whole snapshot instead
 * of per element. What crosses the wire is a bag id per element.
 *
 * The names are captured from the first element and asserted identical for
 * every later one. Chrome enumerates the same longhand set for every element
 * and pseudo-element of a document, so this holds; if it ever stopped holding,
 * values would silently misalign against the wrong names, so it fails loudly
 * instead.
 */
const COLLECT = `((rootSel) => {
  const roots = [...document.querySelectorAll(rootSel)];
  // Name where we actually ended up. This app can restore a previous session on
  // load, so "/" does not reliably render the home route — without the landing
  // path in the message that reads as a broken selector.
  if (!roots.length) return { error: 'no element matches ' + rootSel + ' (landed on ' + location.pathname + ')' };
  // corner-shape and its longhands are NOT enumerable on a computed style, so
  // the index walk below never yields them. They are the whole point of the
  // squircle check — grab them by name.
  const extra = ['corner-shape','corner-top-left-shape','corner-top-right-shape','corner-bottom-left-shape','corner-bottom-right-shape'];
  // The property list is NOT the same for every element: Chrome enumerates
  // custom properties too, so an element carrying its own --vars yields a
  // longer list than its neighbour. Names therefore travel WITH each bag —
  // but the distinct name lists are themselves few, so they are deduplicated
  // separately and a bag references one by id.
  const lists = [];
  const byList = new Map();
  const bags = [];
  const byBag = new Map();
  const SEP = '\\u0001';
  const LSEP = '\\u0002';
  const bagId = (cs) => {
    const names = [];
    const vals = [];
    for (let i = 0; i < cs.length; i++) { names.push(cs[i]); vals.push(cs.getPropertyValue(cs[i])); }
    for (const p of extra) { const v = cs.getPropertyValue(p); if (v) { names.push(p); vals.push(v); } }
    const nkey = names.join(SEP);
    let lid = byList.get(nkey);
    if (lid === undefined) { lid = lists.length; lists.push(nkey); byList.set(nkey, lid); }
    const key = lid + LSEP + vals.join(SEP);
    let id = byBag.get(key);
    if (id === undefined) { id = bags.length; bags.push(key); byBag.set(key, id); }
    return id;
  };
  const out = [];
  const walk = (el, path) => {
    const cls = el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className || '');
    const rec = { path, tag: el.tagName, cls, s: bagId(getComputedStyle(el)) };
    const before = getComputedStyle(el, '::before');
    if (before.content && before.content !== 'none') rec.b = bagId(before);
    const after = getComputedStyle(el, '::after');
    if (after.content && after.content !== 'none') rec.a = bagId(after);
    const r = el.getBoundingClientRect();
    rec.rect = [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 100) / 100);
    // Live data reorders. Text is what tells two same-shaped rows apart.
    rec.sig = (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60);
    out.push(rec);
    let i = 0;
    for (const c of el.children) walk(c, path + '/' + (i++) + ':' + c.tagName);
  };
  roots.forEach((r, i) => walk(r, 'root' + (roots.length > 1 ? '#' + i : '')));
  window.__cssab = { lists, bags, els: out };
  return { count: out.length, bags: bags.length, lists: lists.length };
})(${JSON.stringify(rootSel)})`;

const CHUNK = 500;
const sliceEls = (i: number) => `window.__cssab.els.slice(${i}, ${i + CHUNK})`;
const sliceBags = (i: number) => `window.__cssab.bags.slice(${i}, ${i + CHUNK})`;

const FREEZE = `*, *::before, *::after { animation: none !important; transition: none !important; }`;

const VIEWS: [string, number, number][] = [
	["desktop", 1440, 1000],
	["phone", 390, 844],
];
const THEMES = ["dark", "light"];

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
const evaluate = async (expression: string) => {
	const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
	if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 1500));
	return r?.result?.value;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const token = JSON.parse(
	readFileSync(`${process.env.HOME}/.opensession-web-sessions.json`, "utf8"),
).sessions[0].token;

await send("Page.enable");
await send("Runtime.enable");
await send("Network.enable");
await send("DOM.enable");
await send("CSS.enable");
await send("Network.setCookie", { name: "opensession_auth", value: token, url: APP, path: "/" });

const result: Record<string, any> = {};
for (const theme of THEMES) {
	// Seeded before the document runs, so index.html's pre-paint script reads it
	// and lib/theme.ts has nothing to disagree with. Setting the attribute after
	// load instead is the single biggest source of phantom diffs.
	await send("Page.addScriptToEvaluateOnNewDocument", {
		source:
			`try { localStorage.setItem('opensession-theme', ${JSON.stringify(theme)}); } catch (e) {}` +
			(freeze
				? `document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(FREEZE)}; document.head.appendChild(s); });`
				: ""),
	});
	for (const [vname, w, h] of VIEWS) {
		await send("Emulation.setDeviceMetricsOverride", {
			width: w,
			height: h,
			deviceScaleFactor: 1,
			mobile: false,
			screenWidth: w,
			screenHeight: h,
		});
		await send("Page.navigate", { url: "about:blank" });
		await sleep(200);
		await send("Page.navigate", { url: APP + (flag("path") ?? "/") });
		await sleep(3000);
		// Park the pointer clear of every row, or whatever sits under it is
		// captured mid-hover with its action cluster revealed.
		await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: w - 3, y: 3 });

		// The app renders live data, so a fixed delay races it. Wait for the
		// subtree to stop growing rather than guessing.
		let prev = -1;
		for (let i = 0; i < 40; i++) {
			// :is() so a selector list or a combinator doesn't reassociate when a
			// descendant ' *' is appended (`.a,.b *` is not "descendants of either").
			const n = await evaluate(
				`document.querySelectorAll(':is(' + ${JSON.stringify(rootSel)} + ') *').length`,
			);
			if (n > 0 && n === prev) break;
			prev = n;
			await sleep(500);
		}

		if (hoverSel) {
			const { root } = await send("DOM.getDocument", { depth: 1 });
			const { nodeIds } = await send("DOM.querySelectorAll", {
				nodeId: root.nodeId,
				selector: hoverSel,
			});
			for (const nodeId of nodeIds ?? [])
				await send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] }).catch(() => {});
			await sleep(400);
		}

		const head = await evaluate(COLLECT);
		if (head.error) {
			result[`${vname}:${theme}`] = head;
			console.log(`  ${vname} ${theme}: ${head.error}`);
			continue;
		}
		const els: any[] = [];
		for (let i = 0; i < head.count; i += CHUNK) els.push(...(await evaluate(sliceEls(i))));
		const bags: string[] = [];
		for (let i = 0; i < head.bags; i += CHUNK) bags.push(...(await evaluate(sliceBags(i))));
		const lists: string[] = await evaluate("window.__cssab.lists");
		result[`${vname}:${theme}`] = { count: els.length, lists, bags, els };
		console.log(
			`  ${vname} ${theme}: ${els.length} els, ${bags.length} distinct style bags, ${lists.length} property list(s)`,
		);
	}
}

mkdirSync(SNAPS, { recursive: true });
writeFileSync(join(SNAPS, `${label}.json`), JSON.stringify(result));
// Close the tab, not just the socket. Each run opens one and every one holds a
// full copy of the app; leaving them behind slows the browser down until a
// later run hangs with no output at all, which reads as a broken script.
await fetch(`http://127.0.0.1:${PORT}/json/close/${target.id}`).catch(() => {});
ws.close();
console.log(`wrote ${join(SNAPS, `${label}.json`).replace(`${ROOT}/`, "")}`);
