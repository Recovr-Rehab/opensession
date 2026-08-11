import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../ui/button";
import { Field, FieldGrid, Input } from "../ui/input";
import { Modal } from "../ui/modal";
import { EmptyState, InlineAlert, LoadingState } from "../ui/state";
import {
	SettingCard,
	SettingRow,
	SettingRowControl,
	SettingRowDescription,
	SettingRowText,
	SettingRowTitle,
	SettingsGroupLabel,
	SettingsHint,
} from "../ui/settings";
import { toast } from "../ui/toast";
import { IconPencil, IconPlus, IconTrash } from "./icons";
import { setupRequest, type TeamMember } from "./setup-shared";
import { UserAvatar } from "./UserAvatar";

// Settings → Setup → Team: the manageable roster. The identity table drives
// commit attribution, `allowedUsers` MCP scoping, and GitHub sign-in, so each
// member row carries the aliases the matcher resolves through. Add/edit go
// through a small dialog; remove is an inline two-tap confirm.

export function TeamSection({
	onChanged,
	title,
}: {
	onChanged: () => void | Promise<void>;
	/** Group label above the roster. Omitted when the page or wizard step is
	 *  already titled — then the row carries only the button. */
	title?: React.ReactNode;
}) {
	const [members, setMembers] = useState<TeamMember[] | null>(null);
	const [loadFailed, setLoadFailed] = useState(false);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<TeamMember | null>(null);

	const load = useCallback(async () => {
		try {
			const body = await setupRequest<{ members: TeamMember[] }>("/api/setup/team");
			setMembers(body.members);
			setLoadFailed(false);
		} catch {
			setLoadFailed(true);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	async function handleMutated() {
		await load();
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
						onClick={() => {
							setEditing(null);
							setDialogOpen(true);
						}}
					>
						Add member
					</Button>
				}
			>
				{title}
			</SettingsGroupLabel>
			<SettingCard>
				{!members ? (
					loadFailed ? (
						<EmptyState placement="row">Couldn&rsquo;t load the team roster.</EmptyState>
					) : (
						<LoadingState placement="row">Loading team…</LoadingState>
					)
				) : members.length === 0 ? (
					<EmptyState placement="row">
						No teammates yet — add everyone who uses this instance so commits and
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
			<SettingsHint>
				Names, emails, GitHub logins and Slack ids all resolve through the same
				identity table — a session user given as any of them matches the member.
			</SettingsHint>
			<MemberDialog
				open={dialogOpen}
				member={editing}
				onOpenChange={setDialogOpen}
				onSaved={async () => {
					setDialogOpen(false);
					await handleMutated();
				}}
			/>
		</>
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
		member.github && `gh:${member.github}`,
		member.slackId,
		member.aliases?.length ? `aka ${member.aliases.join(", ")}` : undefined,
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
			<SettingRowControl className="flex items-center gap-1">
				<Button
					variant="ghost"
					size="sm"
					icon={<IconPencil size={16} />}
					aria-label={`Edit ${member.name}`}
					onClick={onEdit}
				/>
				<RemoveMemberButton member={member} onRemoved={onRemoved} />
			</SettingRowControl>
		</SettingRow>
	);
}

/** Two-tap remove: the trash glyph arms a "Really remove?" confirm that
 * disarms itself after a beat — no browser confirm(). */
function RemoveMemberButton({
	member,
	onRemoved,
}: {
	member: TeamMember;
	onRemoved: () => void | Promise<void>;
}) {
	const [confirming, setConfirming] = useState(false);
	const [busy, setBusy] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

	useEffect(
		() => () => {
			if (timer.current) clearTimeout(timer.current);
		},
		[],
	);

	function arm() {
		setConfirming(true);
		if (timer.current) clearTimeout(timer.current);
		timer.current = setTimeout(() => setConfirming(false), 4000);
	}

	async function remove() {
		if (timer.current) clearTimeout(timer.current);
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
			setConfirming(false);
		}
	}

	if (!confirming) {
		return (
			<Button
				variant="ghost"
				size="sm"
				icon={<IconTrash size={16} />}
				aria-label={`Remove ${member.name}`}
				onClick={arm}
			/>
		);
	}
	return (
		<Button variant="destructive" size="sm" onClick={remove} disabled={busy}>
			{busy ? "Removing…" : "Really remove?"}
		</Button>
	);
}

function MemberDialog({
	open,
	member,
	onOpenChange,
	onSaved,
}: {
	open: boolean;
	/** null → add; a member → edit that member. */
	member: TeamMember | null;
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
					title={member ? `Edit ${member.name}` : "Add member"}
					description="Identity table entry — commits, sessions and access grants resolve through it."
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
							{saving ? "Saving…" : member ? "Save changes" : "Add member"}
						</Button>
					</Modal.Footer>
				</form>
			</Modal.Content>
		</Modal.Root>
	);
}
