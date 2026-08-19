import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Field, FieldGrid, Input } from "../ui/input";
import { MENU_ICON, Menu } from "../ui/menu";
import { Modal } from "../ui/modal";
import { EmptyState, InlineAlert } from "../ui/state";
import {
	rowMenuTriggerClasses,
	SettingCard,
	SettingCardSkeleton,
	SettingRow,
	SettingRowControl,
	SettingRowDescription,
	SettingRowText,
	SettingRowTitle,
	SettingsGroupLabel,
	SettingsHint,
} from "../ui/settings";
import { toast } from "../ui/toast";
import { IconDotsHorizontal, IconMail, IconPencil, IconPlus, IconTrash } from "./icons";
import { setupRequest, type TeamMember } from "./setup-shared";
import { UserAvatar } from "./UserAvatar";

// Settings → Setup → Team: the manageable roster. The identity table drives
// commit attribution, `allowedUsers` MCP scoping, and GitHub sign-in, so each
// member row stays concise while every identifier remains available in the
// edit dialog. Add/edit go through a small dialog; remove is confirmed.

interface PendingInvitation {
	id: string;
	email: string;
	createdAt: string;
	expiresAt: string;
	sentAt: string;
}

export function TeamSection({
	onChanged,
	title,
	addLabel = "Add member",
	inviteByEmail = false,
}: {
	onChanged: () => void | Promise<void>;
	/** Optional label above the roster. Defaults to the roster name and count. */
	title?: React.ReactNode;
	/** Action copy for the add flow. Settings keeps "Add member"; onboarding invites. */
	addLabel?: string;
	/** Send a bearer invitation by email instead of adding a roster row directly. */
	inviteByEmail?: boolean;
}) {
	const [members, setMembers] = useState<TeamMember[] | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<TeamMember | null>(null);
	const [invitations, setInvitations] = useState<PendingInvitation[]>([]);
	const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);

	const load = useCallback(async () => {
		try {
			const body = await setupRequest<{ members: TeamMember[] }>("/api/setup/team");
			setMembers(body.members);
			setLoadFailed(false);
		} catch {
			setLoadFailed(true);
		}
	}, []);

	const loadInvitations = useCallback(async () => {
		if (!inviteByEmail) return;
		try {
			const body = await setupRequest<{
				configured: boolean;
				invitations: PendingInvitation[];
			}>("/api/setup/invitations");
			setEmailConfigured(body.configured);
			setInvitations(body.invitations);
		} catch {
			setEmailConfigured(false);
		}
	}, [inviteByEmail]);

	useEffect(() => {
		void load();
		void loadInvitations();
	}, [load, loadInvitations]);

	async function handleMutated() {
		await Promise.all([load(), loadInvitations()]);
		await onChanged();
	}

	return (
		<>
			<SettingsGroupLabel
				className={title ? undefined : "mt-0"}
				actions={
					<Button
						size="sm"
						icon={<IconPlus size={16} />}
						disabled={inviteByEmail && emailConfigured === false}
						title={
							inviteByEmail && emailConfigured === false
								? "Configure email delivery before sending invitations"
								: undefined
						}
						onClick={() => {
							setEditing(null);
							setDialogOpen(true);
						}}
					>
						{addLabel}
					</Button>
				}
			>
				{title ?? `Team members${members ? ` · ${members.length}` : ""}`}
			</SettingsGroupLabel>
			{inviteByEmail && emailConfigured === false && (
				<InlineAlert>
					Email delivery isn&rsquo;t configured on this server. Add the SMTP
					settings, then restart Open Session.
				</InlineAlert>
			)}
			{invitations.length > 0 && (
				<SettingCard>
					{invitations.map((invitation) => (
						<InvitationRow
							key={invitation.id}
							invitation={invitation}
							onChanged={handleMutated}
						/>
					))}
				</SettingCard>
			)}
			{!members && !loadFailed ? (
				// The card itself is the ghost, so the roster lands in the block it
				// was already occupying. Rendering the real card around a loading
				// label instead gave the group a one-line height that trebled the
				// moment the members arrived.
				<SettingCardSkeleton rows={3} icon={28} label="Loading team" />
			) : (
				<SettingCard>
					{!members ? (
						<EmptyState placement="row">Couldn&rsquo;t load the team roster.</EmptyState>
					) : members.length === 0 ? (
						<EmptyState placement="row">
							No teammates yet. Add everyone who uses this instance so commits and
							sessions attribute to real people.
						</EmptyState>
					) : (
						members.map((m) => (
							<MemberRow
								key={m.name}
								member={m}
								onEdit={() => {
									setEditing(m);
									setDialogOpen(true);
								}}
								onRemoved={handleMutated}
							/>
						))
					)}
				</SettingCard>
			)}
			<SettingsHint>
				Names, emails, GitHub logins and Slack ids all resolve through the same
				identity table, so a session user given as any of them matches the member.
			</SettingsHint>
			{inviteByEmail ? (
				<InviteDialog
					open={dialogOpen}
					onOpenChange={setDialogOpen}
					onSent={async () => {
						setDialogOpen(false);
						await handleMutated();
					}}
				/>
			) : (
				<MemberDialog
					open={dialogOpen}
					member={editing}
					addLabel={addLabel}
					onOpenChange={setDialogOpen}
					onSaved={async () => {
						setDialogOpen(false);
						await handleMutated();
					}}
				/>
			)}
		</>
	);
}

function InvitationRow({
	invitation,
	onChanged,
}: {
	invitation: PendingInvitation;
	onChanged: () => void | Promise<void>;
}) {
	const [busy, setBusy] = useState<"resend" | "revoke" | null>(null);
	const expires = new Date(invitation.expiresAt).toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});

	async function update(action: "resend" | "revoke") {
		setBusy(action);
		try {
			await setupRequest(
				`/api/setup/invitations/${encodeURIComponent(invitation.id)}/${action}`,
				{ method: "POST" },
			);
			toast(action === "resend" ? "Invitation resent" : "Invitation revoked", {
				variant: "success",
			});
			await onChanged();
		} catch (error: any) {
			toast(error?.message || `Could not ${action} invitation`, {
				variant: "error",
			});
		} finally {
			setBusy(null);
		}
	}

	return (
		<SettingRow>
			<span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-active text-dim">
				<IconMail size={16} />
			</span>
			<SettingRowText>
				<SettingRowTitle>{invitation.email}</SettingRowTitle>
				<SettingRowDescription>Invitation pending · expires {expires}</SettingRowDescription>
			</SettingRowText>
			<SettingRowControl className="flex items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					disabled={busy !== null}
					onClick={() => void update("resend")}
				>
					{busy === "resend" ? "Sending…" : "Resend"}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={busy !== null}
					onClick={() => void update("revoke")}
				>
					Revoke
				</Button>
			</SettingRowControl>
		</SettingRow>
	);
}

function InviteDialog({
	open,
	onOpenChange,
	onSent,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSent: () => void | Promise<void>;
}) {
	const [email, setEmail] = useState("");
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const emailRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!open) return;
		setEmail("");
		setError(null);
	}, [open]);

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		if (!email.trim() || sending) return;
		setSending(true);
		setError(null);
		try {
			await setupRequest("/api/setup/invitations", {
				method: "POST",
				json: { email: email.trim() },
			});
			toast(`Invitation sent to ${email.trim()}`, { variant: "success" });
			await onSent();
		} catch (cause: any) {
			setError(cause?.message || "Could not send invitation");
		} finally {
			setSending(false);
		}
	}

	return (
		<Modal.Root
			open={open}
			onOpenChange={(next) => {
				if (!sending) onOpenChange(next);
			}}
			disablePointerDismissal={sending}
		>
			<Modal.Content initialFocus={emailRef}>
				<Modal.Header
					title="Invite person"
					description="They will receive a link to join this organization with GitHub."
				/>
				<form className="flex flex-col gap-3" onSubmit={submit}>
					<Field label="Email address">
						<Input
							ref={emailRef}
							type="email"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							placeholder="person@company.com"
							autoComplete="email"
							required
						/>
					</Field>
					{error && <InlineAlert>{error}</InlineAlert>}
					<Modal.Footer>
						<Button
							variant="ghost"
							type="button"
							disabled={sending}
							onClick={() => onOpenChange(false)}
						>
							Cancel
						</Button>
						<Button variant="primary" type="submit" disabled={!email.trim() || sending}>
							{sending ? "Sending…" : "Send invitation"}
						</Button>
					</Modal.Footer>
				</form>
			</Modal.Content>
		</Modal.Root>
	);
}

function MemberRow({
	member,
	onEdit,
	onRemoved,
}: {
	member: TeamMember;
	onEdit: () => void;
	onRemoved: () => void | Promise<void>;
}) {
	const details = [
		member.email,
		member.github && `@${member.github}`,
	].filter(Boolean);
	return (
		<SettingRow>
			<UserAvatar name={member.name} login={member.github} size={28} />
			<SettingRowText>
				<SettingRowTitle>{member.name}</SettingRowTitle>
				{details.length > 0 && (
					<SettingRowDescription className="truncate">
						{details.join(" · ")}
					</SettingRowDescription>
				)}
			</SettingRowText>
			<SettingRowControl>
				<MemberActions member={member} onEdit={onEdit} onRemoved={onRemoved} />
			</SettingRowControl>
		</SettingRow>
	);
}

function MemberActions({
	member,
	onEdit,
	onRemoved,
}: {
	member: TeamMember;
	onEdit: () => void;
	onRemoved: () => void | Promise<void>;
}) {
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [busy, setBusy] = useState(false);
	const cancelRef = useRef<HTMLButtonElement>(null);

	async function remove() {
		setBusy(true);
		try {
			await setupRequest(`/api/setup/team/${encodeURIComponent(member.name)}/remove`, {
				method: "POST",
			});
			toast(`${member.name} removed`);
			await onRemoved();
		} catch (e: any) {
			toast(e.message, { variant: "error" });
			setBusy(false);
		}
	}

	return (
		<>
			<Menu.Root>
				<Menu.Trigger
					className={rowMenuTriggerClasses}
					aria-label={`Manage ${member.name}`}
				>
					<IconDotsHorizontal size={18} />
				</Menu.Trigger>
				<Menu.Popup align="end" sideOffset={4}>
					<Menu.Item onClick={onEdit}>
						<IconPencil size={16} className={MENU_ICON} />
						Edit member
					</Menu.Item>
					<Menu.Item
						className="text-red data-[highlighted]:bg-red-soft data-[highlighted]:text-red"
						onClick={() => setConfirmOpen(true)}
					>
						<IconTrash size={16} />
						Remove member
					</Menu.Item>
				</Menu.Popup>
			</Menu.Root>
			<Modal.Root
				open={confirmOpen}
				onOpenChange={(open) => {
					if (!busy) setConfirmOpen(open);
				}}
				disablePointerDismissal={busy}
			>
				<Modal.Content initialFocus={cancelRef}>
					<Modal.Header
						title={`Remove ${member.name}?`}
						description="This removes their identity mapping from Open Session."
					/>
					<Modal.Footer>
						<Button
							ref={cancelRef}
							variant="ghost"
							onClick={() => setConfirmOpen(false)}
							disabled={busy}
						>
							Cancel
						</Button>
						<Button variant="danger-strong" onClick={remove} disabled={busy}>
							{busy ? "Removing…" : "Remove"}
						</Button>
					</Modal.Footer>
				</Modal.Content>
			</Modal.Root>
		</>
	);
}

function MemberDialog({
	open,
	member,
	addLabel,
	onOpenChange,
	onSaved,
}: {
	open: boolean;
	/** null → add; a member → edit that member. */
	member: TeamMember | null;
	addLabel: string;
	onOpenChange: (open: boolean) => void;
	onSaved: () => void | Promise<void>;
}) {
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [github, setGithub] = useState("");
	const [slackId, setSlackId] = useState("");
	const [alias, setAlias] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const nameRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		if (!open) return;
		setError(null);
		setName(member?.name ?? "");
		setEmail(member?.email ?? "");
		setGithub(member?.github ?? "");
		setSlackId(member?.slackId ?? "");
		setAlias(member?.aliases?.join(", ") ?? "");
	}, [open, member]);

	const parsedAliases = alias
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed || saving) return;
		setSaving(true);
		setError(null);
		try {
			if (!member) {
				const body: Record<string, unknown> = { name: trimmed };
				if (email.trim()) body.email = email.trim();
				if (github.trim()) body.github = github.trim();
				if (slackId.trim()) body.slackId = slackId.trim();
				if (parsedAliases.length) body.aliases = parsedAliases;
				await setupRequest("/api/setup/team", { method: "POST", json: body });
				toast(`${trimmed} added`);
			} else {
				// Partial update: only changed fields ride; an emptied field that was
				// set is deleted with null; a changed name renames.
				const patch: Record<string, unknown> = {};
				if (trimmed !== member.name) patch.name = trimmed;
				const diffField = (key: string, next: string, prev: string | undefined) => {
					const v = next.trim();
					if (v) {
						if (v !== (prev ?? "")) patch[key] = v;
					} else if (prev) {
						patch[key] = null;
					}
				};
				diffField("email", email, member.email);
				diffField("github", github, member.github);
				diffField("slackId", slackId, member.slackId);
				const prevAliases = member.aliases ?? [];
				if (JSON.stringify(parsedAliases) !== JSON.stringify(prevAliases)) {
					patch.aliases = parsedAliases.length ? parsedAliases : null;
				}
				if (Object.keys(patch).length > 0) {
					await setupRequest(`/api/setup/team/${encodeURIComponent(member.name)}`, {
						method: "PUT",
						json: patch,
					});
				}
				toast(`${trimmed} saved`);
			}
			setSaving(false);
			await onSaved();
		} catch (e: any) {
			setError(e.message);
			setSaving(false);
		}
	}

	return (
		<Modal.Root
			open={open}
			onOpenChange={(next) => {
				if (!saving) onOpenChange(next);
			}}
			disablePointerDismissal={saving}
		>
			<Modal.Content initialFocus={nameRef}>
				<Modal.Header
					title={member ? `Edit ${member.name}` : addLabel}
					description="Commits, sessions, and access grants resolve through this person."
				/>
				<form className="flex flex-col gap-3" onSubmit={submit}>
					<Field label="Full name">
						<Input
							ref={nameRef}
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Ada Lovelace"
							spellCheck={false}
						/>
					</Field>
					{/* Email and Alias run full width: an address clips in a
					    half-dialog column, and an alias list grows. Only the two
					    short identifiers share a row. */}
					<Field label="Email">
						<Input
							type="email"
							value={email}
							onChange={(e) => setEmail(e.target.value)}
							placeholder="ada@example.com"
							spellCheck={false}
						/>
					</Field>
					<FieldGrid>
						<Field label="GitHub login">
							<Input
								value={github}
								onChange={(e) => setGithub(e.target.value)}
								placeholder="adalovelace"
								autoCapitalize="none"
								spellCheck={false}
							/>
						</Field>
						<Field label="Slack member id">
							<Input
								className="font-mono"
								value={slackId}
								onChange={(e) => setSlackId(e.target.value)}
								placeholder="U01ABCDEF"
								autoCapitalize="none"
								spellCheck={false}
							/>
						</Field>
					</FieldGrid>
					<Field label="Alias">
						<Input
							value={alias}
							onChange={(e) => setAlias(e.target.value)}
							placeholder="ada"
							autoCapitalize="none"
							spellCheck={false}
						/>
					</Field>
					{error && <InlineAlert>{error}</InlineAlert>}
					<Modal.Footer>
						<Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
							Cancel
						</Button>
						<Button variant="primary" type="submit" disabled={!name.trim() || saving}>
							{saving ? "Saving…" : member ? "Save changes" : addLabel}
						</Button>
					</Modal.Footer>
				</form>
			</Modal.Content>
		</Modal.Root>
	);
}
