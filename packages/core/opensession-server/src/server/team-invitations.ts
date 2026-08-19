/**
 * Email invitations for the instance roster.
 *
 * An invitation is a short-lived bearer link sent through the operator's SMTP
 * server. The raw token exists only in the email; durable state stores a
 * SHA-256 digest. Accepting the link still requires GitHub device sign-in, and
 * only then adds that verified login to identity.team. This keeps the roster as
 * the single access gate while removing GitHub handles from the admin's invite
 * form.
 */

import { createHash, randomBytes } from "crypto";
import { chmodSync, readFileSync } from "fs";
import nodemailer from "nodemailer";
import { audit } from "./audit";
import {
	configuredIdentity,
	configuredServer,
	organizationName,
	parseTeamMember,
	productName,
} from "./config";
import {
	persistRawConfig,
	rawConfig,
	withConfigMutationLock,
} from "./config-mutation";
import { stateDir } from "./paths";
import { writeJsonAtomic } from "./shared/atomic-write";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RETAIN_MS = 30 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface TeamInvitation {
	id: string;
	email: string;
	createdAt: string;
	expiresAt: string;
	sentAt: string;
	acceptedAt?: string;
	acceptedLogin?: string;
	revokedAt?: string;
}

interface StoredInvitation extends TeamInvitation {
	tokenHash: string;
}

interface InvitationStore {
	invitations: StoredInvitation[];
}

const g = globalThis as typeof globalThis & {
	__teamInvitationLock?: Promise<void>;
};

function storePath(): string {
	return (
		process.env.OPENSESSION_TEAM_INVITES_STORE ||
		stateDir("team-invitations.json")
	);
}

function readStore(): InvitationStore {
	try {
		const parsed = JSON.parse(readFileSync(storePath(), "utf8"));
		return {
			invitations: Array.isArray(parsed?.invitations)
				? parsed.invitations.filter(
						(invite: unknown): invite is StoredInvitation =>
							!!invite &&
							typeof invite === "object" &&
							typeof (invite as StoredInvitation).id === "string" &&
							typeof (invite as StoredInvitation).email === "string" &&
							typeof (invite as StoredInvitation).tokenHash === "string",
					)
				: [],
		};
	} catch {
		return { invitations: [] };
	}
}

function persist(store: InvitationStore): void {
	const cutoff = Date.now() - RETAIN_MS;
	store.invitations = store.invitations.filter((invite) => {
		const finished = invite.acceptedAt || invite.revokedAt || invite.expiresAt;
		return Date.parse(finished) >= cutoff;
	});
	writeJsonAtomic(storePath(), store);
	try {
		chmodSync(storePath(), 0o600);
	} catch {}
}

async function withInvitationLock<T>(work: () => Promise<T> | T): Promise<T> {
	const previous = g.__teamInvitationLock || Promise.resolve();
	let release!: () => void;
	g.__teamInvitationLock = new Promise<void>((resolve) => {
		release = resolve;
	});
	await previous;
	try {
		return await work();
	} finally {
		release();
	}
}

function cleanEmail(value: string): string | null {
	const email = value.trim().toLowerCase();
	return EMAIL_RE.test(email) ? email : null;
}

function tokenDigest(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

function publicInvitation(invite: StoredInvitation): TeamInvitation {
	const { tokenHash: _tokenHash, ...safe } = invite;
	return safe;
}

export function emailInvitationsConfigured(): boolean {
	return !!(
		process.env.OPENSESSION_INVITE_FROM?.trim() &&
		(process.env.OPENSESSION_SMTP_URL?.trim() ||
			process.env.OPENSESSION_INVITE_JSON_TRANSPORT === "1")
	);
}

export function listTeamInvitations(): TeamInvitation[] {
	const now = Date.now();
	return readStore()
		.invitations.filter(
			(invite) =>
				!invite.acceptedAt &&
				!invite.revokedAt &&
				Date.parse(invite.expiresAt) > now,
		)
		.map(publicInvitation)
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&#39;");
}

async function deliverInvitation(email: string, token: string): Promise<void> {
	const smtpUrl = process.env.OPENSESSION_SMTP_URL?.trim();
	const from = process.env.OPENSESSION_INVITE_FROM?.trim();
	const jsonTransport = process.env.OPENSESSION_INVITE_JSON_TRANSPORT === "1";
	if ((!smtpUrl && !jsonTransport) || !from) {
		throw new Error(
			"Email invitations are not configured. Set OPENSESSION_SMTP_URL and OPENSESSION_INVITE_FROM.",
		);
	}
	const org = organizationName();
	const app = productName();
	const base = configuredServer().publicBaseUrl.replace(/\/+$/, "");
	const url = `${base}/invite/${encodeURIComponent(token)}`;
	const subject = `Join ${org} on ${app}`;
	const transport = jsonTransport
		? nodemailer.createTransport({ jsonTransport: true })
		: nodemailer.createTransport(smtpUrl!);
	try {
		await transport.sendMail({
			from,
			to: email,
			subject,
			text: `You have been invited to join ${org} on ${app}.\n\nAccept the invitation: ${url}\n\nThis invitation expires in 7 days.`,
			html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#171717;line-height:1.5"><h1 style="font-size:24px">Join ${escapeHtml(org)}</h1><p>You have been invited to ${escapeHtml(org)} on ${escapeHtml(app)}.</p><p><a href="${escapeHtml(url)}" style="display:inline-block;padding:11px 16px;border-radius:8px;background:#171717;color:#fff;text-decoration:none">Accept invitation</a></p><p style="color:#666;font-size:13px">This invitation expires in 7 days.</p></div>`,
		});
	} finally {
		transport.close();
	}
}

function newToken(): string {
	return randomBytes(32).toString("base64url");
}

function newId(): string {
	return `invite_${randomBytes(10).toString("hex")}`;
}

export async function createTeamInvitation(
	rawEmail: string,
): Promise<TeamInvitation> {
	const email = cleanEmail(rawEmail);
	if (!email) throw new Error("Enter a valid email address");
	if (!emailInvitationsConfigured()) {
		throw new Error(
			"Email invitations are not configured. Set OPENSESSION_SMTP_URL and OPENSESSION_INVITE_FROM.",
		);
	}
	if (
		configuredIdentity().team.some(
			(member) => member.email?.trim().toLowerCase() === email,
		)
	) {
		throw new Error(`${email} is already a member`);
	}
	return withInvitationLock(async () => {
		const store = readStore();
		const now = Date.now();
		const duplicate = store.invitations.find(
			(invite) =>
				invite.email === email &&
				!invite.acceptedAt &&
				!invite.revokedAt &&
				Date.parse(invite.expiresAt) > now,
		);
		if (duplicate) throw new Error(`${email} already has a pending invitation`);
		const token = newToken();
		const timestamp = new Date(now).toISOString();
		const invite: StoredInvitation = {
			id: newId(),
			email,
			tokenHash: tokenDigest(token),
			createdAt: timestamp,
			sentAt: timestamp,
			expiresAt: new Date(now + INVITE_TTL_MS).toISOString(),
		};
		await deliverInvitation(email, token);
		store.invitations.push(invite);
		persist(store);
		audit({ kind: "team_invitation", action: "send", email, invitationId: invite.id });
		return publicInvitation(invite);
	});
}

export async function resendTeamInvitation(id: string): Promise<TeamInvitation> {
	return withInvitationLock(async () => {
		const store = readStore();
		const invite = store.invitations.find((candidate) => candidate.id === id);
		if (!invite || invite.acceptedAt || invite.revokedAt) {
			throw new Error("Invitation not found");
		}
		const token = newToken();
		const now = Date.now();
		await deliverInvitation(invite.email, token);
		invite.tokenHash = tokenDigest(token);
		invite.sentAt = new Date(now).toISOString();
		invite.expiresAt = new Date(now + INVITE_TTL_MS).toISOString();
		persist(store);
		audit({
			kind: "team_invitation",
			action: "resend",
			email: invite.email,
			invitationId: invite.id,
		});
		return publicInvitation(invite);
	});
}

export async function revokeTeamInvitation(id: string): Promise<void> {
	await withInvitationLock(() => {
		const store = readStore();
		const invite = store.invitations.find((candidate) => candidate.id === id);
		if (!invite || invite.acceptedAt || invite.revokedAt) {
			throw new Error("Invitation not found");
		}
		invite.revokedAt = new Date().toISOString();
		persist(store);
		audit({
			kind: "team_invitation",
			action: "revoke",
			email: invite.email,
			invitationId: invite.id,
		});
	});
}

function rawTeam(config: Record<string, unknown>): Record<string, unknown>[] {
	const identity =
		config.identity && typeof config.identity === "object" && !Array.isArray(config.identity)
			? (config.identity as Record<string, unknown>)
			: {};
	config.identity = identity;
	const team = Array.isArray(identity.team) ? identity.team : [];
	identity.team = team;
	return team.filter(
		(member): member is Record<string, unknown> =>
			!!member && typeof member === "object" && !Array.isArray(member),
	);
}

function memberString(
	member: Record<string, unknown>,
	field: "name" | "email" | "github",
): string {
	return typeof member[field] === "string" ? member[field].trim() : "";
}

/** Consume an invitation after GitHub has verified the accepting account. */
export async function acceptTeamInvitation(
	token: string,
	github: { login: string; name?: string },
): Promise<{ name: string; email: string } | { error: string }> {
	if (!token) return { error: "Invitation token required" };
	return withInvitationLock(async () => {
		const store = readStore();
		const digest = tokenDigest(token);
		const invite = store.invitations.find(
			(candidate) => candidate.tokenHash === digest,
		);
		if (!invite || invite.revokedAt || invite.acceptedAt) {
			return { error: "This invitation is no longer valid" };
		}
		if (Date.parse(invite.expiresAt) <= Date.now()) {
			return { error: "This invitation has expired. Ask an administrator to resend it." };
		}

		let resolvedName = github.name?.trim() || github.login;
		await withConfigMutationLock(async () => {
			const config = rawConfig();
			const team = rawTeam(config);
			const login = github.login.toLowerCase();
			const email = invite.email.toLowerCase();
			let member = team.find(
				(candidate) => memberString(candidate, "github").toLowerCase() === login,
			);
			if (!member) {
				member = team.find(
					(candidate) => memberString(candidate, "email").toLowerCase() === email,
				);
			}
			if (member) {
				member.github = github.login;
				member.email ||= invite.email;
				resolvedName = memberString(member, "name") || resolvedName;
			} else {
				const usedNames = new Set(
					team.map((candidate) => memberString(candidate, "name").toLowerCase()),
				);
				if (usedNames.has(resolvedName.toLowerCase())) {
					resolvedName = `${resolvedName} (@${github.login})`;
				}
				const candidate = {
					name: resolvedName,
					email: invite.email,
					github: github.login,
				};
				if (!parseTeamMember(candidate)) throw new Error("Could not add invited member");
				team.push(candidate);
			}
			(config.identity as Record<string, unknown>).team = team;
			persistRawConfig(config);
		});

		invite.acceptedAt = new Date().toISOString();
		invite.acceptedLogin = github.login;
		persist(store);
		audit({
			kind: "team_invitation",
			action: "accept",
			email: invite.email,
			login: github.login,
			invitationId: invite.id,
		});
		return { name: resolvedName, email: invite.email };
	});
}
