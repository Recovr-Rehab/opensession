import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionCardBody, WsCardBody } from "./HoverCards";
import type { WsCardRow } from "../../lib/sidebar-hover";
import type { UnifiedSession } from "../../lib/types";

// `bun test` runs every file in one process, so a `window` may already be
// installed by whichever file ran first (@opentui/core's stub, a sibling
// shim) — and a readonly one, which a plain assignment throws on. Fill in
// what this file needs instead of replacing it.
Object.assign(
	((globalThis as unknown as { window?: Record<string, unknown> }).window ??= {}),
	{ addEventListener: () => {}, matchMedia: () => ({ matches: false }) },
);

const AGO = new Date(Date.now() - 8 * 60_000).toISOString();

function session(extra: Partial<UnifiedSession> = {}): UnifiedSession {
	return {
		id: "os-test",
		title: "Modernize UI design",
		repo: "opensession",
		lastActivity: AGO,
		...extra,
	} as unknown as UnifiedSession;
}

function row(sessions: UnifiedSession[]): WsCardRow {
	return {
		key: "ws-test",
		workspace: null,
		name: "Modernize UI design",
		sessions,
		status: "pending",
		lastActivity: AGO,
		running: false,
	};
}

// The card answers "what is this, and what does it need?". The repo is the
// band the row is already filed under, and an idle "updated 8m ago" is a fact
// the Info tab carries exactly — neither changes what you do next, and on a
// 300px card they were the first and last thing you read.
describe("hover cards drop the repo and the idle timestamp", () => {
	test("the session card leads with neither the repo nor a timestamp", () => {
		const html = renderToStaticMarkup(
			<SessionCardBody session={session()} />,
		);
		expect(html).toContain("Modernize UI design");
		expect(html).not.toContain("opensession");
		expect(html).not.toContain("Updated");
	});

	test("the workspace card leads with neither the repo nor a timestamp", () => {
		const html = renderToStaticMarkup(
			<WsCardBody row={row([session()])} onArchive={() => {}} onOpen={() => {}} />,
		);
		expect(html).toContain("Modernize UI design");
		expect(html).not.toContain("opensession");
		expect(html).not.toContain("Updated");
	});

	test("a card with nothing left to show ends on its content, not an empty strip", () => {
		const html = renderToStaticMarkup(<SessionCardBody session={session()} />);
		expect(html).not.toContain("mt-3.5");
	});

	test("a diff still holds the head line it shares with the repo's old slot", () => {
		const withPr = session({
			prAdditions: 25,
			prDeletions: 1,
			// Not the fixture's own repo name: the assertion below is about the
			// head line, and a PR link would spell "opensession" out for it.
			prUrl: "https://github.com/tellahq/example/pull/1",
			prNumber: 1,
			prState: "OPEN",
		});
		for (const html of [
			renderToStaticMarkup(<SessionCardBody session={withPr} />),
			renderToStaticMarkup(
				<WsCardBody row={row([withPr])} onArchive={() => {}} onOpen={() => {}} />,
			),
		]) {
			expect(html).toContain("+25");
			expect(html).toContain("-1");
			expect(html).not.toContain("opensession");
		}
	});
});
