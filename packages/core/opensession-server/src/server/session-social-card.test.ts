import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import sharp from "sharp";
import type { UnifiedSession } from "./types";

const scratch = mkdtempSync(join(tmpdir(), "opensession-social-card-"));
const previousStateDir = process.env.OPENSESSION_STATE_DIR;
const previousUiBase = process.env.OPENSESSION_UI_BASE;
const previousCardBase = process.env.OPENSESSION_SESSION_CARD_BASE;
const previousCardSecret = process.env.OPENSESSION_SESSION_CARD_SECRET;
process.env.OPENSESSION_STATE_DIR = scratch;
process.env.OPENSESSION_UI_BASE = "https://os.example.test";
process.env.OPENSESSION_SESSION_CARD_BASE = "https://media.example.test";
process.env.OPENSESSION_SESSION_CARD_SECRET = "test-session-social-card-secret-32-bytes";

const {
	renderSessionSocialCard,
	sessionHtmlWithSocialMeta,
	sessionSocialCardData,
	sessionSocialCardPublicRoutes,
	sessionSocialCardSvg,
	sessionSocialCardUrl,
	fitSocialCardTitle,
	socialSessionIdFromPath,
} = await import("./session-social-card");
const { invalidateSessionsCache } = await import("./session-cache");
const { transcriptStore } = await import("./transcript-store");

const signedRouteSessionId = "slack-C123-1719860000.000000";
const sessionsDir = join(scratch, ".opensession-sessions");
const uploadsDir = join(sessionsDir, "uploads", "social-card-tests");
mkdirSync(uploadsDir, { recursive: true });
const imageBytes = await sharp({
	create: {
		width: 640,
		height: 360,
		channels: 4,
		background: "#92b8d9",
	},
})
	.png()
	.toBuffer();
function testImage(name: string): string {
	const path = join(uploadsDir, name);
	writeFileSync(path, imageBytes);
	return path;
}
function mediaRef(path: string): string {
	return `/media?path=${encodeURIComponent(path)}`;
}
writeFileSync(
	join(sessionsDir, `${signedRouteSessionId}.json`),
	JSON.stringify({
		id: signedRouteSessionId,
		claudeSessionId: null,
		title: "Signed Slack social card",
		createdBy: "Test Person",
		createdAt: "2026-08-18T12:00:00Z",
		lastActivity: "2026-08-18T12:00:00Z",
		mode: "ask",
	}),
);
invalidateSessionsCache();

afterAll(() => {
	if (previousStateDir === undefined) delete process.env.OPENSESSION_STATE_DIR;
	else process.env.OPENSESSION_STATE_DIR = previousStateDir;
	if (previousUiBase === undefined) delete process.env.OPENSESSION_UI_BASE;
	else process.env.OPENSESSION_UI_BASE = previousUiBase;
	if (previousCardBase === undefined)
		delete process.env.OPENSESSION_SESSION_CARD_BASE;
	else process.env.OPENSESSION_SESSION_CARD_BASE = previousCardBase;
	if (previousCardSecret === undefined)
		delete process.env.OPENSESSION_SESSION_CARD_SECRET;
	else process.env.OPENSESSION_SESSION_CARD_SECRET = previousCardSecret;
	rmSync(scratch, { recursive: true, force: true });
});

function session(patch: Partial<UnifiedSession> = {}): UnifiedSession {
	return {
		id: "sess-social-1",
		title: "Ship dynamic social cards",
		createdBy: "Test Person",
		startedBy: "Test",
		model: "pi/openai/gpt-5.6-sol",
		repo: "opensession",
		mode: "code",
		lastActivity: "2026-08-18T12:00:00Z",
		...patch,
	} as UnifiedSession;
}

describe("session social card", () => {
	test("normalizes only the session fields shown on the card", () => {
		const data = sessionSocialCardData(session());
		expect(data).toMatchObject({
			title: "Ship dynamic social cards",
			owner: "Test Person",
			repo: "opensession",
		});
		expect(data).not.toHaveProperty("model");
		expect(data).not.toHaveProperty("accent");
	});

	test("stacks walkthrough, featured, then person-attached screenshots", () => {
		const opening = testImage("opening.png");
		const featured = testImage("featured.png");
		const walkthrough = testImage("walkthrough.png");
		const sessionId = "sess-social-shot-priority";
		transcriptStore().appendTranscriptEvents(sessionId, [
			{
				id: "opening",
				type: "user",
				content: "Please fix this",
				timestamp: "2026-08-18T12:00:00Z",
				images: [mediaRef(opening)],
			},
			{
				id: "featured",
				type: "tool_result",
				content: "Finished preview",
				timestamp: "2026-08-18T12:01:00Z",
				images: [mediaRef(featured)],
				featuredMedia: [mediaRef(featured)],
			},
		]);

		expect(
			sessionSocialCardData(session({ id: sessionId }), { includeShot: true })
				.shots,
		).toEqual([featured, opening]);
		expect(
			sessionSocialCardData(
				session({
					id: sessionId,
					walkthrough: {
						summary: "A clearer session card.",
						publishedAt: "2026-08-18T12:02:00Z",
						shots: [{ after: walkthrough }],
					},
				}),
				{ includeShot: true },
			).shots,
		).toEqual([walkthrough, featured]);

		const personOnlyId = "sess-social-person-shot";
		transcriptStore().appendTranscriptEvents(personOnlyId, [
			{
				id: "person-shot",
				type: "user",
				content: "This screenshot explains the task",
				timestamp: "2026-08-18T12:00:00Z",
				images: [mediaRef(opening)],
			},
			{
				id: "ordinary-tool-image",
				type: "tool_result",
				content: "A file the agent merely read",
				timestamp: "2026-08-18T12:01:00Z",
				images: [mediaRef(featured)],
			},
		]);
		expect(
			sessionSocialCardData(session({ id: personOnlyId }), {
				includeShot: true,
			}).shots,
		).toEqual([opening]);
	});

	test("balances the title across at most two lines before truncating", async () => {
		const fitting = "Make Open Session links feel alive";
		expect(await fitSocialCardTitle(fitting)).toEqual([fitting]);

		const wrappedTitle = "Make every shared Open Session easier to recognize";
		const wrapped = await fitSocialCardTitle(wrappedTitle, 720);
		expect(wrapped).toHaveLength(2);
		expect(wrapped.join(" ")).toBe(wrappedTitle);

		const truncated = await fitSocialCardTitle("W".repeat(160), 520);
		expect(truncated).toHaveLength(2);
		expect(truncated[1].endsWith("...")).toBe(true);
		expect(truncated.join("").length).toBeLessThan(160);
	});

	test("matches the card geometry and escapes dynamic text", () => {
		const svg = sessionSocialCardSvg({
			title: "Fix <cards> & links",
			owner: 'Test "Person"',
			repo: "opensession",
		});
		expect(svg).toContain('<rect width="1200" height="630" fill="#FFFFFF"/>');
		expect(svg).not.toContain("aurora");
		expect(svg).not.toContain("shotFade");
		expect(svg).toContain('fill="#050609" font-size="44"');
		// The title owns the left edge. The repo moves into metadata with a tile
		// exactly the same size and squircle geometry as the owner avatar.
		expect(svg).toContain('<clipPath id="repoClip"><path d="M');
		expect(svg).toContain('<text x="56"');
		expect(svg).toContain(">O</text>");
		expect(svg).toContain(">opensession</text>");
		expect(svg).toContain('fill-opacity="0.52"');
		expect(svg).toContain('<circle cx="12" cy="7.6" r="3.7"');
		expect(svg).not.toContain("gpt-5.6-sol");
		expect(svg).not.toContain("M12 3.1L13.7 9.5");
		expect(svg).toContain("Fix &lt;cards&gt; &amp; links");
		expect(svg).not.toContain("Fix <cards>");
	});

	test("places matching owner and repo squircles below a two-line title", () => {
		const svg = sessionSocialCardSvg(
			{
				title: "A visual session with a useful second line",
				owner: "Test Person",
				repo: "opensession",
			},
			"data:image/png;base64,avatar",
			["A visual session with", "a useful second line"],
			"banner",
		);
		expect(svg).toContain('<text x="56" y="42"');
		expect(svg).toContain('<text x="56" y="90"');
		expect(svg).toContain(
			'<image href="data:image/png;base64,avatar" x="56" y="122" width="28" height="28"',
		);
		expect(svg).toContain(
			'<text x="92" y="137" dominant-baseline="middle"',
		);
		expect(svg).toContain(
			'<text x="92" y="169" dominant-baseline="middle"',
		);
		expect(svg).toMatch(
			/<clipPath id="avatarClip"><path d="M68\.88 122\.00L/,
		);
		expect(svg).toMatch(
			/<clipPath id="repoClip"><path d="M68\.88 154\.00L/,
		);
	});

	test("overlaps up to two rounded 16:9 screenshots", () => {
		const svg = sessionSocialCardSvg(
			{
				title: "A visual session",
				owner: "Test Person",
				repo: "opensession",
			},
			"",
			["A visual session"],
			"banner",
			"",
			[
				"data:image/png;base64,primary",
				"data:image/png;base64,secondary",
				"data:image/png;base64,ignored",
			],
		);
		expect(svg).toContain(
			'<image href="data:image/png;base64,primary" x="882" y="14.5" width="304" height="171"',
		);
		expect(svg).toContain(
			'<image href="data:image/png;base64,secondary" x="810" y="22.5" width="304" height="171"',
		);
		expect(svg).not.toContain("ignored");
		expect(svg).toContain(
			'<clipPath id="shotClip1"><path d="M832.00 22.50L1092.00 22.50',
		);
		expect(svg).toContain('filter="url(#shotShadow)"');
		expect(304 / 171).toBe(16 / 9);
		expect(svg).not.toContain("gradient");
	});

	test("renders a 1200 by 630 PNG", async () => {
		const png = await renderSessionSocialCard(sessionSocialCardData(session()));
		const metadata = await sharp(png).metadata();
		expect(metadata.format).toBe("png");
		expect(metadata.width).toBe(1200);
		expect(metadata.height).toBe(630);
	});

	test("injects large-image metadata into the session HTML", () => {
		const source = `<head>
<title>Open Session</title>
<meta property="og:type" content="website" />
<meta property="og:title" content="Open Session" />
<meta property="og:image" content="/icon.png" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="Open Session" />
<meta name="twitter:image" content="/icon.png" />
</head>`;
		const output = sessionHtmlWithSocialMeta(
			source,
			session(),
			"/session/sess-social-1",
		);
		expect(output).toContain("<title>Ship dynamic social cards · Open Session</title>");
		expect(output).toContain('content="summary_large_image"');
		expect(output).toMatch(
			/content="https:\/\/media\.example\.test\/session-card\/sess-social-1\/[A-Za-z0-9_-]{32}\.png\?v=10"/,
		);
		expect(output).toContain(
			'property="og:url" content="https://os.example.test/session/sess-social-1"',
		);
	});

	test("parses both session link shapes", () => {
		expect(socialSessionIdFromPath("/session/sess-social-1")).toBe("sess-social-1");
		expect(
			socialSessionIdFromPath("/workspace/ws-1/session/sess-social-1"),
		).toBe("sess-social-1");
		expect(socialSessionIdFromPath("/settings")).toBeNull();
		expect(sessionSocialCardUrl("sess-social-1")).toMatch(
			/^https:\/\/media\.example\.test\/session-card\/sess-social-1\/[A-Za-z0-9_-]{32}\.png\?v=10$/,
		);
	});

	test("signs ids containing Slack timestamp dots", () => {
		expect(sessionSocialCardUrl("slack-C123-1719860000.000000")).toMatch(
			/^https:\/\/media\.example\.test\/session-card\/slack-C123-1719860000\.000000\/[A-Za-z0-9_-]{32}\.png\?v=10$/,
		);
	});

	test("public image routes reject malformed capability paths", async () => {
		const route = sessionSocialCardPublicRoutes().get("GET /session-card/*");
		expect(route).toBeDefined();
		const response = await route!(
			new Request("https://media.example.test/session-card/not-valid.svg"),
			new URL("https://media.example.test/session-card/not-valid.svg"),
		);
		expect(response.status).toBe(404);
	});

	test("serves a signed Slack-style session id", async () => {
		const route = sessionSocialCardPublicRoutes().get("GET /session-card/*")!;
		const url = new URL(sessionSocialCardUrl(signedRouteSessionId));
		const response = await route(new Request(url), url);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("image/png");
		const metadata = await sharp(await response.arrayBuffer()).metadata();
		expect(metadata.width).toBe(1200);
		expect(metadata.height).toBe(630);
	});

	test("serves the banner variant at full width, two lines tall", async () => {
		const route = sessionSocialCardPublicRoutes().get("GET /session-card/*")!;
		const url = new URL(sessionSocialCardUrl(signedRouteSessionId, "banner"));
		expect(url.searchParams.get("s")).toBe("banner");
		const response = await route(new Request(url), url);
		expect(response.status).toBe(200);
		const metadata = await sharp(await response.arrayBuffer()).metadata();
		expect(metadata.width).toBe(1200);
		expect(metadata.height).toBe(200);
	});

	test("renders the full card for an unrecognized shape", async () => {
		const route = sessionSocialCardPublicRoutes().get("GET /session-card/*")!;
		const url = new URL(`${sessionSocialCardUrl(signedRouteSessionId)}&s=tall`);
		const response = await route(new Request(url), url);
		expect(response.status).toBe(200);
		const metadata = await sharp(await response.arrayBuffer()).metadata();
		expect(metadata.width).toBe(1200);
		expect(metadata.height).toBe(630);
	});

	test("rejects an invalid HMAC before resolving the session", async () => {
		const route = sessionSocialCardPublicRoutes().get("GET /session-card/*")!;
		const valid = new URL(sessionSocialCardUrl(signedRouteSessionId));
		const invalid = new URL(
			valid.href.replace(
				/[A-Za-z0-9_-]{32}\.png(?=\?)/,
				`${"A".repeat(32)}.png`,
			),
		);
		const response = await route(new Request(invalid), invalid);
		expect(response.status).toBe(404);
	});
});
