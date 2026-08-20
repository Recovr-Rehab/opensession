#!/usr/bin/env bun
/**
 * Build the single-executable `opensession` release artefact with
 * `bun build --compile`. This is the DEFAULT simple-mode artefact; the
 * source install (`install.sh --source`, a git checkout + `bun install`) is
 * the self-development path and is unaffected.
 *
 * src/main.ts is the front controller (server / CLI / runner-host / mcp-proxy
 * behind one argv), and this script bakes the prebuilt SPA into the binary so
 * it needs no `.frontend-dist` beside it at runtime.
 *
 * Two modes:
 *
 *   bun scripts/build-compile.ts --outfile <path>
 *       Just the binary for the host, for local testing. No sidecar, no seed.
 *
 *   bun scripts/build-compile.ts --os linux --arch arm64 [--out <dir>]
 *       The full release artefact `opensession-<ver>-<os>-<arch>.tar.gz`:
 *         opensession                 the target binary
 *         node_modules/               sharp + @img/sharp-<target> sidecar, so the
 *                                     binary resolves sharp beside itself and the
 *                                     social-card endpoint works (501 without it)
 *         release.json                version, commit, target, kind
 *       `bun build --compile --target=bun-<os>-<arch>` cross-compiles from any
 *       host, so one runner builds every target.
 *
 * Steps: build the prod frontend into `.frontend-dist`, generate the
 * `embedded-frontend.ts` `import … with { type: "file" }` module so Bun embeds
 * every asset, compile, then restore the stub so the working tree stays clean.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join, relative, resolve } from "path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const EMBED_MODULE = join(REPO_ROOT, "packages", "core", "opensession-server", "src", "server", "embedded-frontend.ts");

function arg(name: string, fallback?: string): string | undefined {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function has(name: string): boolean {
	return process.argv.includes(`--${name}`);
}

type Os = "linux" | "darwin";
type Arch = "arm64" | "x64";

const os = (arg("os", process.platform === "darwin" ? "darwin" : "linux") as Os);
const arch = (arg("arch", process.arch === "arm64" ? "arm64" : "x64") as Arch);
if (!["linux", "darwin"].includes(os) || !["arm64", "x64"].includes(arch)) {
	console.error(`unsupported target ${os}/${arch}`);
	process.exit(2);
}
// The host target needs no cross flag; a cross target does.
const isHost = os === (process.platform === "darwin" ? "darwin" : "linux") && arch === (process.arch === "arm64" ? "arm64" : "x64");

const CACHE_HOME = process.env.XDG_CACHE_HOME || join(process.env.HOME || "~", ".cache");
const OUT = resolve(arg("out", join(CACHE_HOME, "opensession-release"))!);

async function sh(cmd: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
	const p = Bun.spawn(cmd, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdout: "pipe", stderr: "pipe" });
	const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
	if ((await p.exited) !== 0) throw new Error(`${cmd.join(" ")} failed\n${out}\n${err}`);
	return out;
}
function dirBytes(p: string): number {
	let st;
	try { st = statSync(p); } catch { return 0; } // dangling symlink etc.
	if (!st.isDirectory()) return st.size;
	let n = 0;
	for (const c of readdirSync(p)) n += dirBytes(join(p, c));
	return n;
}

// Assets Bun should embed: the hashed SPA bundle + the stable-named wasm, plus
// index.html. Icons/splash/sw.js live under src/frontend and are cosmetic (they
// 404 under the compiled binary; the app still renders) — deliberately not
// embedded to keep the binary lean.
const ASSET_RE = /\.(?:js|css|map|wasm)$/;

async function buildFrontendDist(): Promise<{
	version: string;
	distDir: string;
	metaPath: string;
	shellPath: string;
}> {
	const fb = await import("../packages/core/opensession-server/src/server/frontend-build");
	// Build into a CLEAN dist so only THIS build's hashed assets get embedded.
	rmSync(fb.FRONTEND_DIST, { recursive: true, force: true });
	console.log("[compile] building prod frontend -> .frontend-dist ...");
	const version = await fb.buildFrontend();
	// Embed the instance-NEUTRAL shell (src/frontend/index.html) and the bundle
	// meta, NOT the rendered index.html: the binary stitches ITS OWN instance
	// config (name, public URL, default repo, bot logins) at boot, so one
	// release built anywhere serves any install correctly.
	const shellPath = join(fb.FRONTEND_SRC, "index.html");
	const metaPath = join(fb.FRONTEND_DIST, ".bundle-meta.json");
	if (!existsSync(shellPath)) throw new Error(`missing frontend shell at ${shellPath}`);
	if (!existsSync(metaPath)) throw new Error(`frontend build produced no ${metaPath}`);
	return { version, distDir: fb.FRONTEND_DIST, metaPath, shellPath };
}

function generateEmbedModule(
	distDir: string,
	version: string,
	metaPath: string,
	shellPath: string,
): string {
	const names = readdirSync(distDir)
		.filter((n) => !n.startsWith(".") && ASSET_RE.test(n))
		.sort();
	const meta = JSON.parse(readFileSync(metaPath, "utf8"));
	// The embed module lives deep under packages/; the source shell and the dist
	// elsewhere. Resolve every specifier from the module's own directory so the
	// depth of the module never has to be tracked here by hand.
	const spec = (p: string): string => {
		const s = relative(dirname(EMBED_MODULE), resolve(p)).replaceAll("\\", "/");
		return s.startsWith(".") ? s : `./${s}`;
	};
	const lines: string[] = [
		"// AUTO-GENERATED by scripts/build-compile.ts for `bun build --compile`.",
		"// Do not edit or commit: the build restores the src stub afterwards.",
		"/* eslint-disable */",
		`import __shell from ${JSON.stringify(spec(shellPath))} with { type: "file" };`,
	];
	const assetEntries: string[] = [];
	names.forEach((name, i) => {
		const ident = `__a${i}`;
		lines.push(
			`import ${ident} from ${JSON.stringify(spec(resolve(distDir, name)))} with { type: "file" };`,
		);
		assetEntries.push(`\t\t${JSON.stringify(name)}: ${ident},`);
	});
	// The embedded index.html is the NEUTRAL shell; the running server stitches
	// its own instance config into it at boot via renderIndexHtml(meta).
	lines.push(
		"",
		"export const EMBEDDED_FRONTEND = {",
		`\tversion: ${JSON.stringify(version)},`,
		"\tshellPath: __shell,",
		`\tmeta: ${JSON.stringify(meta)},`,
		"\tassets: {",
		...assetEntries,
		"\t},",
		"};",
		"",
	);
	return lines.join("\n");
}

/** Compile src/main.ts to `outfile` for the target, embedding the built SPA. */
async function compileBinary(
	outfile: string,
	version: string,
	distDir: string,
	metaPath: string,
	shellPath: string,
): Promise<void> {
	const stub = await Bun.file(EMBED_MODULE).text();
	mkdirSync(dirname(outfile), { recursive: true });
	// `bun build --compile` appends to an existing outfile, so remove any prior.
	rmSync(outfile, { force: true });
	writeFileSync(EMBED_MODULE, generateEmbedModule(distDir, version, metaPath, shellPath));
	try {
		const cmd = [
			"bun",
			"build",
			"--compile",
			...(isHost ? [] : [`--target=bun-${os}-${arch}`]),
			join(REPO_ROOT, "packages", "core", "opensession-server", "src", "main.ts"),
			"--outfile",
			outfile,
			// sharp's platform native is resolved at runtime and can't be embedded;
			// keep it (and its @img/* backends) out of the trace.
			"--external",
			"sharp",
			"--external",
			"@img/*",
		];
		console.log(`[compile] ${cmd.join(" ")}`);
		const proc = Bun.spawn(cmd, { cwd: REPO_ROOT, stdout: "inherit", stderr: "inherit" });
		if ((await proc.exited) !== 0) throw new Error("bun build --compile failed");
	} finally {
		writeFileSync(EMBED_MODULE, stub);
	}
	if (!existsSync(outfile)) throw new Error(`expected binary at ${outfile}`);
}

/** Install the sharp sidecar for the target into `<stage>/node_modules`. */
async function buildSharpSidecar(stage: string, sharpVersion: string): Promise<void> {
	const tmp = join(OUT, "sharp-sidecar", `${os}-${arch}`);
	rmSync(tmp, { recursive: true, force: true });
	mkdirSync(tmp, { recursive: true });
	writeFileSync(join(tmp, "package.json"), JSON.stringify({ dependencies: { sharp: sharpVersion } }, null, 2) + "\n");
	// `bun install --os/--cpu` fetches the target's optional @img/sharp-<target>
	// natives (npm's --os/--cpu does not resolve cross-platform optionals here).
	await sh(["bun", "install", "--ignore-scripts", `--os=${os}`, `--cpu=${arch}`], { cwd: tmp });
	// Prune other platforms' natives, matching build-release: keep only the
	// target's @img/sharp-<target> (glibc) family.
	const foreign = (d: string) =>
		/musl/.test(d) || (os === "linux" && /darwin|win32/.test(d)) || (os === "darwin" && /linux|win32/.test(d));
	const imgDir = join(tmp, "node_modules", "@img");
	if (existsSync(imgDir)) {
		for (const d of readdirSync(imgDir)) if (foreign(d)) rmSync(join(imgDir, d), { recursive: true, force: true });
	}
	cpSync(join(tmp, "node_modules"), join(stage, "node_modules"), { recursive: true });
	console.log(`[compile] sharp sidecar: ${(dirBytes(join(stage, "node_modules")) / 1e6).toFixed(0)} MB`);
}


async function main(): Promise<void> {
	const { version: fver, distDir, metaPath, shellPath } = await buildFrontendDist();

	// Bare-binary mode: --outfile with no artefact assembly (local testing).
	const bareOut = arg("outfile");
	if (bareOut && !has("out") && !has("os") && !has("arch")) {
		const outfile = resolve(bareOut);
		await compileBinary(outfile, fver, distDir, metaPath, shellPath);
		const mb = (statSync(outfile).size / 1e6).toFixed(1);
		console.log(`\n[compile] built ${outfile} (${mb} MB, v=${fver})`);
		return;
	}

	// Artefact mode.
	const pkg = JSON.parse(await Bun.file(join(REPO_ROOT, "package.json")).text()) as {
		version?: string;
		dependencies?: Record<string, string>;
	};
	const commit = (await sh(["git", "rev-parse", "--short", "HEAD"], { cwd: REPO_ROOT })).trim();
	const version = arg("version", `${pkg.version ?? "0.0.0"}+${commit}`)!;
	const sharpVersion = pkg.dependencies?.sharp ?? "latest";
	const name = `opensession-${version}-${os}-${arch}`;
	const stage = join(OUT, "stage", name);
	rmSync(stage, { recursive: true, force: true });
	mkdirSync(stage, { recursive: true });

	console.log(`\n== compile ${name}`);
	await compileBinary(join(stage, "opensession"), fver, distDir, metaPath, shellPath);
	// service.ts renders the systemd unit from this template at REPO_ROOT, which
	// for a binary install is the release dir — ship it beside the binary.
	cpSync(join(REPO_ROOT, "opensession.service"), join(stage, "opensession.service"));
	console.log("\n== sharp sidecar");
	await buildSharpSidecar(stage, sharpVersion);

	writeFileSync(
		join(stage, "release.json"),
		JSON.stringify(
			{ name, version, commit, os, arch, kind: "binary", builtAt: new Date().toISOString() },
			null,
			2,
		) + "\n",
	);

	const tarball = join(OUT, `${name}.tar.gz`);
	rmSync(tarball, { force: true });
	await sh(["tar", "--no-xattrs", "-C", join(OUT, "stage"), "-czf", tarball, name], { env: { COPYFILE_DISABLE: "1" } });
	const mb = (statSync(tarball).size / 1e6).toFixed(0);
	console.log(`\n[compile] ${tarball} (${mb} MB)`);
	console.log(`Install: install.sh --artifact ${tarball}`);
}

await main();
