import React, { useEffect, useState } from "react";
import { cn } from "../ui/cn";

/**
 * GitHub logins for the team, keyed by lowercased first name — the shape of
 * web user-picker names, presence viewers and `startedBy`, and also the first
 * token of full names coming from chat integrations. lib/people.ts populates
 * the map from the server directory (GET /api/people).
 */
const GITHUB_LOGIN: Record<string, string> = {};

/** Merge directory-fetched logins into the map (lib/people.ts). */
export function registerGithubLogins(entries: Record<string, string>) {
	Object.assign(GITHUB_LOGIN, entries);
}

export function githubLoginFor(name?: string | null): string | null {
	if (!name) return null;
	const first = name.trim().split(/\s+/)[0]?.toLowerCase();
	return (first && GITHUB_LOGIN[first]) || null;
}

/**
 * Squircle user picture: the person's GitHub avatar, falling back to their
 * initial for unknown users (the agent persona, Anonymous) or when the image fails to
 * load. `children` render on top of the squircle — the presence facepile uses
 * that for its count badge.
 *
 * `login` overrides the directory lookup for callers that already hold the
 * GitHub login — the members roster edits the identity table itself, so its
 * rows must picture the login being typed rather than the one /api/people
 * last published.
 */
export function UserAvatar({
	name,
	login: loginProp,
	size = 24,
	edge = true,
	className,
	title,
	style,
	children,
}: {
	name: string;
	login?: string | null;
	size?: number;
	/** Draw the hairline around a photo. Off where the picture is one glyph in
	 *  a row of chrome and an edge reads as a second box. */
	edge?: boolean;
	className?: string;
	title?: string;
	style?: React.CSSProperties;
	children?: React.ReactNode;
}) {
	const login = loginProp?.trim() || githubLoginFor(name);
	const [failed, setFailed] = useState(false);
	useEffect(() => setFailed(false), [login]);
	const picture = !!login && !failed;
	return (
		<span
			className={cn(
				// The hairline separates a photo from the surface behind it. The
				// initial fallback is already its own flat tile, so it takes no
				// edge — the variable stays defined (transparent) because callers
				// compose it into a larger box-shadow (TeamPresence's pile ring).
				picture && edge
					? "[--avatar-edge:inset_0_0_0_1px_color-mix(in_srgb,var(--text)_14%,transparent)]"
					: "[--avatar-edge:0_0_0_0_transparent]",
				"relative inline-flex shrink-0 items-center justify-center",
				"rounded-[32%] bg-active font-bold text-dim shadow-[var(--avatar-edge)] select-none",
				className,
			)}
			style={{
				width: size,
				height: size,
				fontSize: Math.max(9, Math.round(size * 0.46)),
				...style,
			}}
			title={title}
		>
			{picture ? (
				<img
					src={`https://github.com/${login}.png?size=${size * 2}`}
					alt={name}
					className="absolute inset-0 size-full rounded-[inherit] object-cover shadow-[var(--avatar-edge)]"
					loading="lazy"
					draggable={false}
					onError={() => setFailed(true)}
				/>
			) : (
				name.charAt(0).toUpperCase()
			)}
			{children}
		</span>
	);
}
