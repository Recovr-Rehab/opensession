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
 * Only session-owned media is used, and only at thumbnail size.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
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
 * card uses. This height keeps the title centered while letting a 16:9
 * screenshot fill most of the card.
 */
export const SESSION_CARD_BANNER_WIDTH = 1200;
export const SESSION_CARD_BANNER_HEIGHT = 320;
/**
 * Without a screenshot the banner shrinks to its own content instead of
 * holding a screenshot's worth of empty paper next to the title.
 */
const BANNER_COMPACT_PAD_Y = 34;
/**
 * A compact card is also cropped to its own content width. Slack lays every
 * image out at the message column width, so the crop is what removes the empty
 * paper: a narrower source with the same content fills the column instead of
 * floating in the left third of it. It rasterizes at 2x so the upscale to the
 * column stays sharp.
 */
const BANNER_COMPACT_MIN_WIDTH = 520;
/** Slack commonly shows the banner on a 2x display. */
const BANNER_RENDER_SCALE = 2;

export type SessionCardVariant = "card" | "banner";
const SESSION_CARD_VERSION = 22;

const CARD_INK = "#050609";
const CARD_PAPER = "#FFFFFF";
/** Left margin. */
const PAD_X = 56;
const TITLE_SIZE = 38;
const TITLE_LINE_HEIGHT = 42;
const TITLE_FONT = "Inter SemiBold 38";
const TITLE_LETTER_SPACING = -1024;
/** Every screenshot frame stays 16:9, including the ones behind the lead shot. */
const SHOT_BANNER_WIDTH = 528;
const SHOT_BANNER_HEIGHT = 297;
const SHOT_CARD_WIDTH = 576;
const SHOT_CARD_HEIGHT = 324;
const SHOT_BANNER_INSET = 10;
const SHOT_CARD_INSET = 24;
const SHOT_BANNER_RADIUS = 26;
const SHOT_CARD_RADIUS = 28;
const SHOT_GAP = 32;
const SHOT_LIMIT = 2;
/** Keep fallback candidates so an unusable first image does not hide a good one. */
const SHOT_CANDIDATE_LIMIT = 12;
/** Anything wider than a 16:9 capture with a small tolerance crops poorly. */
const SHOT_MAX_ASPECT = 16 / 9 + 0.02;
const SHOT_BANNER_STACK_OFFSET = 80;
const SHOT_CARD_STACK_OFFSET = 92;
const SHOT_BANNER_STACK_LIFT = 10;
const SHOT_CARD_STACK_LIFT = 12;

export interface SessionSocialCardData {
	title: string;
	owner: string;
	repo?: string;
	/** Strongest session screenshot candidates first. The renderer keeps two. */
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
const DATA_SHOT_RE = /^data:image\/(?:png|jpe?g|webp|gif);base64,/i;

function dataShotBytes(source: string): Buffer | undefined {
	if (!DATA_SHOT_RE.test(source)) return undefined;
	const encoded = source.slice(source.indexOf(",") + 1);
	if (!encoded || Math.ceil((encoded.length * 3) / 4) > SHOT_MAX_BYTES)
		return undefined;
	try {
		const bytes = Buffer.from(encoded, "base64");
		return bytes.length > 0 && bytes.length <= SHOT_MAX_BYTES
			? bytes
			: undefined;
	} catch {
		return undefined;
	}
}

function usableShot(source: string): boolean {
	if (!source) return false;
	if (source.startsWith("data:")) {
		if (!DATA_SHOT_RE.test(source)) return false;
		const encodedBytes = Math.ceil(
			(source.length - source.indexOf(",") - 1) * 0.75,
		);
		return encodedBytes > 0 && encodedBytes <= SHOT_MAX_BYTES;
	}
	if (!isWithinUploads(source)) return false;
	if (!/\.(png|jpe?g|webp|gif)$/i.test(source)) return false;
	try {
		const stat = statSync(source);
		return stat.isFile() && stat.size > 0 && stat.size <= SHOT_MAX_BYTES;
	} catch {
		return false;
	}
}

/** Resolve one transcript image without widening the card route into a general
 * file reader. Composer uploads and transcript-owned data images are eligible. */
function transcriptShot(src: string): string | undefined {
	const staged = stagedImageRef(src);
	if (staged && usableShot(staged.path)) return staged.path;
	return usableShot(src) ? src : undefined;
}

/** Add eligible images from the requested entry order without duplicates. */
function appendEntryShots(
	sessionId: string,
	entries: TranscriptEntry[],
	field: "images" | "featuredMedia",
	append: (source: string | undefined) => boolean,
): void {
	const store = transcriptStore();
	for (const entry of entries) {
		// Bounded transcript rows replace large data images with os-blob markers.
		// Hydrate that one row so chat screenshots remain available to the card.
		const needsFull =
			entry.images?.some((src) => src.startsWith("os-blob:")) ||
			entry.featuredMedia?.some((src) => src.startsWith("os-blob:"));
		const source = needsFull ? store.getFullEntry(sessionId, entry.id) ?? entry : entry;
		for (const src of [...(source[field] ?? [])].reverse()) {
			if (!append(transcriptShot(src))) return;
		}
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
	const append = (source: string | undefined): boolean => {
		if (paths.length >= SHOT_CANDIDATE_LIMIT) return false;
		if (!source || seen.has(source) || !usableShot(source)) return true;
		seen.add(source);
		paths.push(source);
		return paths.length < SHOT_CANDIDATE_LIMIT;
	};
	const walkthroughShots = session.walkthrough?.shots ?? [];
	for (const shot of walkthroughShots) append(shot.after);
	for (const shot of walkthroughShots) append(shot.before);
	if (paths.length >= SHOT_CANDIDATE_LIMIT) return paths;

	try {
		const store = transcriptStore();
		const tail = store.readTail(session.id, SHOT_SCAN_ENTRIES);
		const newestFirst = [...tail.entries].reverse();
		appendEntryShots(session.id, newestFirst, "featuredMedia", append);
		appendEntryShots(
			session.id,
			newestFirst.filter((entry) => entry.type === "user"),
			"images",
			append,
		);

		if (paths.length < SHOT_CANDIDATE_LIMIT && tail.firstSeq > 1) {
			const opening = store.readRange(
				session.id,
				1,
				Number.MAX_SAFE_INTEGER,
				0,
				SHOT_SCAN_ENTRIES,
			);
			appendEntryShots(
				session.id,
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

interface PreparedShot {
	dataUrl: string;
}

/** Preserve landscape screenshots inside the 16:9 frame. Portrait captures use
 * a salience crop instead of a fixed top sliver, so their relevant UI stays large. */
async function prepareShot(
	source: string | undefined,
	width: number,
	height: number,
): Promise<PreparedShot | undefined> {
	if (!source) return undefined;
	try {
		const sharp = await loadSharp();
		if (!sharp) return undefined;
		const input = dataShotBytes(source) ?? source;
		const image = sharp(input, { limitInputPixels: 40_000_000 });
		const metadata = await image.metadata();
		if (!metadata.width || !metadata.height) return undefined;
		const swapsAxes = [5, 6, 7, 8].includes(metadata.orientation ?? 1);
		const orientedWidth = swapsAxes ? metadata.height : metadata.width;
		const orientedHeight = swapsAxes ? metadata.width : metadata.height;
		const aspect = orientedWidth / orientedHeight;
		// Card renders and message-column captures are usually ultra-wide. Putting
		// one back inside the card creates the recursive, unreadable preview.
		if (aspect > SHOT_MAX_ASPECT) return undefined;
		const portrait = aspect < 1;
		const png = await image
			.rotate()
			.resize(width, height, {
				fit: portrait ? "cover" : "contain",
				position: portrait ? "attention" : "centre",
				background: { r: 246, g: 246, b: 248, alpha: 1 },
			})
			.png()
			.toBuffer();
		return {
			dataUrl: `data:image/png;base64,${png.toString("base64")}`,
		};
	} catch {
		return undefined;
	}
}

async function shotDataUrls(
	paths: string[] | undefined,
	width: number,
	height: number,
): Promise<string[]> {
	const shots: PreparedShot[] = [];
	for (const source of (paths ?? []).slice(0, SHOT_CANDIDATE_LIMIT)) {
		const shot = await prepareShot(source, width, height);
		if (shot) shots.push(shot);
		if (shots.length >= SHOT_LIMIT) break;
	}
	// Keep source priority intact. A deliberate walkthrough image should not lose
	// to a less relevant chat image merely because the latter is landscape.
	return shots.map((shot) => shot.dataUrl);
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

/**
 * A squircle: the superellipse corner the UI wears through
 * `corner-shape: squircle`, baked into a path because this rasterizes through
 * librsvg, which has no such property. An `rx` rounded rect beside the app's
 * real tiles reads as the wrong shape even at preview size. Sampled along the
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
	displayTitle: string | string[] = clean(data.title) || productName(),
	variant: SessionCardVariant = "card",
	shots: string[] = [],
	/** Measured width of the widest content row, for the compact crop. */
	contentWidth?: number,
): string {
	const banner = variant === "banner";
	const titleLines = (Array.isArray(displayTitle)
		? displayTitle
		: [displayTitle]
	)
		.map(clean)
		.filter(Boolean)
		.slice(0, 2);
	if (!titleLines.length) titleLines.push(productName());
	const contentHeight = titleLines.length * TITLE_LINE_HEIGHT;
	const compact = banner && !shots.length;
	const height = compact
		? contentHeight + BANNER_COMPACT_PAD_Y * 2
		: banner
			? SESSION_CARD_BANNER_HEIGHT
			: SESSION_CARD_HEIGHT;
	const width = compact
		? Math.min(
				SESSION_CARD_WIDTH,
				Math.max(
					BANNER_COMPACT_MIN_WIDTH,
					Math.round(contentWidth ?? 0) + PAD_X * 2,
				),
			)
		: SESSION_CARD_WIDTH;
	const blockTop = (height - contentHeight) / 2;
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
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" overflow="hidden" font-family="Inter, Arial, sans-serif">
<defs>
${shotDefs}
  <filter id="shotShadow" x="-26%" y="-34%" width="152%" height="178%" color-interpolation-filters="sRGB">
    <feDropShadow in="SourceAlpha" dx="0" dy="18" stdDeviation="22" flood-color="#000000" flood-opacity="0.16" result="ambient"/>
    <feDropShadow in="SourceAlpha" dx="0" dy="6" stdDeviation="7" flood-color="#000000" flood-opacity="0.12" result="lift"/>
    <feDropShadow in="SourceAlpha" dx="0" dy="1" stdDeviation="1.5" flood-color="#000000" flood-opacity="0.1" result="contact"/>
    <feMerge><feMergeNode in="ambient"/><feMergeNode in="lift"/><feMergeNode in="contact"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>
<rect width="${width}" height="${height}" fill="${CARD_PAPER}"/>
${shotMarkup}
${titleMarkup}
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
	const renderScale = variant === "banner" ? BANNER_RENDER_SCALE : 1;
	const shots = await shotDataUrls(
		data.shots,
		shotWidth(variant) * renderScale,
		shotHeight(variant) * renderScale,
	);
	// Missing or unreadable images give their space back to the title instead
	// of leaving an unexplained blank where the stack would have been.
	const title = await fitSocialCardTitle(
		data.title,
		titleMeasure(
			shots.length ? { ...data, shots } : { ...data, shots: undefined },
			variant,
		),
	);
	// A card with no screenshot is cropped to what it actually holds, so measure
	// the title rather than leaving it in a 1200px band of paper.
	const compact = variant === "banner" && !shots.length;
	const rowWidths = compact
		? await Promise.all(title.map((line) => titleWidth(sharp, line)))
		: [];
	const svg = sessionSocialCardSvg(
		data,
		title,
		variant,
		shots,
		rowWidths.length ? Math.max(...rowWidths) : undefined,
	);
	return sharp(
		Buffer.from(svg),
		// The complete Slack banner lands at 2x, including embedded screenshots.
		// Rendering only the outer SVG at 2x would still upscale a 1x data image.
		renderScale > 1 ? { density: 72 * renderScale } : undefined,
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
  <meta property="og:image:alt" content="${html(`${data.title}, Open Session preview`)}" />
  <meta name="twitter:description" content="${html(description)}" />
  <meta name="twitter:image:alt" content="${html(`${data.title}, Open Session preview`)}" />`;
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

function shotFingerprint(source: string): string {
	if (source.startsWith("data:"))
		return createHash("sha256").update(source).digest("base64url");
	try {
		const stat = statSync(source);
		return `${source}:${stat.size}:${stat.mtimeMs}`;
	} catch {
		return `${source}:missing`;
	}
}

function cardFingerprint(data: SessionSocialCardData): string {
	return JSON.stringify({
		...data,
		shots: data.shots?.map(shotFingerprint),
	});
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
		const cacheKey = `${SESSION_CARD_VERSION}:${session.id}@${variant}`;
		const fingerprint = cardFingerprint(data);
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
