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
import { cn } from "../../ui/cn";
import { Field, FieldGrid, Input } from "../../ui/input";
import { SettingsForm, SettingsGroupLabel } from "../../ui/settings";
import { Spinner } from "../../ui/spinner";
import { EmptyState, InlineAlert, Skeleton, SkeletonBar } from "../../ui/state";
import { toast } from "../../ui/toast";
import { IconCamera } from "../icons";
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
				<ProfileSkeleton />
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
 * The form on its way: the card it lands in, the picture at the size it lands
 * at, and the cadence of the fields under it.
 *
 * The fields are bars rather than input-height rectangles on purpose. A grey
 * box the size of a text field reads as a disabled field, a thing you are not
 * allowed to use, where a thin bar reads as a line about to be written. The
 * picture is the one exception, because it really is a 64px squircle and
 * drawing it smaller would move the whole form when the real one arrives.
 */
function ProfileSkeleton() {
	return (
		<Skeleton label="Loading your profile">
			<SettingsForm>
				<div className="flex items-start gap-4 phone:flex-col">
					<SkeletonBar className="size-16 shrink-0 rounded-avatar" />
					<div className="flex min-w-0 flex-1 flex-col gap-3.5">
						<SkeletonBar className="h-2.5 w-[15%]" />
						<FieldGrid>
							<SkeletonBar className="h-2.5 w-[48%]" />
							<SkeletonBar className="h-2.5 w-[62%]" />
						</FieldGrid>
					</div>
				</div>
			</SettingsForm>
		</Skeleton>
	);
}

/**
 * One card, one error slot. The picture saves on pick (choosing a file already
 * is the confirmation), the fields save on Save.
 *
 * The picture is the upload control rather than sitting beside one, and the
 * fields run alongside it instead of underneath. Stacked, the first line of
 * the form was a thumbnail and a button naming what the thumbnail already
 * invited, and the three fields below it started a second column of reading
 * that nothing joined. Side by side there is one block: who you are on the
 * left, what you are called on the right.
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
	// The picture's accessible name. A camera glyph on a scrim says "picture"
	// but not which way it goes, and someone with no picture yet is being
	// offered a different thing than someone replacing one.
	const pictureAction = profile.image ? "Change picture" : "Upload picture";

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
				<div className="flex items-start gap-4 phone:flex-col">
					<div className="flex w-16 shrink-0 flex-col gap-1.5">
						<input
							ref={fileRef}
							type="file"
							accept="image/png,image/jpeg,image/gif,image/webp"
							className="hidden"
							onChange={(e) => void pickPicture(e.target.files?.[0])}
						/>
						{/* The picture IS the button. A separate "Upload picture"
						    plate beside it named an action the picture already
						    invites, and it was the widest thing in the row, so the
						    form's first line was mostly a label about the thumbnail
						    next to it. */}
						<button
							type="button"
							disabled={busy !== null}
							onClick={() => fileRef.current?.click()}
							aria-label={pictureAction}
							title={pictureAction}
							// `flex`, not the default inline box: an inline child sits on
							// the text baseline, which left 4px of descender space under
							// the picture and pushed Remove off the 6px gap.
							className="focus-ring group relative flex rounded-avatar disabled:pointer-events-none"
						>
							<UserAvatar
								name={profile.name}
								login={profile.github}
								image={profile.image}
								size={64}
							>
								<span
									className={cn(
										// Scrim, not a tinted wash: the glyph has to read
										// on whatever picture is underneath it, and a
										// profile picture can be anything.
										"absolute inset-0 grid place-items-center rounded-[inherit] [corner-shape:inherit] bg-black/50 text-white transition-opacity duration-150",
										busy === "picture"
											? "opacity-100"
											: "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
									)}
								>
									{busy === "picture" ? (
										<Spinner size="md" />
									) : (
										<IconCamera size={20} />
									)}
								</span>
							</UserAvatar>
						</button>
						{profile.image && (
							<Button
								size="sm"
								variant="ghost"
								className="w-full px-0"
								disabled={busy !== null}
								onClick={() => void removePicture()}
							>
								Remove
							</Button>
						)}
					</div>
					<div className="flex min-w-0 flex-1 flex-col gap-3.5">
						{/* The hint is a sibling of the Field, not a child: `Field` is
						    the `<label>`, so text inside it joins the input's accessible
						    name. The wrapper gives it the gap the label already has
						    above the input, rather than the form's row gap. */}
						<div className="flex min-w-0 flex-col gap-1.5">
							<Field label="Name">
								<Input
									value={name}
									onChange={(e) => setName(e.target.value)}
									placeholder="Ada Lovelace"
									spellCheck={false}
								/>
							</Field>
							{/* Not a warning: nothing is wrong, and the rename is handled
							    for them by routes/profile.ts, which keeps the old short
							    name as an alias and carries the per-user stores across.
							    All they need is which name their teammates will see, and
							    that the old one still finds them. */}
							{shortNameChanging && (
								<p className="m-0 text-meta text-dim">
									{profile.shortName} becomes {nextShort} in mentions and
									attribution. {profile.shortName} keeps working.
								</p>
							)}
						</div>
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
					</div>
				</div>
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
