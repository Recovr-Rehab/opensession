/**
 * Static app shell assets: icons, service worker, splash images, hashed SPA assets, PWA manifest.
 *
 * Extracted verbatim from the opensession.ts fetch chain. Every handler
 * returns a Response for a matched route or undefined to fall through to the
 * next handler (see routes/index.ts for the dispatch order).
 */

import { existsSync, readFileSync, statSync } from "fs";
import type { RouteContext } from "./context";
import { configuredIntegration, configuredRepos, productName } from "../config";
import { FRONTEND_DIST, FRONTEND_SRC, devTailwindCss, frontend } from "../frontend-build";
import { isLocalProfile } from "../profile";
import { trimIconMargin } from "../png-trim";
import { resolveRepoIcon } from "../repo-appearance";

// Icons normalized for the tile, keyed by path and invalidated by mtime.
// Trimming decodes and re-encodes a PNG, which is silly to repeat for a file
// that hasn't changed since the last request.
const trimmedIcons = new Map<string, { mtimeMs: number; bytes: Uint8Array }>();

/**
 * A tile icon that lives on disk, or undefined when the file isn't there.
 *
 * Served with its empty margin cropped off and no margin added back (see
 * png-trim.ts): icons come drawn to whatever proportions their author chose — a
 * GitHub avatar puts its mark on ~60% of its canvas, an app icon on 80% — while
 * a letter tile fills its square, so untouched art reads visibly smaller than
 * the tiles beside it.
 */
function localIcon(iconPath: string): Response | undefined {
	if (!existsSync(iconPath)) return undefined;
	const mtimeMs = statSync(iconPath).mtimeMs;
	let entry = trimmedIcons.get(iconPath);
	if (!entry || entry.mtimeMs !== mtimeMs) {
		const raw = new Uint8Array(readFileSync(iconPath));
		entry = { mtimeMs, bytes: trimIconMargin(raw) ?? raw };
		trimmedIcons.set(iconPath, entry);
	}
	// A fresh view each time: a Response takes ownership of the buffer it is
	// handed, and this one is cached for the next request.
	return new Response(entry.bytes.slice().buffer as ArrayBuffer, {
		headers: {
			"Content-Type": "image/png",
			// These are editable assets: a day-long hard cache pins a redrawn
			// icon on every client that already fetched it.
			"Cache-Control": "public, max-age=3600, must-revalidate",
		},
	});
}

export async function handleStaticAssetsRoutes(
	ctx: RouteContext,
): Promise<Response | undefined> {
	// Local servers proxy the hosted shell and every matching asset so the Mac
	// app never runs frontend code from a stale checkout.
	if (isLocalProfile()) return undefined;

	const { req, url, path, publicPrefix } = ctx;

	// Dev-mode Tailwind sheet. In prod the utilities ride in the built bundle
	// as a hashed asset and index.html links it directly; under
	// OPENSESSION_DEV=1 the UI comes from Bun's HMR server, which can't compile
	// Tailwind — index.html's bootstrap script requests this instead when it
	// finds no hashed sheet. 404 in prod, so the request never happens twice.
	if (path === "/tailwind.css" && req.method === "GET") {
		const css = await devTailwindCss();
		if (!css) return new Response("Not found", { status: 404 });
		return new Response(css, {
			headers: {
				"Content-Type": "text/css; charset=utf-8",
				// Recompiled on every frontend edit — never let a reload keep an
				// old sheet.
				"Cache-Control": "no-store",
			},
		});
	}

	// App icons (red yin-yang, gen by scripts/gen-icons.py) — real PNGs so iOS home-screen and PWA installs
	// pick them up; data-URI apple-touch-icons don't work on iOS. Short cache
	// + must-revalidate so a refreshed design isn't pinned by a stale copy.
	const iconFiles: Record<string, string> = {
		"/apple-touch-icon.png": `${FRONTEND_SRC}/apple-touch-icon.png`, // 180×180
		"/icon-192.png": `${FRONTEND_SRC}/icon-192.png`,
		"/icon.png": `${FRONTEND_SRC}/icon.png`, // 512×512
		"/mac-app-icon.png": `${FRONTEND_SRC}/../../os1-mac/build/icon-512.png`,
	};
	if (iconFiles[path]) {
		return new Response(
			Bun.file(iconFiles[path]),
			{
				headers: {
					"Content-Type": "image/png",
					"Cache-Control": "public, max-age=3600, must-revalidate",
				},
			},
		);
	}

	// Per-repo icons for the RepoTile UI: a repo's configured `icon` PNG, and
	// nothing else. Anything without one 404s and the client paints its
	// colored letter tile instead.
	//
	// There used to be two fallbacks under that — the owner's local mark, then
	// the repo's GitHub org avatar. Both are marks for the OWNER, not the
	// repo, so every repo in one org wore the same tile: on this instance
	// seven of eight served identical bytes, which made the tile useless as a
	// way to tell repos apart and cost the phone's Inbox rows a whole second
	// line to spell the repo out. An icon is now opt-in per repo (`icon` in
	// the repo's config entry, absolute or relative to its checkout) and the
	// default is a color and a letter — the color assigned across the
	// registered set (see repo-tile-colors.ts) so no two of them match.
	//
	// Every icon served from src/frontend is drawn to the same proportions
	// (artwork on ~80% of a square canvas, corners rounded to match the tile's
	// own clip), because nothing downstream can normalize them: the tiles sit
	// side by side in the sidebar, in the phone app and in the PWA, and a mark
	// with more built-in padding than its neighbour just reads as a smaller
	// icon. Keep new icons on those proportions.
	const repoIcon = path.match(/^\/repo-icon\/([\w.-]+)\.png$/);
	if (repoIcon && req.method === "GET") {
		const id = repoIcon[1];
		// Feed bands (the feeds design) and the Plain project band ride the
		// same tile pipeline: any `<id>-icon.png` dropped in src/frontend
		// serves generically.
		if (/^[a-z0-9][a-z0-9_-]{0,40}$/i.test(id)) {
			const generic = localIcon(`${FRONTEND_SRC}/${id}-icon.png`);
			if (generic) return generic;
		}
		// A repo's optional `icon` — art someone chose for it, either a path in
		// its config or an avatar fetched into the state dir from Settings →
		// Setup. No icon, no tile art: the letter tile is the default.
		const repo = configuredRepos()[id];
		const configured = resolveRepoIcon(repo?.icon, repo?.repo);
		if (configured) {
			const served = localIcon(configured);
			if (served) return served;
		}
		return new Response("Not found", { status: 404 });
	}

	// Service worker (Web Push + app-shell cache). Must precede the hashed-asset
	// matcher — sw.js is served from source, never cached hard (the browser
	// refetches it on its own schedule and applies updates).
	if (path === "/sw.js") {
		return new Response(Bun.file(`${FRONTEND_SRC}/sw.js`), {
			headers: {
				"Content-Type": "text/javascript; charset=utf-8",
				"Cache-Control": "no-cache",
				// Scope follows the prefix this registration lives under.
				"Service-Worker-Allowed": `${publicPrefix}/`,
			},
		});
	}

	// iOS PWA launch images (apple-touch-startup-image). One PNG per device
	// resolution, generated by scripts/gen-splash.py. Filename is locked to the
	// apple-splash-<w>-<h>.png pattern so the path can't escape the folder.
	const splashMatch = path.match(
		/^\/splash\/(apple-splash-\d+-\d+\.png)$/,
	);
	if (splashMatch) {
		return new Response(
			Bun.file(`${FRONTEND_SRC}/splash/${splashMatch[1]}`),
			{
				headers: {
					"Content-Type": "image/png",
					"Cache-Control": "public, max-age=86400",
				},
			},
		);
	}

	// ghostty-web's WASM VT engine (the Shell tab's terminal). buildFrontend
	// copies it into FRONTEND_DIST; application/wasm keeps
	// WebAssembly.instantiateStreaming happy. Stable (unhashed) name — the
	// shell requests a fixed path — so revalidate instead of immutable.
	if (path === "/ghostty-vt.wasm") {
		const wasm = Bun.file(`${FRONTEND_DIST}/ghostty-vt.wasm`);
		if (await wasm.exists()) {
			return new Response(wasm, {
				headers: {
					"Content-Type": "application/wasm",
					"Cache-Control": "public, max-age=3600, must-revalidate",
				},
			});
		}
	}

	// Built SPA assets (prod only). Content-hashed filenames → cache forever.
	// Served gzipped (computed once, then memoised) since the JS is large.
	const assetMatch =
		frontend && path.match(/^\/([\w.-]+\.(?:js|css|map))$/);
	if (assetMatch && frontend) {
		const name = assetMatch[1];
		const file = Bun.file(`${FRONTEND_DIST}/${name}`);
		if (await file.exists()) {
			const type = name.endsWith(".css")
				? "text/css"
				: name.endsWith(".map")
					? "application/json"
					: "text/javascript";
			const headers: Record<string, string> = {
				"Content-Type": `${type}; charset=utf-8`,
				"Cache-Control": "public, max-age=31536000, immutable",
			};
			if ((req.headers.get("accept-encoding") || "").includes("gzip")) {
				let gz = frontend.gzip.get(name);
				if (!gz) {
					gz = new Blob([
						Bun.gzipSync(new Uint8Array(await file.arrayBuffer())),
					]);
					frontend.gzip.set(name, gz);
				}
				headers["Content-Encoding"] = "gzip";
				headers["Vary"] = "Accept-Encoding";
				return new Response(gz, { headers });
			}
			return new Response(file, { headers });
		}
	}
	if (path === "/manifest.webmanifest") {
		return Response.json(
			{
				name: productName(),
				short_name: productName(),
				// Per-prefix PWA identity: installs from the legacy /backstage
				// pages keep their identity; /opensession installs get the new
				// start_url. One re-install event max, never a broken one.
				start_url: `${publicPrefix}/`,
				display: "standalone",
				// On desktop, take over the OS titlebar: the window controls
				// overlay our own chrome instead of a separate OS bar with a
				// centered title. Falls back to plain standalone where WCO
				// isn't supported (iOS, older browsers). CSS handles the
				// controls inset + drag region under (display-mode:
				// window-controls-overlay).
				display_override: ["window-controls-overlay"],
				background_color: "#0b0809",
				theme_color: "#0b0809",
				icons: [
					{
						src: `${publicPrefix}/icon-192.png?v=4`,
						sizes: "192x192",
						type: "image/png",
						purpose: "any",
					},
					{
						src: `${publicPrefix}/icon.png?v=4`,
						sizes: "512x512",
						type: "image/png",
						purpose: "any",
					},
				],
			},
			{ headers: { "Content-Type": "application/manifest+json" } },
		);
	}

	// Universal links for the OS¹ desktop app (tellahq/os1-mac): lets plain
	// https://os.tella.dev/… links open the app once it's signed with the
	// associated-domains entitlement. Both spec locations, since Apple has
	// probed the bare path historically. Caveat: os.tella.dev resolves to a
	// tailnet IP, so Apple's AASA CDN can't fetch this — team devices need the
	// entitlement's `?mode=developer` alternate (direct fetch) for links to
	// activate; harmless for everyone else.
	if (
		path === "/.well-known/apple-app-site-association" ||
		path === "/apple-app-site-association"
	) {
		const configuredIds = configuredIntegration("clients").appleAppIds;
		const appIDs = Array.isArray(configuredIds)
			? configuredIds.filter((id): id is string => typeof id === "string")
			: [];
		return Response.json(
			{
				applinks: {
					apps: [],
					details: [
						{
							appIDs,
							components: [{ "/": "/*" }],
						},
					],
				},
			},
			{ headers: { "Cache-Control": "public, max-age=3600" } },
		);
	}

	return undefined;
}
