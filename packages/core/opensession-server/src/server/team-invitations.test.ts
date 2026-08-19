import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	acceptTeamInvitation,
	createTeamInvitation,
	listTeamInvitations,
	revokeTeamInvitation,
} from "./team-invitations";

const root = mkdtempSync(join(tmpdir(), "opensession-team-invites-"));
const configPath = join(root, "config.json");
const storePath = join(root, "invites.json");
const previous = {
	config: process.env.OPENSESSION_CONFIG,
	store: process.env.OPENSESSION_TEAM_INVITES_STORE,
	from: process.env.OPENSESSION_INVITE_FROM,
	json: process.env.OPENSESSION_INVITE_JSON_TRANSPORT,
	smtp: process.env.OPENSESSION_SMTP_URL,
};

function writeConfig(team: Record<string, unknown>[] = []) {
	writeFileSync(
		configPath,
		JSON.stringify({
			server: { publicBaseUrl: "https://os.example.test" },
			organization: { name: "Acme" },
			identity: { team },
		}),
	);
}

function digest(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

beforeAll(() => {
	process.env.OPENSESSION_CONFIG = configPath;
	process.env.OPENSESSION_TEAM_INVITES_STORE = storePath;
	process.env.OPENSESSION_INVITE_FROM = "Acme <hello@example.test>";
	process.env.OPENSESSION_INVITE_JSON_TRANSPORT = "1";
	delete process.env.OPENSESSION_SMTP_URL;
	writeConfig([{ name: "Ada", email: "ada@example.test", github: "ada" }]);
});

afterAll(() => {
	if (previous.config === undefined) delete process.env.OPENSESSION_CONFIG;
	else process.env.OPENSESSION_CONFIG = previous.config;
	if (previous.store === undefined) delete process.env.OPENSESSION_TEAM_INVITES_STORE;
	else process.env.OPENSESSION_TEAM_INVITES_STORE = previous.store;
	if (previous.from === undefined) delete process.env.OPENSESSION_INVITE_FROM;
	else process.env.OPENSESSION_INVITE_FROM = previous.from;
	if (previous.json === undefined) delete process.env.OPENSESSION_INVITE_JSON_TRANSPORT;
	else process.env.OPENSESSION_INVITE_JSON_TRANSPORT = previous.json;
	if (previous.smtp === undefined) delete process.env.OPENSESSION_SMTP_URL;
	else process.env.OPENSESSION_SMTP_URL = previous.smtp;
	rmSync(root, { recursive: true, force: true });
});

describe("team invitations", () => {
	test("sends and lists a pending email invitation without exposing its token", async () => {
		const invitation = await createTeamInvitation(" New@Example.test ");
		expect(invitation.email).toBe("new@example.test");
		expect((invitation as any).tokenHash).toBeUndefined();
		expect(listTeamInvitations()).toEqual([invitation]);

		await revokeTeamInvitation(invitation.id);
		expect(listTeamInvitations()).toEqual([]);
	});

	test("accepts a valid bearer invitation only after a verified GitHub login", async () => {
		const token = "known-invitation-token";
		const now = Date.now();
		writeFileSync(
			storePath,
			JSON.stringify({
				invitations: [
					{
						id: "invite_known",
						email: "grace@example.test",
						tokenHash: digest(token),
						createdAt: new Date(now).toISOString(),
						sentAt: new Date(now).toISOString(),
						expiresAt: new Date(now + 60_000).toISOString(),
					},
				],
			}),
		);

		const accepted = await acceptTeamInvitation(token, {
			login: "gracehopper",
			name: "Grace Hopper",
		});
		expect(accepted).toEqual({
			name: "Grace Hopper",
			email: "grace@example.test",
		});
		const config = JSON.parse(readFileSync(configPath, "utf8"));
		expect(config.identity.team).toContainEqual({
			name: "Grace Hopper",
			email: "grace@example.test",
			github: "gracehopper",
		});
		expect(listTeamInvitations()).toEqual([]);
	});

	test("rejects an expired invitation", async () => {
		const token = "expired-invitation-token";
		const now = Date.now();
		writeFileSync(
			storePath,
			JSON.stringify({
				invitations: [
					{
						id: "invite_expired",
						email: "old@example.test",
						tokenHash: digest(token),
						createdAt: new Date(now - 120_000).toISOString(),
						sentAt: new Date(now - 120_000).toISOString(),
						expiresAt: new Date(now - 60_000).toISOString(),
					},
				],
			}),
		);
		const result = await acceptTeamInvitation(token, {
			login: "old-user",
			name: "Old User",
		});
		expect(result).toEqual({
			error: "This invitation has expired. Ask an administrator to resend it.",
		});
	});
});
