/**
 * Dynamic social card for session links.
 *
 * The UI normally lives on a private host, so Slack cannot crawl its Open Graph
 * metadata. The same renderer is therefore available on the public webhook
 * origin and is also linked from the session page for clients that can crawl it.
 *
 * The card can carry a screenshot the session itself produced (a walkthrough
 * shot, or an image someone pasted into the chat). That image is baked into a
 * PNG served from a capability URL, so it travels wherever the link is pasted.
 * Only file-backed session media is used, and only at thumbnail size.
 */

import sharp from "sharp";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { chmodSync, readFileSync, statSync, writeFileSync } from "fs";
import { repoLetter } from "../frontend/lib/repo-label";
import {
	configuredIntegration,
	configuredRepos,
	configuredServer,
	productName,
} from "./config";
import { teamDirectory, type DirectoryPerson } from "./people";
import { stateDir } from "./paths";
import { repoIconRevision, resolveRepoIcon } from "./repo-appearance";
import {
	REPO_TILE_INK,
	assignRepoTileColors,
	repoTileColor,
} from "./repo-tile-colors";
import { findSessionAsync } from "./session-cache";
import { transcriptStore } from "./transcript-store";
import { isWithinUploads, stagedImageRef } from "./uploads";
import type { TranscriptEntry, UnifiedSession } from "./types";

export const SESSION_CARD_WIDTH = 1200;
export const SESSION_CARD_HEIGHT = 630;
/**
 * Banner variant, for Slack. A Block Kit `image` block is always laid out at
 * the message column width, so the only thing that decides how much of the
 * conversation the card eats is its aspect ratio. Two lines are all the card
 * carries, so it is sized to two lines: a taller banner only adds blank
 * paper to every message that quotes a session.
 */
export const SESSION_CARD_BANNER_WIDTH = 1200;
export const SESSION_CARD_BANNER_HEIGHT = 200;

export type SessionCardVariant = "card" | "banner";
const SESSION_CARD_VERSION = 8;

const CARD_INK = "#050609";
const CARD_PAPER = "#FFFFFF";
/** Left margin. */
const PAD_X = 56;
/**
 * The repo tile in front of the title. It matches the title's point size, so it
 * reads as an inline mark instead of a block the words sit beside. The generous
 * superellipse radius keeps the tiny tile distinct from a rounded rectangle.
 */
const TILE_SIZE = 48;
const TILE_GAP = 16;
const TILE_RADIUS = TILE_SIZE * 0.46;
/** The owner row starts under the title, with the avatar beside the name. */
const META_SIZE = 28;
const META_GAP = 14;
const META_TEXT_SIZE = 24;
const META_LABEL_GAP = 8;
const META_GLYPH_SIZE = 22;
const META_RADIUS = META_SIZE * 0.46;
const META_OPACITY = 0.52;
const TITLE_SIZE = 48;
const TITLE_X = PAD_X + TILE_SIZE + TILE_GAP;
const TITLE_MAX_WIDTH = SESSION_CARD_WIDTH - TITLE_X - PAD_X;
const TITLE_FONT = "Inter SemiBold 48";
const TITLE_LETTER_SPACING = Math.round(-1.2 * 1024);
/** An inset screenshot gives the white card a clear visual without covering it. */
const SHOT_BANNER_WIDTH = 360;
const SHOT_CARD_WIDTH = 430;
const SHOT_BANNER_INSET = 20;
const SHOT_CARD_INSET = 28;
const SHOT_BANNER_RADIUS = 24;
const SHOT_CARD_RADIUS = 32;
const SHOT_GAP = 28;

export interface SessionSocialCardData {
	title: string;
	owner: string;
	repo?: string;
	person?: DirectoryPerson;
	/** Absolute path to a screenshot this session produced, when it has one. */
	shot?: string;
}

function shotWidth(variant: SessionCardVariant): number {
	return variant === "banner" ? SHOT_BANNER_WIDTH : SHOT_CARD_WIDTH;
}

function shotInset(variant: SessionCardVariant): number {
	return variant === "banner" ? SHOT_BANNER_INSET : SHOT_CARD_INSET;
}

function shotRadius(variant: SessionCardVariant): number {
	return variant === "banner" ? SHOT_BANNER_RADIUS : SHOT_CARD_RADIUS;
}

function shotHeight(variant: SessionCardVariant): number {
	const cardHeight =
		variant === "banner" ? SESSION_CARD_BANNER_HEIGHT : SESSION_CARD_HEIGHT;
	return cardHeight - shotInset(variant) * 2;
}

/** How much room one line of title has, which the screenshot takes from. */
function titleMeasure(
	data: SessionSocialCardData,
	variant: SessionCardVariant,
): number {
	const left = clean(data.repo) ? TITLE_X : PAD_X;
	const right = data.shot
		? SESSION_CARD_WIDTH -
			shotWidth(variant) -
			shotInset(variant) -
			SHOT_GAP
		: SESSION_CARD_WIDTH - PAD_X;
	return right - left;
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
): { title: string } {
	const sessionTitle = clean(session.title) || session.id;
	return { title: sessionTitle };
}

export function sessionSocialCardData(
	session: UnifiedSession,
	options: { includeShot?: boolean } = {},
): SessionSocialCardData {
	const heading = sessionCardTitle(session);
	const ownerRef = clean(session.createdBy || session.startedBy) || productName();
	const person = teamDirectory().find((candidate) => samePerson(candidate, ownerRef));
	const shot = options.includeShot ? sessionShotPath(session) : undefined;
	return {
		title: heading.title,
		owner: person?.fullName || ownerRef,
		...(session.repo ? { repo: session.repo } : {}),
		...(person ? { person } : {}),
		...(shot ? { shot } : {}),
	};
}

const SHOT_MAX_BYTES = 24 * 1024 * 1024;
const SHOT_SCAN_ENTRIES = 60;

/**
 * Only staged session media is eligible: a walkthrough shot or an image
 * someone attached in the chat, both of which live under the uploads dir. The
 * card travels on a capability URL, so a path an agent merely printed is not
 * enough to put a file on it.
 */
function usableShot(path: string): boolean {
	if (!path || !isWithinUploads(path)) return false;
	if (!/\.(png|jpe?g|webp|gif)$/i.test(path)) return false;
	try {
		const { size } = statSync(path);
		return size > 0 && size <= SHOT_MAX_BYTES;
	} catch {
		return false;
	}
}

/** Resolve one transcript image without widening the card route into a file
 * reader. Composer uploads are the only chat media eligible for the card. */
function uploadedShot(src: string): string | undefined {
	const staged = stagedImageRef(src);
	return staged && usableShot(staged.path) ? staged.path : undefined;
}

/** Return the first eligible image from the requested entry order. */
function entryShot(
	entries: TranscriptEntry[],
	field: "images" | "featuredMedia",
): string | undefined {
	for (const entry of entries) {
		for (const src of [...(entry[field] ?? [])].reverse()) {
			const path = uploadedShot(src);
			if (path) return path;
		}
	}
	return undefined;
}

/**
 * Pick the picture that best says what this session is about. A walkthrough is
 * the strongest deliberate summary. Next comes media the agent explicitly
 * featured, then a picture a person attached in the conversation. Ordinary
 * tool attachments are excluded because a file the agent merely read is not a
 * useful or intentional social preview.
 */
function sessionShotPath(session: UnifiedSession): string | undefined {
	for (const shot of session.walkthrough?.shots ?? []) {
		for (const candidate of [shot.after, shot.before])
			if (candidate && usableShot(candidate)) return candidate;
	}
	try {
		const store = transcriptStore();
		const tail = store.readTail(session.id, SHOT_SCAN_ENTRIES);
		const newestFirst = [...tail.entries].reverse();
		const featured = entryShot(newestFirst, "featuredMedia");
		if (featured) return featured;

		const recentUser = entryShot(
			newestFirst.filter((entry) => entry.type === "user"),
			"images",
		);
		if (recentUser) return recentUser;

		if (tail.firstSeq > 1) {
			const opening = store.readRange(
				session.id,
				1,
				Number.MAX_SAFE_INTEGER,
				0,
				SHOT_SCAN_ENTRIES,
			);
			return entryShot(
				opening.entries.filter((entry) => entry.type === "user"),
				"images",
			);
		}
	} catch {
		// No transcript for this session yet, or the store is unavailable.
	}
	return undefined;
}

/** The screenshot, cropped to the panel. Top-anchored: a screenshot says what
 *  it is in its first band, and centring it usually crops that away. */
async function shotDataUrl(
	path: string | undefined,
	width: number,
	height: number,
): Promise<string> {
	if (!path) return "";
	try {
		const png = await sharp(path, { limitInputPixels: 40_000_000 })
			.resize(width, height, { fit: "cover", position: "top" })
			.png()
			.toBuffer();
		return `data:image/png;base64,${png.toString("base64")}`;
	} catch {
		return "";
	}
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

async function titleWidth(title: string): Promise<number> {
	const metadata = await sharp({
		text: {
			text: `<span letter_spacing="${TITLE_LETTER_SPACING}">${xml(title)}</span>`,
			font: TITLE_FONT,
			rgba: true,
			dpi: 72,
		},
	}).metadata();
	return metadata.width ?? 0;
}

/** Fit one 48 px Inter Semi Bold line inside the measure left of the tile. */
export async function fitSocialCardTitle(
	title: string,
	maxWidth: number = TITLE_MAX_WIDTH,
): Promise<string> {
	const value = clean(title) || productName();
	if ((await titleWidth(value)) <= maxWidth) return value;

	const characters = Array.from(value);
	let low = 1;
	let high = characters.length - 1;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		const candidate = `${characters.slice(0, middle).join("").trimEnd()}...`;
		if ((await titleWidth(candidate)) <= maxWidth) low = middle;
		else high = middle - 1;
	}
	return `${characters.slice(0, low).join("").trimEnd()}...`;
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

function metaLabel(value: string): string {
	return value.length > 28 ? `${value.slice(0, 27).trimEnd()}…` : value;
}

/**
 * A repo's own art, tile-sized, or "" when it wears a letter instead. Same two
 * sources the /repo-icon route serves, in the same order: a generic
 * `<id>-icon.png` shipped with the frontend, then whatever the repo's config
 * points at. Keyed on the stored art's revision so an icon changed from
 * Settings shows up on the next card rather than after a restart.
 */
async function repoIconDataUrl(repoId?: string): Promise<string> {
	if (!repoId) return "";
	const repo = configuredRepos()[repoId];
	const configured = resolveRepoIcon(repo?.icon, repo?.repo);
	const cacheKey = `repo:${repoId}:${configured ?? ""}:${repoIconRevision(configured) ?? 0}`;
	const cached = avatarCache.get(cacheKey);
	if (cached !== undefined) return cached;
	const sources: Array<string | URL> = [];
	if (/^[a-z0-9][a-z0-9_-]{0,40}$/i.test(repoId))
		sources.push(new URL(`../frontend/${repoId}-icon.png`, import.meta.url));
	if (configured) sources.push(configured);
	for (const source of sources) {
		try {
			const file = Bun.file(source);
			if (!(await file.exists())) continue;
			const data = await compactAvatar(await file.arrayBuffer());
			rememberAvatar(cacheKey, data);
			return data;
		} catch {}
	}
	rememberAvatar(cacheKey, "");
	return "";
}

/**
 * The tile color the rest of the app assigned this repo, so the card's tile is
 * the one the sidebar and the phone already show rather than a third opinion.
 */
function repoTileColorFor(id: string): string {
	const repos = configuredRepos();
	if (!repos[id]) return repoTileColor(id);
	const chosen: Record<string, string> = {};
	for (const [key, repo] of Object.entries(repos)) {
		const color = (repo as { color?: string }).color;
		if (color) chosen[key] = color;
	}
	return (
		assignRepoTileColors(Object.keys(repos), chosen)[id] ?? repoTileColor(id)
	);
}

/**
 * A squircle: the superellipse corner the UI wears through
 * `corner-shape: squircle`, baked into a path because this rasterizes through
 * librsvg, which has no such property. An `rx` rounded rect beside the app's
 * real tiles reads as the wrong shape, and at 72 px it is obvious. Sampled
 * along the curve rather than approximated with beziers, so the corner is the
 * actual superellipse at any size.
 */
function squircleRectPath(
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
	exponent = 4,
	steps = 20,
): string {
	const r = Math.min(radius, width / 2, height / 2);
	const power = 2 / exponent;
	const corner = (
		cx: number,
		cy: number,
		sx: number,
		sy: number,
		reverse: boolean,
	): string => {
		let path = "";
		for (let i = 0; i <= steps; i++) {
			const t = ((reverse ? steps - i : i) / steps) * (Math.PI / 2);
			const px = cx + sx * r * Math.cos(t) ** power;
			const py = cy + sy * r * Math.sin(t) ** power;
			path += `L${px.toFixed(2)} ${py.toFixed(2)}`;
		}
		return path;
	};
	return [
		`M${(x + r).toFixed(2)} ${y.toFixed(2)}`,
		`L${(x + width - r).toFixed(2)} ${y.toFixed(2)}`,
		corner(x + width - r, y + r, 1, -1, true),
		corner(x + width - r, y + height - r, 1, 1, false),
		corner(x + r, y + height - r, -1, 1, true),
		corner(x + r, y + r, -1, -1, false),
		"Z",
	].join("");
}

function squirclePath(
	x: number,
	y: number,
	size: number,
	radius = size * 0.32,
): string {
	return squircleRectPath(x, y, size, size, radius);
}

/** A person outline for sessions without a directory avatar. */
function metaGlyph(x: number, cy: number): string {
	const scale = META_GLYPH_SIZE / 24;
	const transform = `translate(${x.toFixed(2)} ${(cy - META_GLYPH_SIZE / 2).toFixed(2)}) scale(${scale.toFixed(4)})`;
	const stroke = `fill="none" stroke="${CARD_INK}" stroke-opacity="${META_OPACITY}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"`;
	return `<g transform="${transform}"><circle cx="12" cy="7.6" r="3.7" ${stroke}/><path d="M4.7 20.1c0-4.1 3.3-6.5 7.3-6.5s7.3 2.4 7.3 6.5" ${stroke}/></g>`;
}

/** SVG source is exported so the visual can be inspected without PNG decoding. */
export function sessionSocialCardSvg(
	data: SessionSocialCardData,
	avatar = "",
	displayTitle = clean(data.title) || productName(),
	variant: SessionCardVariant = "card",
	repoIcon = "",
	shot = "",
): string {
	const banner = variant === "banner";
	const height = banner ? SESSION_CARD_BANNER_HEIGHT : SESSION_CARD_HEIGHT;
	const blockTop = Math.round((height - (TILE_SIZE + META_GAP + META_SIZE)) / 2);
	const tileCenter = blockTop + TILE_SIZE / 2;
	const metaTop = blockTop + TILE_SIZE + META_GAP;
	const metaCenter = metaTop + META_SIZE / 2;
	const repoId = clean(data.repo);
	const owner = metaLabel(clean(data.owner));
	const tile = squirclePath(PAD_X, blockTop, TILE_SIZE, TILE_RADIUS);
	const tileColor = repoId ? repoTileColorFor(repoId) : CARD_INK;
	const hasTile = !!(repoIcon || repoId);
	const titleX = hasTile ? TITLE_X : PAD_X;
	// The owner row begins under the title. Its avatar sits immediately beside
	// the name instead of occupying a detached icon column.
	const metaX = titleX;
	const metaTextX = metaX + META_SIZE + META_LABEL_GAP;
	const avatarTile = squirclePath(metaX, metaTop, META_SIZE, META_RADIUS);
	const shotW = shotWidth(variant);
	const shotH = shotHeight(variant);
	const shotPad = shotInset(variant);
	const shotX = SESSION_CARD_WIDTH - shotW - shotPad;
	const shotY = shotPad;
	const shotShape = squircleRectPath(
		shotX,
		shotY,
		shotW,
		shotH,
		shotRadius(variant),
	);
	const repoMarkup = !hasTile
		? ""
		: repoIcon
			? `<image href="${repoIcon}" x="${PAD_X}" y="${blockTop}" width="${TILE_SIZE}" height="${TILE_SIZE}" preserveAspectRatio="xMidYMid slice" clip-path="url(#repoClip)"/>`
			: `<path d="${tile}" fill="${xml(tileColor)}"/><text x="${PAD_X + TILE_SIZE / 2}" y="${tileCenter + 1}" text-anchor="middle" dominant-baseline="middle" fill="${REPO_TILE_INK}" font-size="24" font-weight="600">${xml(repoLetter(repoId))}</text>`;
	const avatarMarkup = avatar
		? `<image href="${avatar}" x="${metaX}" y="${metaTop}" width="${META_SIZE}" height="${META_SIZE}" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>`
		: metaGlyph(metaX + (META_SIZE - META_GLYPH_SIZE) / 2, metaCenter);
	const shotMarkup = shot
		? `<g clip-path="url(#shotClip)"><image href="${shot}" x="${shotX}" y="${shotY}" width="${shotW}" height="${shotH}" preserveAspectRatio="xMidYMin slice"/></g><path d="${shotShape}" fill="none" stroke="${CARD_INK}" stroke-opacity="0.1"/>`
		: "";

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SESSION_CARD_WIDTH}" height="${height}" viewBox="0 0 ${SESSION_CARD_WIDTH} ${height}" font-family="Inter, Arial, sans-serif">
<defs>
  <clipPath id="shotClip"><path d="${shotShape}"/></clipPath>
  <clipPath id="repoClip"><path d="${tile}"/></clipPath>
  <clipPath id="avatarClip"><path d="${avatarTile}"/></clipPath>
</defs>
<rect width="1200" height="${height}" fill="${CARD_PAPER}"/>
${shotMarkup}
${repoMarkup}
${hasTile ? `<path d="${tile}" fill="none" stroke="${CARD_INK}" stroke-opacity="0.1"/>` : ""}
<text x="${titleX}" y="${tileCenter + 2}" dominant-baseline="middle" fill="${CARD_INK}" font-size="${TITLE_SIZE}" font-weight="600" letter-spacing="-1.2">${xml(displayTitle)}</text>
${avatarMarkup}
${avatar ? `<path d="${avatarTile}" fill="none" stroke="${CARD_INK}" stroke-opacity="0.1"/>` : ""}
<text x="${metaTextX}" y="${metaCenter + 1}" dominant-baseline="middle" fill="${CARD_INK}" fill-opacity="${META_OPACITY}" font-size="${META_TEXT_SIZE}" font-weight="500">${xml(owner)}</text>
</svg>`;
}

export async function renderSessionSocialCard(
	data: SessionSocialCardData,
	variant: SessionCardVariant = "card",
): Promise<Buffer> {
	const [avatar, repoIcon, shot] = await Promise.all([
		avatarDataUrl(data.person),
		repoIconDataUrl(data.repo),
		shotDataUrl(data.shot, shotWidth(variant), shotHeight(variant)),
	]);
	// A missing or unreadable image falls back to the full title measure rather
	// than leaving an unexplained blank where its panel would have been.
	const title = await fitSocialCardTitle(
		data.title,
		titleMeasure(shot ? data : { ...data, shot: undefined }, variant),
	);
	return sharp(
		Buffer.from(
			sessionSocialCardSvg(data, avatar, title, variant, repoIcon, shot),
		),
	)
		.png()
		.toBuffer();
}

function publicBase(): string {
	const media = configuredIntegration("media").publicBaseUrl;
	return (
		process.env.OPENSESSION_SESSION_CARD_BASE ||
		(typeof media === "string" ? media : configuredServer().publicBaseUrl)
	).replace(/\/+$/, "");
}

export function sessionSocialCardUrl(
	sessionId: string,
	variant: SessionCardVariant = "card",
): string {
	const shape = variant === "banner" ? "&s=banner" : "";
	return `${publicBase()}/session-card/${encodeURIComponent(sessionId)}/${cardToken(sessionId)}.png?v=${SESSION_CARD_VERSION}${shape}`;
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
	return [data.owner, data.repo].filter(Boolean).join(" · ");
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
	cacheKey: string,
	entry: { fingerprint: string; bytes: Buffer; at: number },
): void {
	cardCache.delete(cacheKey);
	cardCache.set(cacheKey, entry);
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
		const data = sessionSocialCardData(session, { includeShot: true });
		// Only the one named shape is honoured, so a crafted `s` cannot ask us to
		// rasterize an arbitrary geometry.
		const variant: SessionCardVariant =
			url.searchParams.get("s") === "banner" ? "banner" : "card";
		const cacheKey = `${session.id}@${variant}`;
		const fingerprint = JSON.stringify(data, (key, value) => (key === "person" ? data.person?.image || data.person?.github : value));
		const cached = cardCache.get(cacheKey);
		const now = Date.now();
		let bytes: Buffer;
		if (cached && cached.fingerprint === fingerprint && now - cached.at < CARD_CACHE_MS) {
			bytes = cached.bytes;
		} else {
			bytes = await renderSessionSocialCard(data, variant);
			rememberCard(cacheKey, { fingerprint, bytes, at: now });
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
