import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	addToWaitlist,
	listWaitlist,
	parseWaitlistMarkdown,
} from "./waitlist";

const previousFile = process.env.OPENSESSION_WAITLIST_FILE;
const dirs: string[] = [];

function useTempWaitlist(): string {
	const dir = mkdtempSync(join(tmpdir(), "opensession-waitlist-"));
	dirs.push(dir);
	const file = join(dir, "waitlist.md");
	process.env.OPENSESSION_WAITLIST_FILE = file;
	return file;
}

afterEach(() => {
	if (previousFile === undefined) delete process.env.OPENSESSION_WAITLIST_FILE;
	else process.env.OPENSESSION_WAITLIST_FILE = previousFile;
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("waitlist", () => {
	test("parses the existing Markdown format and ignores invalid rows", () => {
		expect(
			parseWaitlistMarkdown(
				"# Waitlist\n\n- ADA@EXAMPLE.COM · 2026-08-19T10:00:00.000Z\n- nope · yesterday\n",
			),
		).toEqual([
			{ email: "ada@example.com", createdAt: "2026-08-19T10:00:00.000Z" },
		]);
	});

	test("stores and notifies once for a case-insensitive duplicate", async () => {
		const file = useTempWaitlist();
		const notified: string[] = [];
		const notify = async (entry: { email: string }) => {
			notified.push(entry.email);
			return true;
		};
		const first = await addToWaitlist(" Ada@Example.com ", {
			now: new Date("2026-08-19T10:00:00.000Z"),
			notify,
		});
		const duplicate = await addToWaitlist("ada@example.com", {
			now: new Date("2026-08-20T10:00:00.000Z"),
			notify,
		});

		expect(first).toMatchObject({ duplicate: false, slackNotified: true });
		expect(duplicate).toMatchObject({ duplicate: true, slackNotified: false });
		expect(notified).toEqual(["ada@example.com"]);
		expect(listWaitlist()).toEqual([
			{ email: "ada@example.com", createdAt: "2026-08-19T10:00:00.000Z" },
		]);
		expect(readFileSync(file, "utf8")).toBe(
			"# Waitlist\n\n- ada@example.com · 2026-08-19T10:00:00.000Z\n",
		);
	});

	test("keeps the signup when Slack is unavailable", async () => {
		useTempWaitlist();
		const result = await addToWaitlist("grace@example.com", {
			notify: async () => {
				throw new Error("offline");
			},
		});
		expect(result).toMatchObject({ duplicate: false, slackNotified: false });
		expect(listWaitlist().map((entry) => entry.email)).toEqual([
			"grace@example.com",
		]);
	});
});
