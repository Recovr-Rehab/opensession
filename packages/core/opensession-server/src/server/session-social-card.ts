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
import { repoLetter } from "../frontend/lib/repo-label";
import {
	DEFAULT_ACCENT_THEME,
	getAccentThemeOption,
	isAccentTheme,
} from "../shared/accent-theme";
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
import type { UnifiedSession } from "./types";
import { getUiPrefs } from "./ui-prefs";

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
const SESSION_CARD_VERSION = 6;

/**
 * The card is ink, not paper: the product mark is a near-black square with a
 * white glyph, so a session link wearing the same value reads as ours at
 * thumbnail size, which is the only size Slack ever shows it at. Sampled off
 * icon.png rather than picked by eye.
 */
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
/** The metadata line: a glyph and its label, twice over. */
const META_SIZE = 28;
const META_GAP = 20;
const META_TEXT_SIZE = 24;
const META_LABEL_GAP = 12;
const META_GROUP_GAP = 26;
const META_GLYPH_SIZE = 22;
const META_TEXT_X = PAD_X + META_SIZE + META_LABEL_GAP;
const META_FONT = "Inter Medium 24";
const META_OPACITY = 0.55;
const TITLE_SIZE = 48;
const TITLE_X = PAD_X + TILE_SIZE + TILE_GAP;
const TITLE_MAX_WIDTH = SESSION_CARD_WIDTH - TITLE_X - PAD_X;
const TITLE_FONT = "Inter SemiBold 48";
const TITLE_LETTER_SPACING = Math.round(-1.2 * 1024);

export interface SessionSocialCardData {
	title: string;
	owner: string;
	repo?: string;
	model?: string;
	person?: DirectoryPerson;
	accent: string;
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

function sessionModelLabel(session: UnifiedSession): string | undefined {
	if (!session.model) return undefined;
	return session.model.split("/").filter(Boolean).at(-1);
}

export function sessionSocialCardData(
	session: UnifiedSession,
): SessionSocialCardData {
	const heading = sessionCardTitle(session);
	const ownerRef = clean(session.createdBy || session.startedBy) || productName();
	const person = teamDirectory().find((candidate) => samePerson(candidate, ownerRef));
	const model = sessionModelLabel(session);
	const savedAccent = getUiPrefs(person?.name || ownerRef).accent;
	const accentTheme = isAccentTheme(savedAccent)
		? savedAccent
		: DEFAULT_ACCENT_THEME;
	return {
		title: heading.title,
		owner: person?.fullName || ownerRef,
		...(session.repo ? { repo: session.repo } : {}),
		...(model ? { model } : {}),
		...(person ? { person } : {}),
		accent: getAccentThemeOption(accentTheme).light,
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

/**
 * How wide the owner's name renders, so the model group can sit right after it
 * rather than at a guessed column. Measured through the same rasterizer that
 * draws the card; the SVG keeps a rough estimate as its fallback so it stays
 * callable (and testable) without a render.
 */
async function metaWidth(text: string): Promise<number> {
	if (!text) return 0;
	const metadata = await sharp({
		text: { text: xml(text), font: META_FONT, rgba: true, dpi: 72 },
	}).metadata();
	return metadata.width ?? 0;
}

/** Fit one 48 px Inter Semi Bold line inside the measure left of the tile. */
export async function fitSocialCardTitle(title: string): Promise<string> {
	const value = clean(title) || productName();
	if ((await titleWidth(value)) <= TITLE_MAX_WIDTH) return value;

	const characters = Array.from(value);
	let low = 1;
	let high = characters.length - 1;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		const candidate = `${characters.slice(0, middle).join("").trimEnd()}...`;
		if ((await titleWidth(candidate)) <= TITLE_MAX_WIDTH) low = middle;
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
function squirclePath(
	x: number,
	y: number,
	size: number,
	radius = size * 0.32,
	exponent = 4,
	steps = 20,
): string {
	const r = Math.min(radius, size / 2);
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
		`L${(x + size - r).toFixed(2)} ${y.toFixed(2)}`,
		corner(x + size - r, y + r, 1, -1, true),
		corner(x + size - r, y + size - r, 1, 1, false),
		corner(x + r, y + size - r, -1, 1, true),
		corner(x + r, y + r, -1, -1, false),
		"Z",
	].join("");
}

/**
 * A subtext glyph, in the SF Symbols idiom: one stroked outline sitting on the
 * label's own optical centre, at the label's colour and weight.
 *
 * Drawn here rather than shipped from Apple's set, which is licensed for use
 * in apps on Apple platforms and not for a PNG we hand to Slack. The shapes
 * are deliberately the plainest reading of `person` and `sparkle`, so the pair
 * reads as one family beside the name and the model.
 */
function metaGlyph(kind: "person" | "model", x: number, cy: number): string {
	const scale = META_GLYPH_SIZE / 24;
	const transform = `translate(${x.toFixed(2)} ${(cy - META_GLYPH_SIZE / 2).toFixed(2)}) scale(${scale.toFixed(4)})`;
	const stroke = `fill="none" stroke="${CARD_PAPER}" stroke-opacity="${META_OPACITY}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"`;
	const body =
		kind === "person"
			? `<circle cx="12" cy="7.6" r="3.7" ${stroke}/><path d="M4.7 20.1c0-4.1 3.3-6.5 7.3-6.5s7.3 2.4 7.3 6.5" ${stroke}/>`
			: `<path d="M12 3.1L13.7 9.5L20.2 11.3L13.7 13.1L12 19.5L10.3 13.1L3.8 11.3L10.3 9.5Z" fill="${CARD_PAPER}" fill-opacity="${META_OPACITY}"/>`;
	return `<g transform="${transform}">${body}</g>`;
}

/** SVG source is exported so the visual can be inspected without PNG decoding. */
export function sessionSocialCardSvg(
	data: SessionSocialCardData,
	avatar = "",
	jetBrainsMono = "",
	displayTitle = clean(data.title) || productName(),
	variant: SessionCardVariant = "card",
	repoIcon = "",
	ownerWidth = 0,
): string {
	const banner = variant === "banner";
	const height = banner ? SESSION_CARD_BANNER_HEIGHT : SESSION_CARD_HEIGHT;
	// One block, centred on both shapes: the repo tile and the title on the
	// first line, everything else demoted to the second. Nothing is pinned to
	// the bottom edge any more, which is what lets the banner get shorter
	// without opening a hole in the middle of it.
	const blockTop = Math.round((height - (TILE_SIZE + META_GAP + META_SIZE)) / 2);
	const tileCenter = blockTop + TILE_SIZE / 2;
	const metaTop = blockTop + TILE_SIZE + META_GAP;
	const metaCenter = metaTop + META_SIZE / 2;
	// The brand curve is scaled past the card's own height so it crops top and
	// bottom and bleeds off the right edge. Oversized, it reads as a sweep the
	// card was cut out of rather than a shape pasted inside the frame.
	const artScale = (height / SESSION_CARD_HEIGHT) * 1.6;
	const artTransform = `translate(${(SESSION_CARD_WIDTH - 399 * artScale).toFixed(2)} ${((height - SESSION_CARD_HEIGHT * artScale) / 2).toFixed(2)}) scale(${artScale.toFixed(4)})`;
	const accent = xml(data.accent);
	const repoId = clean(data.repo);
	const owner = metaLabel(clean(data.owner));
	const model = metaLabel(clean(data.model));
	const tile = squirclePath(PAD_X, blockTop, TILE_SIZE, TILE_RADIUS);
	const tileColor = repoId ? repoTileColorFor(repoId) : CARD_PAPER;
	const hasTile = !!(repoIcon || repoId);
	const titleX = hasTile ? TITLE_X : PAD_X;
	// Art when the repo has any, the same colored letter the app falls back to
	// when it does not.
	const repoMarkup = !hasTile
		? ""
		: repoIcon
			? `<image href="${repoIcon}" x="${PAD_X}" y="${blockTop}" width="${TILE_SIZE}" height="${TILE_SIZE}" preserveAspectRatio="xMidYMid slice" clip-path="url(#repoClip)"/>`
			: `<path d="${tile}" fill="${xml(tileColor)}"/><path d="${tile}" fill="url(#tileSheen)"/><text x="${PAD_X + TILE_SIZE / 2}" y="${tileCenter + 1}" text-anchor="middle" dominant-baseline="middle" fill="${REPO_TILE_INK}" font-size="24" font-weight="600">${xml(repoLetter(repoId))}</text>`;
	// The person's own face when we have one, the `person` glyph when we do
	// not, so the subtext keeps its shape either way.
	const avatarMarkup = avatar
		? `<image href="${avatar}" x="${PAD_X}" y="${metaTop}" width="${META_SIZE}" height="${META_SIZE}" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>`
		: metaGlyph("person", PAD_X + (META_SIZE - META_GLYPH_SIZE) / 2, metaCenter);
	// Where the model group starts. Measured by the caller through the same
	// rasterizer that draws the card; the estimate keeps this callable without
	// a render (tests, and anyone inspecting the SVG).
	const nameWidth = ownerWidth || owner.length * META_TEXT_SIZE * 0.52;
	const modelX = META_TEXT_X + nameWidth + META_GROUP_GAP;
	const modelMarkup = model
		? `${metaGlyph("model", modelX, metaCenter)}<text x="${(modelX + META_GLYPH_SIZE + META_LABEL_GAP).toFixed(2)}" y="${metaCenter + 1}" dominant-baseline="middle" fill="${CARD_PAPER}" fill-opacity="${META_OPACITY}" font-family="JetBrains Mono, monospace" font-size="${META_TEXT_SIZE}" font-weight="500">${xml(model)}</text>`
		: "";
	const fontFace = jetBrainsMono
		? `<style>@font-face { font-family: 'JetBrains Mono'; font-style: normal; font-weight: 500; src: url('${jetBrainsMono}') format('truetype'); }</style>`
		: "";

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SESSION_CARD_WIDTH}" height="${height}" viewBox="0 0 ${SESSION_CARD_WIDTH} ${height}" font-family="Inter, Arial, sans-serif">
<defs>
  ${fontFace}
  <linearGradient id="artGradient" x1="199.5" y1="0" x2="199.5" y2="630" gradientUnits="userSpaceOnUse">
    <stop stop-color="${accent}" stop-opacity="0.18"/>
    <stop offset="1" stop-color="${accent}" stop-opacity="0.035"/>
  </linearGradient>
  <radialGradient id="aurora" cx="1160" cy="${banner ? -30 : 60}" r="${banner ? 620 : 860}" gradientUnits="userSpaceOnUse">
    <stop stop-color="${accent}" stop-opacity="0.24"/>
    <stop offset="0.5" stop-color="${accent}" stop-opacity="0.055"/>
    <stop offset="1" stop-color="${accent}" stop-opacity="0"/>
  </radialGradient>
  <pattern id="grid" width="26" height="26" patternUnits="userSpaceOnUse">
    <circle cx="1.3" cy="1.3" r="1.3" fill="${CARD_PAPER}" fill-opacity="0.07"/>
  </pattern>
  <linearGradient id="gridFade" x1="0" y1="0" x2="1200" y2="0" gradientUnits="userSpaceOnUse">
    <stop stop-color="#000000"/>
    <stop offset="0.55" stop-color="#000000"/>
    <stop offset="1" stop-color="#FFFFFF"/>
  </linearGradient>
  <mask id="gridMask"><rect width="1200" height="${height}" fill="url(#gridFade)"/></mask>
  <radialGradient id="tileGlow" cx="${PAD_X + TILE_SIZE / 2}" cy="${tileCenter}" r="${TILE_SIZE * 1.7}" gradientUnits="userSpaceOnUse">
    <stop stop-color="${xml(tileColor)}" stop-opacity="0.26"/>
    <stop offset="1" stop-color="${xml(tileColor)}" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="tileSheen" x1="0" y1="${blockTop}" x2="0" y2="${blockTop + TILE_SIZE}" gradientUnits="userSpaceOnUse">
    <stop stop-color="#FFFFFF" stop-opacity="0.14"/>
    <stop offset="1" stop-color="#000000" stop-opacity="0.08"/>
  </linearGradient>
  <clipPath id="repoClip"><path d="${tile}"/></clipPath>
  <clipPath id="avatarClip"><circle cx="${PAD_X + META_SIZE / 2}" cy="${metaCenter}" r="${META_SIZE / 2}"/></clipPath>
</defs>
<rect width="1200" height="${height}" fill="${CARD_INK}"/>
<rect width="1200" height="${height}" fill="url(#aurora)"/>
<rect width="1200" height="${height}" fill="url(#grid)" mask="url(#gridMask)"/>
<g transform="${artTransform}">
  <path d="M68.8375 226.509C-37.3322 147.543 -7.34262 36.0198 68.8375 0H399V630H84.0041C208.443 571.121 289.104 390.338 68.8375 226.509Z" fill="url(#artGradient)"/>
</g>
${hasTile && !repoIcon ? `<circle cx="${PAD_X + TILE_SIZE / 2}" cy="${tileCenter}" r="${TILE_SIZE * 1.7}" fill="url(#tileGlow)"/>` : ""}
${repoMarkup}
${hasTile ? `<path d="${tile}" fill="none" stroke="${CARD_PAPER}" stroke-opacity="0.14"/>` : ""}
<text x="${titleX}" y="${tileCenter + 2}" dominant-baseline="middle" fill="${CARD_PAPER}" font-size="${TITLE_SIZE}" font-weight="600" letter-spacing="-1.2">${xml(displayTitle)}</text>
${avatarMarkup}
<text x="${META_TEXT_X}" y="${metaCenter + 1}" dominant-baseline="middle" fill="${CARD_PAPER}" fill-opacity="${META_OPACITY}" font-size="${META_TEXT_SIZE}" font-weight="500">${xml(owner)}</text>
${modelMarkup}
</svg>`;
}

let jetBrainsMonoDataUrl = "";

async function socialCardMonoFont(): Promise<string> {
	if (jetBrainsMonoDataUrl) return jetBrainsMonoDataUrl;
	const bytes = await Bun.file(
		new URL("./fonts/JetBrainsMono-Medium.ttf", import.meta.url),
	).arrayBuffer();
	jetBrainsMonoDataUrl = `data:font/ttf;base64,${Buffer.from(bytes).toString("base64")}`;
	return jetBrainsMonoDataUrl;
}

export async function renderSessionSocialCard(
	data: SessionSocialCardData,
	variant: SessionCardVariant = "card",
): Promise<Buffer> {
	const [avatar, repoIcon, monoFont, title, ownerWidth] = await Promise.all([
		avatarDataUrl(data.person),
		repoIconDataUrl(data.repo),
		socialCardMonoFont(),
		fitSocialCardTitle(data.title),
		metaWidth(metaLabel(clean(data.owner))),
	]);
	return sharp(
		Buffer.from(
			sessionSocialCardSvg(
				data,
				avatar,
				monoFont,
				title,
				variant,
				repoIcon,
				ownerWidth,
			),
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
	return [data.owner, data.repo, data.model].filter(Boolean).join(" · ");
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
		const data = sessionSocialCardData(session);
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
