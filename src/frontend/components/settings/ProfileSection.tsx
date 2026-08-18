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
import { SettingsForm, SettingsGroupLabel } from "../../ui/settings";
import { EmptyState, InlineAlert, LoadingState } from "../../ui/state";
import { toast } from "../../ui/toast";
import { useCurrentUser } from "../UserPicker";
import { UserAvatar } from "../UserAvatar";

/**
 * Settings > Personal > Account, first block: your picture and the roster
 * fields you own.
 *
 * It shares a page with your sign-ins because between them they answer one
 * question, and it is short for the same reason. The identifiers you cannot
 * move yourself (your GitHub login, your Slack id) are not listed here as dead
 * rows: the accounts below already show the GitHub one, and a disabled field
 * is not information. Aliases are gone from the form too. They are matching
 * wiring rather than profile, and the one case a person hits is handled for
 * them: renaming keeps the old short name automatically (routes/profile.ts).
 */
export function ProfileSection() {
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
		<>
			<SettingsGroupLabel className="mt-0">Profile</SettingsGroupLabel>
			{loadError ? (
				<InlineAlert>{loadError}</InlineAlert>
			) : !profile ? (
				<LoadingState>Loading your profile…</LoadingState>
			) : !profile.editable ? (
				<EmptyState placement="card">
					You ({profile.user}) are not on this instance&rsquo;s roster yet. An
					admin can add you on Settings &rsaquo; Members.
				</EmptyState>
			) : (
				<ProfileForm profile={profile} onChange={setProfile} />
			)}
		</>
	);
}

/**
 * One card, one error slot. The picture saves on pick (choosing a file already
 * is the confirmation), the fields save on Save.
 */
function ProfileForm({
	profile,
	onChange,
}: {
	profile: Profile;
	onChange: (next: Profile) => void;
}) {
	const fileRef = useRef<HTMLInputElement>(null);
	const [name, setName] = useState(profile.name);
	const [email, setEmail] = useState(profile.email);
	const [timezone, setTimezone] = useState(profile.timezone);
	const [busy, setBusy] = useState<"picture" | "fields" | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		setName(profile.name);
		setEmail(profile.email);
		setTimezone(profile.timezone);
	}, [profile]);

	const nextShort = name.trim().split(/\s+/)[0] ?? "";
	const shortNameChanging =
		!!nextShort && nextShort.toLowerCase() !== profile.shortName.toLowerCase();
	const dirty =
		name.trim() !== profile.name ||
		email.trim() !== profile.email ||
		timezone.trim() !== profile.timezone;

	async function pickPicture(file: File | undefined) {
		if (!file) return;
		setError(null);
		const limitMb = Math.round(profile.imageMaxBytes / 1024 / 1024);
		if (file.size > profile.imageMaxBytes) {
			setError(
				`That picture is ${Math.round(file.size / 1024 / 1024)}MB. The limit is ${limitMb}MB.`,
			);
			return;
		}
		setBusy("picture");
		try {
			const { image } = await uploadProfileImage(file, profile.user);
			onChange({ ...profile, image });
			await refreshPeople();
			toast("Picture updated");
		} catch (e: any) {
			setError(e.message);
		} finally {
			setBusy(null);
			// Clear the input or picking the same file twice does nothing.
			if (fileRef.current) fileRef.current.value = "";
		}
	}

	async function removePicture() {
		setBusy("picture");
		setError(null);
		try {
			await removeProfileImage(profile.user);
			onChange({ ...profile, image: "" });
			await refreshPeople();
			toast("Picture removed");
		} catch (e: any) {
			setError(e.message);
		} finally {
			setBusy(null);
		}
	}

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		if (!name.trim() || busy || !dirty) return;
		setBusy("fields");
		setError(null);
		try {
			const saved = await saveProfile(
				{ name: name.trim(), email: email.trim(), timezone: timezone.trim() },
				profile.user,
			);
			onChange(saved);
			await refreshPeople();
			toast(
				saved.renamedFrom
					? `Saved. You are ${saved.shortName} everywhere now.`
					: "Profile saved",
			);
		} catch (e: any) {
			setError(e.message);
		} finally {
			setBusy(null);
		}
	}

	return (
		<SettingsForm>
			<form className="flex flex-col gap-3.5" onSubmit={submit}>
				<div className="flex items-center gap-4">
					<UserAvatar
						name={profile.name}
						login={profile.github}
						image={profile.image}
						size={56}
					/>
					<input
						ref={fileRef}
						type="file"
						accept="image/png,image/jpeg,image/gif,image/webp"
						className="hidden"
						onChange={(e) => void pickPicture(e.target.files?.[0])}
					/>
					<Button
						size="sm"
						disabled={busy !== null}
						onClick={() => fileRef.current?.click()}
					>
						{busy === "picture"
							? "Saving…"
							: profile.image
								? "Change picture"
								: "Upload picture"}
					</Button>
					{profile.image && (
						<Button
							size="sm"
							variant="ghost"
							disabled={busy !== null}
							onClick={() => void removePicture()}
						>
							Remove
						</Button>
					)}
				</div>
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
						This changes your short name from {profile.shortName} to {nextShort},
						which is what mentions and attribution use. Your pins and preferences
						move with you, and {profile.shortName} keeps resolving to you.
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
				{error && (
					<InlineAlert onDismiss={() => setError(null)}>{error}</InlineAlert>
				)}
				<div className="flex justify-end">
					<Button
						variant="primary"
						type="submit"
						disabled={!name.trim() || !dirty || busy !== null}
					>
						{busy === "fields" ? "Saving…" : "Save"}
					</Button>
				</div>
			</form>
		</SettingsForm>
	);
}
