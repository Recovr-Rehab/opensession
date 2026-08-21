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

import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { chmodSync, readFileSync, statSync, writeFileSync } from "fs";
import {
	configuredIntegration,
	configuredServer,
	productName,
} from "./config";
import { teamDirectory, type DirectoryPerson } from "./people";
import { stateDir } from "./paths";
import { findSessionAsync } from "./session-cache";
import { transcriptStore } from "./transcript-store";
import { isWithinUploads, stagedImageRef } from "./uploads";
import type { TranscriptEntry, UnifiedSession } from "./types";

/**
 * sharp is loaded lazily and treated as optional. Its platform `@img/sharp-*`
 * native cannot be embedded into a `bun build --compile` executable (it is
 * resolved from the on-disk sidecar at runtime, not bundled), so a top-level
 * import would crash boot where the sidecar is absent. Load it on first use
 * instead: when it (or its native) is missing, the PNG social-card endpoint
 * degrades to a 501 and the Open Graph meta tags still emit, so the server
 * boots and serves the UI either way.
 */
type SharpFactory = typeof import("sharp");
let sharpFactory: SharpFactory | null | undefined; // undefined = not tried yet

async function loadSharp(): Promise<SharpFactory | null> {
	if (sharpFactory !== undefined) return sharpFactory;
	try {
		const mod = await import("sharp");
		sharpFactory = ((mod as { default?: SharpFactory }).default ?? mod) as SharpFactory;
	} catch (e) {
		console.warn(
			"[social-card] sharp unavailable — PNG social cards disabled (Open Graph tags still emit):",
			e instanceof Error ? e.message : e,
		);
		sharpFactory = null;
	}
	return sharpFactory;
}

export const SESSION_CARD_WIDTH = 1200;
export const SESSION_CARD_HEIGHT = 630;
/**
 * Banner variant, for Slack. A Block Kit `image` block is always laid out at
 * the message column width, so its aspect ratio decides how much space the
 * card uses. This height keeps the title and metadata centered while letting
 * a 16:9 screenshot fill most of the card.
 */
export const SESSION_CARD_BANNER_WIDTH = 1200;
export const SESSION_CARD_BANNER_HEIGHT = 280;

export type SessionCardVariant = "card" | "banner";
const SESSION_CARD_VERSION = 18;

const CARD_INK = "#050609";
const CARD_PAPER = "#FFFFFF";
/** Left margin. */
const PAD_X = 56;
const META_SIZE = 28;
const META_TEXT_SIZE = 22;
const META_LABEL_GAP = 10;
const META_GLYPH_SIZE = 22;
const META_RADIUS = META_SIZE * 0.46;
const META_OPACITY = 0.42;
/**
 * Inter's cap height, as a share of the point size. Both labels sit on one
 * baseline placed so this band centers on the icons. `dominant-baseline:
 * middle` centers the font's whole box instead, which puts a name with no
 * descender visibly high while a word carrying a `p` looks right.
 */
const META_CAP_RATIO = 0.727;
/** Whole pixels, so a label's stem lands on the raster grid. */
function capBaselineShift(fontSize: number): number {
	return Math.round((fontSize * META_CAP_RATIO) / 2);
}
const TITLE_META_GAP = 10;
const TITLE_SIZE = 38;
const TITLE_LINE_HEIGHT = 42;
const TITLE_FONT = "Inter SemiBold 38";
const TITLE_LETTER_SPACING = -1024;
/** Every screenshot frame stays 16:9, including the ones behind the lead shot. */
const SHOT_BANNER_WIDTH = 464;
const SHOT_BANNER_HEIGHT = 261;
const SHOT_CARD_WIDTH = 544;
const SHOT_CARD_HEIGHT = 306;
const SHOT_BANNER_INSET = 10;
const SHOT_CARD_INSET = 24;
const SHOT_BANNER_RADIUS = 26;
const SHOT_CARD_RADIUS = 28;
const SHOT_GAP = 32;
const SHOT_LIMIT = 2;
const SHOT_BANNER_STACK_OFFSET = 80;
const SHOT_CARD_STACK_OFFSET = 92;
const SHOT_BANNER_STACK_LIFT = 10;
const SHOT_CARD_STACK_LIFT = 12;

export interface SessionSocialCardData {
	title: string;
	owner: string;
	repo?: string;
	person?: DirectoryPerson;
	/** Strongest session screenshots first, capped to a small visual stack. */
	shots?: string[];
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
	return variant === "banner" ? SHOT_BANNER_HEIGHT : SHOT_CARD_HEIGHT;
}

function shotStackOffset(variant: SessionCardVariant): number {
	return variant === "banner"
		? SHOT_BANNER_STACK_OFFSET
		: SHOT_CARD_STACK_OFFSET;
}

/** How much room each title line has to the left of the screenshot stack. */
function titleMeasure(
	data: SessionSocialCardData,
	variant: SessionCardVariant,
): number {
	const shotCount = Math.min(data.shots?.length ?? 0, SHOT_LIMIT);
	const stackLeft = shotCount
		? SESSION_CARD_WIDTH -
			shotWidth(variant) -
			shotInset(variant) -
			shotStackOffset(variant) * (shotCount - 1)
		: SESSION_CARD_WIDTH - PAD_X;
	return stackLeft - SHOT_GAP - PAD_X;
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
	const shots = options.includeShot ? sessionShotPaths(session) : [];
	return {
		title: heading.title,
		owner: person?.fullName || ownerRef,
		...(session.repo ? { repo: session.repo } : {}),
		...(person ? { person } : {}),
		...(shots.length ? { shots } : {}),
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

/** Add eligible images from the requested entry order without duplicates. */
function appendEntryShots(
	entries: TranscriptEntry[],
	field: "images" | "featuredMedia",
	append: (path: string | undefined) => void,
): void {
	for (const entry of entries) {
		for (const src of [...(entry[field] ?? [])].reverse())
			append(uploadedShot(src));
	}
}

/**
 * Pick the pictures that best say what this session is about. Walkthrough
 * after-shots are the strongest deliberate summaries. Next comes other
 * walkthrough media, media the agent explicitly featured, then pictures a
 * person attached in the conversation. Ordinary tool attachments are excluded
 * because a file the agent merely read is not a useful social preview.
 */
function sessionShotPaths(session: UnifiedSession): string[] {
	const paths: string[] = [];
	const seen = new Set<string>();
	const append = (path: string | undefined): void => {
		if (!path || paths.length >= SHOT_LIMIT || seen.has(path) || !usableShot(path))
			return;
		seen.add(path);
		paths.push(path);
	};
	const walkthroughShots = session.walkthrough?.shots ?? [];
	for (const shot of walkthroughShots) append(shot.after);
	for (const shot of walkthroughShots) append(shot.before);
	if (paths.length >= SHOT_LIMIT) return paths;

	try {
		const store = transcriptStore();
		const tail = store.readTail(session.id, SHOT_SCAN_ENTRIES);
		const newestFirst = [...tail.entries].reverse();
		appendEntryShots(newestFirst, "featuredMedia", append);
		appendEntryShots(
			newestFirst.filter((entry) => entry.type === "user"),
			"images",
			append,
		);

		if (paths.length < SHOT_LIMIT && tail.firstSeq > 1) {
			const opening = store.readRange(
				session.id,
				1,
				Number.MAX_SAFE_INTEGER,
				0,
				SHOT_SCAN_ENTRIES,
			);
			appendEntryShots(
				opening.entries.filter((entry) => entry.type === "user"),
				"images",
				append,
			);
		}
	} catch {
		// No transcript for this session yet, or the store is unavailable.
	}
	return paths;
}

/** A screenshot cropped to a 16:9 frame. Top anchoring preserves app chrome. */
async function shotDataUrl(
	path: string | undefined,
	width: number,
	height: number,
): Promise<string> {
	if (!path) return "";
	try {
		const sharp = await loadSharp();
		if (!sharp) return "";
		const png = await sharp(path, { limitInputPixels: 40_000_000 })
			.resize(width, height, { fit: "cover", position: "top" })
			.png()
			.toBuffer();
		return `data:image/png;base64,${png.toString("base64")}`;
	} catch {
		return "";
	}
}

async function shotDataUrls(
	paths: string[] | undefined,
	width: number,
	height: number,
): Promise<string[]> {
	const results = await Promise.all(
		(paths ?? []).slice(0, SHOT_LIMIT).map((path) =>
			shotDataUrl(path, width, height),
		),
	);
	return results.filter(Boolean);
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

async function titleWidth(sharp: SharpFactory, title: string): Promise<number> {
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

async function truncateTitleLine(
	sharp: SharpFactory,
	value: string,
	maxWidth: number,
): Promise<string> {
	if ((await titleWidth(sharp, value)) <= maxWidth) return value;
	const characters = Array.from(value);
	let low = 1;
	let high = characters.length - 1;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		const candidate = `${characters.slice(0, middle).join("").trimEnd()}...`;
		if ((await titleWidth(sharp, candidate)) <= maxWidth) low = middle;
		else high = middle - 1;
	}
	return `${characters.slice(0, low).join("").trimEnd()}...`;
}

/** Fit the title into at most two balanced 42px lines. */
export async function fitSocialCardTitle(
	title: string,
	maxWidth: number = SESSION_CARD_WIDTH - PAD_X * 2,
): Promise<string[]> {
	const value = clean(title) || productName();
	const sharp = await loadSharp();
	if (!sharp) return [value];
	const measure = Math.max(80, maxWidth);
	if ((await titleWidth(sharp, value)) <= measure) return [value];

	const boundaries = Array.from(value.matchAll(/\s+/g), (match) => match.index!);
	const measured = new Map<
		number,
		{ first: string; second: string; firstWidth: number; secondWidth: number }
	>();
	const at = async (index: number) => {
		const cached = measured.get(index);
		if (cached) return cached;
		const split = boundaries[index];
		const first = value.slice(0, split).trim();
		const second = value.slice(split).trim();
		const [firstWidth, secondWidth] = await Promise.all([
			titleWidth(sharp, first),
			titleWidth(sharp, second),
		]);
		const result = { first, second, firstWidth, secondWidth };
		measured.set(index, result);
		return result;
	};

	if (boundaries.length) {
		let low = 0;
		let high = boundaries.length - 1;
		while (low < high) {
			const middle = Math.floor((low + high) / 2);
			if ((await at(middle)).secondWidth <= measure) high = middle;
			else low = middle + 1;
		}
		const firstValid = low;
		low = firstValid;
		high = boundaries.length - 1;
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			if ((await at(middle)).firstWidth <= measure) low = middle;
			else high = middle - 1;
		}
		const lastValid = low;
		const firstEdge = await at(firstValid);
		const lastEdge = await at(lastValid);
		if (
			firstValid <= lastValid &&
			firstEdge.secondWidth <= measure &&
			firstEdge.firstWidth <= measure &&
			lastEdge.firstWidth <= measure
		) {
			low = firstValid;
			high = lastValid;
			while (low < high) {
				const middle = Math.floor((low + high) / 2);
				const candidate = await at(middle);
				if (candidate.firstWidth >= candidate.secondWidth) high = middle;
				else low = middle + 1;
			}
			const candidates = [low - 1, low]
				.filter((index) => index >= firstValid && index <= lastValid);
			let best = await at(candidates[0]);
			for (const index of candidates.slice(1)) {
				const candidate = await at(index);
				if (
					Math.abs(candidate.firstWidth - candidate.secondWidth) <
					Math.abs(best.firstWidth - best.secondWidth)
				)
					best = candidate;
			}
			return [best.first, best.second];
		}
	}

	// A long unbroken word, or a title too long for two complete lines. Fill the
	// first line, prefer a nearby word boundary, then ellipsize only line two.
	const characters = Array.from(value);
	let low = 1;
	let high = characters.length - 1;
	while (low < high) {
		const middle = Math.ceil((low + high) / 2);
		if ((await titleWidth(sharp, characters.slice(0, middle).join(""))) <= measure)
			low = middle;
		else high = middle - 1;
	}
	let split = low;
	const wordBreak = value.lastIndexOf(" ", split);
	if (wordBreak >= Math.floor(split * 0.6)) split = wordBreak;
	const first = value.slice(0, split).trim();
	const second = await truncateTitleLine(sharp, value.slice(split).trim(), measure);
	return [first, second];
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
	const sharp = await loadSharp();
	if (!sharp) return `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`;
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
 * A squircle: the superellipse corner the UI wears through
 * `corner-shape: squircle`, baked into a path because this rasterizes through
 * librsvg, which has no such property. An `rx` rounded rect beside the app's
 * real tiles reads as the wrong shape even at metadata size. Sampled along the
 * curve rather than approximated with beziers, so the corner is the actual
 * superellipse at any size.
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

interface ShotFrame {
	index: number;
	x: number;
	y: number;
	width: number;
	height: number;
	rotation: number;
	pivotX: number;
	pivotY: number;
	shape: string;
}

function shotFrames(
	variant: SessionCardVariant,
	count: number,
	height: number,
): ShotFrame[] {
	const frameCount = Math.min(count, SHOT_LIMIT);
	const width = shotWidth(variant);
	const frameHeight = shotHeight(variant);
	const frontX = SESSION_CARD_WIDTH - width - shotInset(variant);
	const stacked = frameCount > 1;
	const bottomCrop = variant === "banner" ? 14 : 20;
	const frontY = stacked
		? height - frameHeight + bottomCrop
		: (height - frameHeight) / 2;
	const offsetX = shotStackOffset(variant);
	const lift =
		variant === "banner" ? SHOT_BANNER_STACK_LIFT : SHOT_CARD_STACK_LIFT;
	return Array.from({ length: frameCount }, (_, index) => {
		const x = frontX - offsetX * index;
		const y = frontY + (index === 0 ? 0 : lift);
		const rotation = stacked ? (index === 0 ? 2 : -5) : 0;
		return {
			index,
			x,
			y,
			width,
			height: frameHeight,
			rotation,
			pivotX: x + width / 2,
			pivotY: y + frameHeight,
			shape: squircleRectPath(
				x,
				y,
				width,
				frameHeight,
				shotRadius(variant),
			),
		};
	});
}

/** SVG source is exported so the visual can be inspected without PNG decoding. */
export function sessionSocialCardSvg(
	data: SessionSocialCardData,
	avatar = "",
	displayTitle: string | string[] = clean(data.title) || productName(),
	variant: SessionCardVariant = "card",
	shots: string[] = [],
): string {
	const banner = variant === "banner";
	const height = banner ? SESSION_CARD_BANNER_HEIGHT : SESSION_CARD_HEIGHT;
	const titleLines = (Array.isArray(displayTitle)
		? displayTitle
		: [displayTitle]
	)
		.map(clean)
		.filter(Boolean)
		.slice(0, 2);
	if (!titleLines.length) titleLines.push(productName());
	const owner = metaLabel(clean(data.owner));
	const metadataHeight = META_SIZE;
	const contentHeight =
		titleLines.length * TITLE_LINE_HEIGHT + TITLE_META_GAP + metadataHeight;
	const blockTop = (height - contentHeight) / 2;
	const metaTop =
		blockTop + titleLines.length * TITLE_LINE_HEIGHT + TITLE_META_GAP;
	const metaCenter = metaTop + META_SIZE / 2;
	const ownerTextX = PAD_X + META_SIZE + META_LABEL_GAP;
	const metaTextY = metaCenter + capBaselineShift(META_TEXT_SIZE);
	const avatarTile = squirclePath(PAD_X, metaTop, META_SIZE, META_RADIUS);
	const frames = shotFrames(variant, shots.length, height);
	const shotDefs = frames
		.map(
			(frame) =>
				`  <clipPath id="shotClip${frame.index}" clipPathUnits="userSpaceOnUse"><path d="${frame.shape}"/></clipPath>`,
		)
		.join("\n");
	const shotMarkup = [...frames]
		.reverse()
		.map((frame) => {
			const shot = shots[frame.index];
			const transform = frame.rotation
				? ` transform="rotate(${frame.rotation} ${frame.pivotX} ${frame.pivotY})"`
				: "";
			return `<g${transform}><path d="${frame.shape}" fill="${CARD_PAPER}" filter="url(#shotShadow)"/>
<g clip-path="url(#shotClip${frame.index})"><image href="${shot}" x="${frame.x}" y="${frame.y}" width="${frame.width}" height="${frame.height}" preserveAspectRatio="xMidYMin slice"/></g>
<path d="${frame.shape}" fill="none" stroke="#000000" stroke-opacity="0.1"/></g>`;
		})
		.join("\n");
	const titleMarkup = titleLines
		.map(
			(line, index) =>
				`<text x="${PAD_X}" y="${blockTop + index * TITLE_LINE_HEIGHT + TITLE_LINE_HEIGHT / 2}" dominant-baseline="middle" fill="${CARD_INK}" font-size="${TITLE_SIZE}" font-weight="600" letter-spacing="-1.1">${xml(line)}</text>`,
		)
		.join("\n");
	const avatarGlyph = metaGlyph(
		PAD_X + (META_SIZE - META_GLYPH_SIZE) / 2,
		metaCenter,
	);
	// No white ring: it would inset the picture by half its width and make the
	// avatar read smaller than its 28px frame.
	const avatarMarkup = avatar
		? `<image href="${avatar}" x="${PAD_X}" y="${metaTop}" width="${META_SIZE}" height="${META_SIZE}" preserveAspectRatio="xMidYMid slice" clip-path="url(#avatarClip)"/>
<path d="${avatarTile}" fill="none" stroke="#000000" stroke-opacity="0.1"/>`
		: `<path d="${avatarTile}" fill="${CARD_PAPER}"/>
${avatarGlyph}
<path d="${avatarTile}" fill="none" stroke="#000000" stroke-opacity="0.1"/>`;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${SESSION_CARD_WIDTH}" height="${height}" viewBox="0 0 ${SESSION_CARD_WIDTH} ${height}" overflow="hidden" font-family="Inter, Arial, sans-serif">
<defs>
${shotDefs}
  <clipPath id="avatarClip" clipPathUnits="userSpaceOnUse"><path d="${avatarTile}"/></clipPath>
  <filter id="shotShadow" x="-22%" y="-28%" width="144%" height="164%" color-interpolation-filters="sRGB">
    <feDropShadow in="SourceAlpha" dx="0" dy="11" stdDeviation="13" flood-color="#000000" flood-opacity="0.13" result="ambient"/>
    <feDropShadow in="SourceAlpha" dx="0" dy="4" stdDeviation="4.5" flood-color="#000000" flood-opacity="0.1" result="lift"/>
    <feDropShadow in="SourceAlpha" dx="0" dy="1" stdDeviation="1" flood-color="#000000" flood-opacity="0.08" result="contact"/>
    <feMerge><feMergeNode in="ambient"/><feMergeNode in="lift"/><feMergeNode in="contact"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>
<rect width="1200" height="${height}" fill="${CARD_PAPER}"/>
${shotMarkup}
${titleMarkup}
${avatarMarkup}
<text x="${ownerTextX}" y="${metaTextY}" fill="${CARD_INK}" fill-opacity="${META_OPACITY}" font-size="${META_TEXT_SIZE}" font-weight="500">${xml(owner)}</text>
</svg>`;
}

export async function renderSessionSocialCard(
	data: SessionSocialCardData,
	variant: SessionCardVariant = "card",
): Promise<Buffer | null> {
	// Null when sharp is unavailable: the route answers 501, while metadata
	// and the rest of the compiled server remain available.
	const sharp = await loadSharp();
	if (!sharp) return null;
	const [avatar, shots] = await Promise.all([
		avatarDataUrl(data.person),
		shotDataUrls(data.shots, shotWidth(variant), shotHeight(variant)),
	]);
	// Missing or unreadable images give their space back to the title instead
	// of leaving an unexplained blank where the stack would have been.
	const title = await fitSocialCardTitle(
		data.title,
		titleMeasure(
			shots.length ? { ...data, shots } : { ...data, shots: undefined },
			variant,
		),
	);
	return sharp(
		Buffer.from(sessionSocialCardSvg(data, avatar, title, variant, shots)),
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
			const rendered = await renderSessionSocialCard(data, variant);
			if (!rendered)
				return Response.json(
					{ error: "Social card rendering unavailable (sharp not installed)" },
					{ status: 501 },
				);
			bytes = rendered;
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
