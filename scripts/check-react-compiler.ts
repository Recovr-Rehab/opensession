/**
 * CI gate: the React Compiler must compile every frontend source.
 *
 * A bailout is silent lost memoization today and a correctness risk tomorrow
 * (uncompiled functions mint fresh identities our de-memoized code depends on
 * being stable).
 *
 * Ratchet mode: `.react-compiler-baseline.json` lists per-file diagnostic
 * counts at adoption time. Counts may not GROW; a change that fixes a file
 * deletes its entry. When the baseline is empty the script hard-fails on any
 * diagnostic. Run via `bun run check:compiler`.
 */
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { transformSync } from "oxc-transform-react";

const REPO = join(import.meta.dir, "..");
const FRONTEND = join(REPO, "packages/core/opensession-server/src/frontend");
const BASELINE = join(REPO, ".react-compiler-baseline.json");
const UPDATE = process.argv.includes("--update");

function sources(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const p = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...sources(p));
		else if (/\.(tsx|ts)$/.test(entry.name) && !entry.name.includes(".test.")) out.push(p);
	}
	return out;
}

type Baseline = Record<string, number>;
const baseline: Baseline = existsSync(BASELINE)
	? JSON.parse(readFileSync(BASELINE, "utf8"))
	: {};

const counts: Baseline = {};
let total = 0;
for (const file of sources(FRONTEND)) {
	const src = readFileSync(file, "utf8");
	if (!/[uU]se[A-Z]|memo\(/.test(src)) continue;
	const result = transformSync(file, src, {
		lang: file.endsWith(".tsx") ? "tsx" : "ts",
		jsx: { development: false },
		reactCompiler: { target: "19", panicThreshold: "none" },
	});
	if (!result.errors.length) continue;
	const rel = file.slice(FRONTEND.length + 1);
	counts[rel] = result.errors.length;
	total += result.errors.length;
}

if (UPDATE) {
	writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + "\n");
	console.log(`Baseline written: ${Object.keys(counts).length} files, ${total} diagnostics.`);
	process.exit(0);
}

let grew = 0;
let regressed = false;
for (const [file, count] of Object.entries(counts)) {
	const allowed = baseline[file] ?? 0;
	if (count > allowed) {
		regressed = true;
		console.error(`${file}: ${count} diagnostics (baseline allows ${allowed})`);
		grew += count - allowed;
	}
}
for (const file of Object.keys(baseline)) {
	if (!(file in counts)) {
		console.log(`✅ ${file}: clean — remove it from the baseline.`);
	}
}

if (regressed) {
	console.error(
		`\nReact Compiler bailouts GREW by ${grew}. The affected functions ship`,
		console.error("without memoization. Fix the construct (unsupported try/finally,"),
		console.error("refs during render, …); do not raise the baseline."),
	);
	process.exit(1);
}
console.log(
	`React Compiler ratchet holds: ${total} diagnostics across ${Object.keys(counts).length} files (at or under baseline).`,
);
