/**
 * Dynamic social card for session links.
 *
 * The UI normally lives on a private host, so Slack cannot crawl its Open Graph
 * metadata. The same renderer is therefore available on the public webhook
 * origin and is also linked from the session page for clients that can crawl it.
 */

import sharp from "sharp";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { chmodSync, readFileSync, writeFileSync } from "fs";
import {
	configuredIntegration,
	configuredServer,
	productName,
} from "./config";
import { modelLabel } from "./models";
import { teamDirectory, type DirectoryPerson } from "./people";
import { stateDir } from "./paths";
import { findSessionAsync } from "./session-cache";
import type { UnifiedSession } from "./types";
import { resolveWorkspaceModelPreset } from "./workspace-model-presets";
import { getWorkspace } from "./workspaces";

export const SESSION_CARD_WIDTH = 1200;
export const SESSION_CARD_HEIGHT = 630;

export interface SessionSocialCardData {
	title: string;
	sessionTitle?: string;
	owner: string;
	repo?: string;
	model?: string;
	mode?: string;
	person?: DirectoryPerson;
}

function clean(value: string | null | undefined): string {
	return (value || "").replace(/\s+/g, " ").trim();
}

function samePerson(person: DirectoryPerson, ref: string): boolean {
	const key = ref.trim().replace(/^@/, "").toLowerCase();
	return [person.name, person.fullName, person.github]
		.filter(Boolean)
		.some((value) => value!.toLowerCase() === key);
}

export function sessionCardTitle(
	session: UnifiedSession,
): { title: string; session?: string } {
	const sessionTitle = clean(session.title) || session.id;
	const workspace = session.workspaceId ? getWorkspace(session.workspaceId) : null;
	const workspaceName = clean(workspace?.name);
	if (!workspaceName) return { title: sessionTitle };
	return {
		title: workspaceName,
		session: sessionTitle !== workspaceName ? sessionTitle : undefined,
	};
}

function sessionModelLabel(session: UnifiedSession): string | undefined {
	if (!session.model) return undefined;
	const captured = session.presetNote
		?.match(/^## Workspace model preset · ([^\n]+)/m)?.[1]
		?.trim();
	if (captured) return captured;
	const preset = resolveWorkspaceModelPreset(session.model);
	if (preset?.label) return preset.label;
	const presetSlug = session.model.match(
		/(?:^|\/)workspace-preset\/[^/]+\/([^/]+)$/,
	)?.[1];
	if (presetSlug) {
		return presetSlug
			.split("-")
			.filter(Boolean)
			.map((part) => `${part[0]?.toUpperCase() || ""}${part.slice(1)}`)
			.join(" ");
	}
	return modelLabel(session.model);
}

export function sessionSocialCardData(
	session: UnifiedSession,
): SessionSocialCardData {
	const heading = sessionCardTitle(session);
	const ownerRef = clean(session.createdBy || session.startedBy) || productName();
	const person = teamDirectory().find((candidate) => samePerson(candidate, ownerRef));
	const model = sessionModelLabel(session);
	return {
		title: heading.title,
		...(heading.session ? { sessionTitle: heading.session } : {}),
		owner: person?.fullName || ownerRef,
		...(session.repo ? { repo: session.repo } : {}),
		...(model ? { model } : {}),
		...(session.mode ? { mode: session.mode } : {}),
		...(person ? { person } : {}),
	};
}

function xml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

function html(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll('"', "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}

function initials(name: string): string {
	return name
		.split(/\s+/)
		.slice(0, 2)
		.map((part) => part[0] || "")
		.join("")
		.toUpperCase();
}

/** Two display lines that keep the title readable at social-card size. */
export function socialCardTitleLines(title: string): string[] {
	const words = clean(title).split(" ").filter(Boolean);
	if (!words.length) return [productName()];
	const lines: string[] = [];
	for (const word of words) {
		const next = lines.length ? `${lines[lines.length - 1]} ${word}` : word;
		if (next.length <= 22 || lines.length === 0) {
			if (!lines.length) lines.push(next);
			else lines[lines.length - 1] = next;
			continue;
		}
		if (lines.length === 1) {
			lines.push(word);
			continue;
		}
		lines[1] = `${lines[1]} ${word}`;
	}
	if (lines.length > 2) lines.length = 2;
	if (lines[1]?.length > 31) lines[1] = `${lines[1].slice(0, 30).trimEnd()}…`;
	if (lines[0].length > 31) lines[0] = `${lines[0].slice(0, 30).trimEnd()}…`;
	return lines;
}

const avatarCache = new Map<string, string>();
const AVATAR_CACHE_LIMIT = 100;

function rememberAvatar(key: string, data: string): void {
	avatarCache.delete(key);
	avatarCache.set(key, data);
	if (avatarCache.size <= AVATAR_CACHE_LIMIT) return;
	const oldest = avatarCache.keys().next().value;
	if (oldest) avatarCache.delete(oldest);
}

async function compactAvatar(bytes: ArrayBuffer): Promise<string> {
	const png = await sharp(Buffer.from(bytes), { limitInputPixels: 16_000_000 })
		.resize(160, 160, { fit: "cover" })
		.png()
		.toBuffer();
	return `data:image/png;base64,${png.toString("base64")}`;
}

async function avatarDataUrl(person?: DirectoryPerson): Promise<string> {
	if (!person) return "";
	const cacheKey = person.image || person.github || "";
	if (!cacheKey) return "";
	const cached = avatarCache.get(cacheKey);
	if (cached) return cached;
	try {
		if (person.image) {
			const mediaUrl = new URL(person.image, "http://local");
			const path = mediaUrl.searchParams.get("path");
			if (path) {
				const data = await compactAvatar(await Bun.file(path).arrayBuffer());
				rememberAvatar(cacheKey, data);
				return data;
			}
		}
		if (person.github) {
			const response = await fetch(`https://github.com/${encodeURIComponent(person.github)}.png?size=160`, {
				signal: AbortSignal.timeout(5_000),
			});
			if (response.ok) {
				const data = await compactAvatar(await response.arrayBuffer());
				rememberAvatar(cacheKey, data);
				return data;
			}
		}
	} catch {}
	return "";
}

function pillWidth(value: string): number {
	return Math.min(270, Math.max(92, value.length * 10 + 38));
}

function pillLabel(value: string): string {
	return value.length > 24 ? `${value.slice(0, 23).trimEnd()}…` : value;
}

/** SVG source is exported so the visual can be inspected without PNG decoding. */
export function sessionSocialCardSvg(
	data: SessionSocialCardData,
	avatar = "",
): string {
	const titleLines = socialCardTitleLines(data.title);
	const subtitle = clean(data.sessionTitle);
	const repo = clean(data.repo);
	const model = clean(data.model);
	const mode = clean(data.mode);
	const pills = [repo, model, mode && `${mode[0].toUpperCase()}${mode.slice(1)}`]
		.filter(Boolean)
		.map(pillLabel);
	let pillX = 142;
	const pillMarkup = pills
		.map((label) => {
			const width = pillWidth(label);
			const item = `<g transform="translate(${pillX} 548)"><rect width="${width}" height="38" rx="19" fill="#FFFFFF" fill-opacity="0.72"/><text x="19" y="25" fill="#48474C" font-size="16" font-weight="560">${xml(label)}</text></g>`;
			pillX += width + 10;
			return item;
		})
		.join("");
	const avatarMarkup = avatar
		? `<image href="${avatar}" x="72" y="528" width="58" height="58" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>`
		: `<rect x="72" y="528" width="58" height="58" rx="29" fill="#232228"/><text x="101" y="565" text-anchor="middle" fill="#FFFFFF" font-size="19" font-weight="650">${xml(initials(data.owner))}</text>`;
	const titleMarkup = titleLines
		.map(
			(line, index) =>
				`<text x="72" y="${index === 0 ? 291 : 369}" fill="#1E1D22" font-size="70" font-weight="620" letter-spacing="-2.5">${xml(line)}</text>`,
		)
		.join("");
	const subtitleY = titleLines.length > 1 ? 418 : 340;

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SESSION_CARD_WIDTH}" height="${SESSION_CARD_HEIGHT}" viewBox="0 0 ${SESSION_CARD_WIDTH} ${SESSION_CARD_HEIGHT}" font-family="Inter, Arial, sans-serif">
<defs>
  <linearGradient id="bg" x1="70" y1="36" x2="1115" y2="612" gradientUnits="userSpaceOnUse">
    <stop stop-color="#F8F7F4"/>
    <stop offset="0.54" stop-color="#F4F2ED"/>
    <stop offset="1" stop-color="#ECEAE5"/>
  </linearGradient>
  <linearGradient id="openSessionVector" x1="742" y1="86" x2="1180" y2="552" gradientUnits="userSpaceOnUse">
    <stop stop-color="#7664FF" stop-opacity="0.70"/>
    <stop offset="0.48" stop-color="#EB74A7" stop-opacity="0.58"/>
    <stop offset="1" stop-color="#FFBE66" stop-opacity="0.30"/>
  </linearGradient>
  <radialGradient id="vectorGlow" cx="0" cy="0" r="1" gradientTransform="translate(964 314) rotate(94) scale(300 330)" gradientUnits="userSpaceOnUse">
    <stop stop-color="#FFFFFF" stop-opacity="0.54"/>
    <stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="markClip"><rect x="758" y="78" width="430" height="474" rx="124"/></clipPath>
  <clipPath id="avatarClip"><circle cx="101" cy="557" r="29"/></clipPath>
</defs>
<rect width="1200" height="630" fill="url(#bg)"/>
<g clip-path="url(#markClip)">
  <rect x="758" y="78" width="430" height="474" fill="url(#openSessionVector)"/>
  <path d="M758 78H973C892 132 881 196 925 246C971 297 1014 319 1001 392C990 456 947 508 897 552H758V78Z" fill="#FFFFFF" fill-opacity="0.42"/>
  <path d="M1188 78H976C1049 133 1052 188 1011 235C971 281 928 313 944 383C959 448 1009 508 1054 552H1188V78Z" fill="#292631" fill-opacity="0.16"/>
  <rect x="758" y="78" width="430" height="474" fill="url(#vectorGlow)"/>
</g>
<g transform="translate(72 60)">
  <rect width="42" height="42" rx="12" fill="#232228"/>
  <path d="M8 8H21C16 12 15 17 18 21C21 24 25 26 24 31C23 34 21 36 18 38H8V8Z" fill="#FFFFFF"/>
  <text x="58" y="29" fill="#232228" font-size="22" font-weight="620" letter-spacing="-0.5">${xml(productName())}</text>
</g>
${titleMarkup}
${subtitle ? `<text x="74" y="${subtitleY}" fill="#6E6C73" font-size="25" font-weight="450">${xml(subtitle)}</text>` : ""}
${avatarMarkup}
<text x="142" y="517" fill="#706E75" font-size="15" font-weight="540" letter-spacing="1.1">STARTED BY ${xml(data.owner.toUpperCase())}</text>
${pillMarkup}
</svg>`;
}

export async function renderSessionSocialCard(
	data: SessionSocialCardData,
): Promise<Buffer> {
	const avatar = await avatarDataUrl(data.person);
	return sharp(Buffer.from(sessionSocialCardSvg(data, avatar))).png().toBuffer();
}

function publicBase(): string {
	const media = configuredIntegration("media").publicBaseUrl;
	return (
		process.env.OPENSESSION_SESSION_CARD_BASE ||
		(typeof media === "string" ? media : configuredServer().publicBaseUrl)
	).replace(/\/+$/, "");
}

export function sessionSocialCardUrl(sessionId: string): string {
	return `${publicBase()}/session-card/${encodeURIComponent(sessionId)}/${cardToken(sessionId)}.png`;
}

let cachedCardSecret = "";

function cardSecret(): string {
	const configured = process.env.OPENSESSION_SESSION_CARD_SECRET?.trim();
	if (configured) return configured;
	if (cachedCardSecret) return cachedCardSecret;
	const path = stateDir("social-card-secret");
	try {
		const stored = readFileSync(path, "utf8").trim();
		if (stored.length >= 32) return (cachedCardSecret = stored);
	} catch {}
	const created = randomBytes(32).toString("hex");
	writeFileSync(path, `${created}\n`, { mode: 0o600 });
	try {
		chmodSync(path, 0o600);
	} catch {}
	return (cachedCardSecret = created);
}

function cardToken(sessionId: string): string {
	return createHmac("sha256", cardSecret())
		.update(`session-social-card:${sessionId}`)
		.digest("base64url")
		.slice(0, 32);
}

function validCardToken(sessionId: string, token: string): boolean {
	const expected = Buffer.from(cardToken(sessionId));
	const presented = Buffer.from(token);
	return (
		expected.length === presented.length && timingSafeEqual(expected, presented)
	);
}

function socialDescription(data: SessionSocialCardData): string {
	return [data.sessionTitle, data.owner, data.repo, data.model].filter(Boolean).join(" · ");
}

function replaceMeta(htmlSource: string, key: string, value: string): string {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`(<meta\\s+(?:property|name)="${escaped}"\\s+content=")[^"]*("\\s*/?>)`);
	return htmlSource.replace(pattern, `$1${html(value)}$2`);
}

export function sessionHtmlWithSocialMeta(
	htmlSource: string,
	session: UnifiedSession,
	pathname: string,
): string {
	const data = sessionSocialCardData(session);
	const image = sessionSocialCardUrl(session.id);
	const page = `${configuredServer().publicBaseUrl.replace(/\/+$/, "")}${pathname}`;
	const documentTitle = `${data.title} · ${productName()}`;
	let output = htmlSource.replace(/<title>[^<]*<\/title>/, `<title>${html(documentTitle)}</title>`);
	output = replaceMeta(output, "og:title", data.title);
	output = replaceMeta(output, "og:image", image);
	output = replaceMeta(output, "twitter:card", "summary_large_image");
	output = replaceMeta(output, "twitter:title", data.title);
	output = replaceMeta(output, "twitter:image", image);
	const description = socialDescription(data);
	const extra = `
  <meta property="og:description" content="${html(description)}" />
  <meta property="og:url" content="${html(page)}" />
  <meta property="og:image:width" content="${SESSION_CARD_WIDTH}" />
  <meta property="og:image:height" content="${SESSION_CARD_HEIGHT}" />
  <meta property="og:image:alt" content="${html(`${data.title}, an Open Session by ${data.owner}`)}" />
  <meta name="twitter:description" content="${html(description)}" />
  <meta name="twitter:image:alt" content="${html(`${data.title}, an Open Session by ${data.owner}`)}" />`;
	return output.replace(/(<meta property="og:type"[^>]*>)/, `$1${extra}`);
}

export function socialSessionIdFromPath(pathname: string): string | null {
	const match =
		pathname.match(/^\/session\/([^/?#]+)/) ||
		pathname.match(/^\/workspace\/[^/?#]+\/session\/([^/?#]+)/);
	if (!match) return null;
	try {
		return decodeURIComponent(match[1]);
	} catch {
		return null;
	}
}

const cardCache = new Map<string, { fingerprint: string; bytes: Buffer; at: number }>();
const CARD_CACHE_MS = 60_000;
const CARD_CACHE_LIMIT = 100;

function rememberCard(
	sessionId: string,
	entry: { fingerprint: string; bytes: Buffer; at: number },
): void {
	cardCache.delete(sessionId);
	cardCache.set(sessionId, entry);
	if (cardCache.size <= CARD_CACHE_LIMIT) return;
	const oldest = cardCache.keys().next().value;
	if (oldest) cardCache.delete(oldest);
}

export function sessionSocialCardPublicRoutes(): Map<
	string,
	(req: Request, url: URL) => Promise<Response>
> {
	const routes = new Map<string, (req: Request, url: URL) => Promise<Response>>();
	routes.set("GET /session-card/*", async (_req, url) => {
		const match = url.pathname.match(
			/^\/session-card\/([^/]{1,600})\/([A-Za-z0-9_-]{32})\.png$/,
		);
		if (!match) return Response.json({ error: "Not found" }, { status: 404 });
		let sessionId: string;
		try {
			sessionId = decodeURIComponent(match[1]);
		} catch {
			return Response.json({ error: "Not found" }, { status: 404 });
		}
		if (!validCardToken(sessionId, match[2]))
			return Response.json({ error: "Not found" }, { status: 404 });
		const session = await findSessionAsync(sessionId);
		if (!session) return Response.json({ error: "Not found" }, { status: 404 });
		const data = sessionSocialCardData(session);
		const fingerprint = JSON.stringify(data, (key, value) => (key === "person" ? data.person?.image || data.person?.github : value));
		const cached = cardCache.get(session.id);
		const now = Date.now();
		let bytes: Buffer;
		if (cached && cached.fingerprint === fingerprint && now - cached.at < CARD_CACHE_MS) {
			bytes = cached.bytes;
		} else {
			bytes = await renderSessionSocialCard(data);
			rememberCard(session.id, { fingerprint, bytes, at: now });
		}
		return new Response(bytes.slice().buffer as ArrayBuffer, {
			headers: {
				"Content-Type": "image/png",
				"Cache-Control": "public, max-age=60, stale-while-revalidate=300",
				"X-Content-Type-Options": "nosniff",
				"X-Robots-Tag": "noindex",
			},
		});
	});
	return routes;
}
