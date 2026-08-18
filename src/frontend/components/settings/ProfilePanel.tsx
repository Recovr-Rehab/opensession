import React, { useEffect, useRef, useState } from "react";
import {
	fetchProfile,
	removeProfileImage,
	saveProfile,
	uploadProfileImage,
	type Profile,
} from "../../lib/api/profile";
import { refreshPeople } from "../../lib/people";
import { Button } from "../../ui/button";
import { Field, FieldGrid, Input } from "../../ui/input";
import {
	SettingCard,
	SettingRow,
	SettingRowControl,
	SettingRowDescription,
	SettingRowText,
	SettingRowTitle,
	SettingsForm,
	SettingsGroupLabel,
	SettingsHeader,
	SettingsHint,
	SettingsPanel,
} from "../../ui/settings";
import { EmptyState, InlineAlert, LoadingState } from "../../ui/state";
import { toast } from "../../ui/toast";
import { IconTrash } from "../icons";
import { useCurrentUser } from "../UserPicker";
import { UserAvatar } from "../UserAvatar";

/**
 * Settings > Personal > Profile: your own row in the team roster, plus your
 * picture.
 *
 * The rest of Personal is per-device or per-user state (theme, shortcuts,
 * prefs). This page is the one place where a person edits the identity the
 * whole instance sees, which is why it is the first thing in the group and why
 * the fields it does NOT offer say so in a line rather than being absent: your
 * GitHub login is how you sign in, so only an admin can move it.
 */
export function ProfilePanel() {
	const currentUser = useCurrentUser();
	const [profile, setProfile] = useState<Profile | null>(null);
	const [loadError, setLoadError] = useState<string | null>(null);

	useEffect(() => {
		let alive = true;
		setProfile(null);
		setLoadError(null);
		fetchProfile(currentUser)
			.then((p) => alive && setProfile(p))
			.catch((e) => alive && setLoadError(e.message));
		return () => {
			alive = false;
		};
	}, [currentUser]);

	return (
		<SettingsPanel>
			<SettingsHeader
				title="Profile"
				description="Your picture and name, as everyone on this instance sees them."
			/>
			{loadError ? (
				<InlineAlert>{loadError}</InlineAlert>
			) : !profile ? (
				<LoadingState>Loading your profile…</LoadingState>
			) : !profile.editable ? (
				<EmptyState placement="card">
					You are signed in as {profile.user}, but you are not on this
					instance&rsquo;s roster yet. An admin can add you on Settings &rsaquo;
					Members.
				</EmptyState>
			) : (
				<ProfileEditor profile={profile} onChange={setProfile} />
			)}
		</SettingsPanel>
	);
}

function ProfileEditor({
	profile,
	onChange,
}: {
	profile: Profile;
	onChange: (next: Profile) => void;
}) {
	return (
		<>
			<PictureSection profile={profile} onChange={onChange} />
			<DetailsSection profile={profile} onChange={onChange} />
			<IdentitySection profile={profile} />
		</>
	);
}

/** The picture: upload, replace, remove. Saves on pick rather than behind the
 *  form's Save, because choosing a file already IS the confirmation. */
function PictureSection({
	profile,
	onChange,
}: {
	profile: Profile;
	onChange: (next: Profile) => void;
}) {
	const fileRef = useRef<HTMLInputElement>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function pick(file: File | undefined) {
		if (!file) return;
		setError(null);
		if (file.size > profile.imageMaxBytes) {
			setError(
				`That picture is ${Math.round(file.size / 1024 / 1024)}MB. The limit is ${Math.round(profile.imageMaxBytes / 1024 / 1024)}MB.`,
			);
			return;
		}
		setBusy(true);
		try {
			const { image } = await uploadProfileImage(file, profile.user);
			onChange({ ...profile, image });
			await refreshPeople();
			toast("Picture updated");
		} catch (e: any) {
			setError(e.message);
		} finally {
			setBusy(false);
			// Clear the input or picking the same file twice does nothing.
			if (fileRef.current) fileRef.current.value = "";
		}
	}

	async function remove() {
		setBusy(true);
		setError(null);
		try {
			await removeProfileImage(profile.user);
			onChange({ ...profile, image: "" });
			await refreshPeople();
			toast("Picture removed");
		} catch (e: any) {
			setError(e.message);
		} finally {
			setBusy(false);
		}
	}

	return (
		<>
			<SettingsGroupLabel className="mt-0">Picture</SettingsGroupLabel>
			<SettingCard>
				<SettingRow className="gap-4">
					<UserAvatar
						name={profile.name}
						login={profile.github}
						image={profile.image}
						size={56}
					/>
					<SettingRowText>
						<SettingRowTitle>{profile.name}</SettingRowTitle>
						<SettingRowDescription>
							{profile.image
								? "Shown wherever you appear: sessions, mentions, reviews."
								: profile.github
									? `Currently your GitHub picture, from @${profile.github}.`
									: "Currently your initial. Upload a picture to replace it."}
						</SettingRowDescription>
					</SettingRowText>
					<SettingRowControl className="flex items-center gap-2">
						<input
							ref={fileRef}
							type="file"
							accept="image/png,image/jpeg,image/gif,image/webp"
							className="hidden"
							onChange={(e) => void pick(e.target.files?.[0])}
						/>
						<Button
							size="sm"
							disabled={busy}
							onClick={() => fileRef.current?.click()}
						>
							{busy ? "Saving…" : profile.image ? "Replace" : "Upload"}
						</Button>
						{profile.image && (
							<Button
								size="sm"
								variant="ghost"
								aria-label="Remove picture"
								disabled={busy}
								onClick={() => void remove()}
								icon={<IconTrash size={16} />}
							/>
						)}
					</SettingRowControl>
				</SettingRow>
			</SettingCard>
			{error && <InlineAlert onDismiss={() => setError(null)}>{error}</InlineAlert>}
			<SettingsHint>
				PNG, JPEG, GIF or WebP, up to{" "}
				{Math.round(profile.imageMaxBytes / 1024 / 1024)}MB.
				{profile.image &&
					(profile.github
						? " Remove it to go back to your GitHub picture."
						: " Remove it to go back to your initial.")}
			</SettingsHint>
		</>
	);
}

/** Name, email, timezone, aliases: the roster fields you own. */
function DetailsSection({
	profile,
	onChange,
}: {
	profile: Profile;
	onChange: (next: Profile) => void;
}) {
	const [name, setName] = useState(profile.name);
	const [email, setEmail] = useState(profile.email);
	const [timezone, setTimezone] = useState(profile.timezone);
	const [aliases, setAliases] = useState(profile.aliases.join(", "));
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setName(profile.name);
		setEmail(profile.email);
		setTimezone(profile.timezone);
		setAliases(profile.aliases.join(", "));
	}, [profile]);

	const parsedAliases = aliases
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	const nextShort = name.trim().split(/\s+/)[0] ?? "";
	const shortNameChanging =
		!!nextShort &&
		nextShort.toLowerCase() !== profile.shortName.toLowerCase();
	const dirty =
		name.trim() !== profile.name ||
		email.trim() !== profile.email ||
		timezone.trim() !== profile.timezone ||
		JSON.stringify(parsedAliases) !== JSON.stringify(profile.aliases);

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		if (!name.trim() || saving || !dirty) return;
		setSaving(true);
		setError(null);
		try {
			const saved = await saveProfile(
				{
					name: name.trim(),
					email: email.trim(),
					timezone: timezone.trim(),
					aliases: parsedAliases,
				},
				profile.user,
			);
			onChange(saved);
			await refreshPeople();
			toast(
				saved.renamedFrom
					? `Saved. You are now ${saved.shortName} everywhere.`
					: "Profile saved",
			);
		} catch (e: any) {
			setError(e.message);
		} finally {
			setSaving(false);
		}
	}

	return (
		<>
			<SettingsGroupLabel>Details</SettingsGroupLabel>
			<SettingsForm>
				<form className="flex flex-col gap-3" onSubmit={submit}>
					<Field label="Name">
						<Input
							value={name}
							onChange={(e) => setName(e.target.value)}
							placeholder="Ada Lovelace"
							spellCheck={false}
						/>
					</Field>
					{shortNameChanging && (
						<InlineAlert variant="warn">
							This changes your short name from {profile.shortName} to{" "}
							{nextShort}. Your pins, read marks and preferences move with you,
							and {profile.shortName} is kept as one of your other names, so
							older sessions still read as yours.
						</InlineAlert>
					)}
					<FieldGrid>
						<Field label="Email">
							<Input
								type="email"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder="ada@example.com"
								spellCheck={false}
							/>
						</Field>
						<Field label="Timezone">
							<Input
								value={timezone}
								onChange={(e) => setTimezone(e.target.value)}
								placeholder="Europe/Amsterdam"
								spellCheck={false}
								autoCapitalize="none"
							/>
						</Field>
					</FieldGrid>
					<Field label="Other names">
						<Input
							value={aliases}
							onChange={(e) => setAliases(e.target.value)}
							placeholder="ada, lovelace"
							spellCheck={false}
							autoCapitalize="none"
						/>
					</Field>
					{error && <InlineAlert>{error}</InlineAlert>}
					<div className="mt-1 flex justify-end">
						<Button
							variant="primary"
							type="submit"
							disabled={!name.trim() || !dirty || saving}
						>
							{saving ? "Saving…" : "Save"}
						</Button>
					</div>
				</form>
			</SettingsForm>
			{/* One line, and the one that is not obvious from the labels: the rest
			    of these fields say what they do. */}
			<SettingsHint>
				The first word of your name is how you are mentioned and how sessions are
				attributed to you.
			</SettingsHint>
		</>
	);
}

/** The two identifiers a person cannot move themselves, each with the reason.
 *  Absent, they read as missing features; stated, they read as a boundary. */
function IdentitySection({ profile }: { profile: Profile }) {
	if (!profile.github && !profile.slackId) return null;
	return (
		<>
			<SettingsGroupLabel>Accounts</SettingsGroupLabel>
			<SettingCard>
				{profile.github && (
					<SettingRow>
						<SettingRowText>
							<SettingRowTitle>GitHub</SettingRowTitle>
							<SettingRowDescription>
								@{profile.github}. This is how you sign in, so an admin changes
								it on Settings &rsaquo; Members.
							</SettingRowDescription>
						</SettingRowText>
					</SettingRow>
				)}
				{profile.slackId && (
					<SettingRow>
						<SettingRowText>
							<SettingRowTitle>Slack</SettingRowTitle>
							<SettingRowDescription>
								{profile.slackId}. Questions and notifications route to it.
							</SettingRowDescription>
						</SettingRowText>
					</SettingRow>
				)}
			</SettingCard>
		</>
	);
}
