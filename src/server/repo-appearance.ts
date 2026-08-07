/**
 * Per-repo tile appearance: the chosen color, and the icon behind
 * /repo-icon/<id>.png.
 *
 * A repo with no icon of its own wears a colored letter (see
 * repo-tile-colors.ts). This is how that gets overridden by hand from
 * Settings → Setup: pick one of the palette colors, or give the repo real art.
 *
 * Art can be fetched from GitHub — a repo has no avatar of its own there, so
 * what's available is its OWNER's. That used to be the automatic fallback for
 * every repo, which is exactly what made every repo in one org wear the same
 * tile; as a per-repo choice it's fine, because someone decided this repo
 * should be the one wearing it.
 *
 * Fetched art is stored in the instance state dir rather than the checkout:
 * it's instance configuration, and a worktree is not ours to write into.
 */

import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from "fs";
import { configuredRepos } from "./config";
import { persistRawConfig, rawConfig, withConfigMutationLock } from "./config-mutation";
import { stateDir } from "./paths";
import { REPO_TILE_COLORS } from "./repo-tile-colors";

/** Where fetched icons live: ~/.opensession-repo-icons/<id>.png. */
export function repoIconPath(id: string): string {
	return `${stateDir("repo-icons")}/${id}.png`;
}

/** A stored icon's mtime, for cache-busting the tile after a change. */
export function repoIconRevision(iconPath: string | undefined): number | null {
	if (!iconPath || !existsSync(iconPath)) return null;
	try {
		return Math.floor(statSync(iconPath).mtimeMs);
	} catch {
		return null;
	}
}

export class RepoAppearanceError extends Error {}

/** Only palette colors: a free-form hex would let a tile fight the UI. */
function validColor(color: string): boolean {
	return REPO_TILE_COLORS.includes(color.toLowerCase());
}

async function fetchOwnerAvatar(owner: string): Promise<Uint8Array> {
	const res = await fetch(
		`https://github.com/${encodeURIComponent(owner)}.png?size=256`,
		{ redirect: "follow", signal: AbortSignal.timeout(10_000) },
	);
	if (!res.ok) {
		throw new RepoAppearanceError(
			`GitHub returned ${res.status} for ${owner}'s avatar`,
		);
	}
	const bytes = new Uint8Array(await res.arrayBuffer());
	if (!bytes.length) {
		throw new RepoAppearanceError(`${owner}'s avatar came back empty`);
	}
	return bytes;
}

export interface RepoAppearancePatch {
	/** A palette color, or null to go back to the assigned one. */
	color?: string | null;
	/** "github" fetches the owner's avatar; null drops the icon. */
	icon?: "github" | null;
}

/**
 * Apply a patch and persist it. Returns what the repo ended up with, so the
 * caller doesn't have to re-read the config to answer the request.
 */
export async function updateRepoAppearance(
	id: string,
	patch: RepoAppearancePatch,
): Promise<{ color: string | null; hasIcon: boolean; iconRev: number | null }> {
	const repo = configuredRepos()[id];
	if (!repo) throw new RepoAppearanceError(`Unknown repository: ${id}`);
	if (patch.color != null && !validColor(patch.color)) {
		throw new RepoAppearanceError("Color must be one of the tile colors");
	}

	// The network fetch happens BEFORE the config lock: it's the slow, failable
	// half, and a failed download shouldn't hold every other config write.
	let fetched: Uint8Array | null = null;
	if (patch.icon === "github") {
		const owner = repo.ghRepo?.split("/")[0];
		if (!owner) {
			throw new RepoAppearanceError(
				`${id} has no GitHub repository configured to take an avatar from`,
			);
		}
		fetched = await fetchOwnerAvatar(owner);
	}

	const iconPath = repoIconPath(id);
	if (fetched) {
		mkdirSync(stateDir("repo-icons"), { recursive: true });
		writeFileSync(iconPath, fetched);
	} else if (patch.icon === null && existsSync(iconPath)) {
		rmSync(iconPath, { force: true });
	}

	return withConfigMutationLock(async () => {
		const config = rawConfig();
		const repos = (config.repos ??= {}) as Record<string, Record<string, unknown>>;
		const section = (repos[id] ??= {});

		if (patch.color !== undefined) {
			if (patch.color === null) delete section.color;
			else section.color = patch.color.toLowerCase();
		}
		if (patch.icon !== undefined) {
			// Clearing only drops what we manage. A repo pointed at art inside
			// its own checkout keeps it — that's a config choice, not ours to
			// undo from a settings toggle.
			if (patch.icon === null) delete section.icon;
			else section.icon = iconPath;
		}
		persistRawConfig(config);

		const now = configuredRepos()[id];
		const resolved = resolveRepoIcon(now?.icon, now?.repo);
		return {
			color: (now?.color as string | undefined) ?? null,
			hasIcon: !!resolved,
			iconRev: repoIconRevision(resolved),
		};
	});
}

/** A repo's icon as an absolute path, or undefined when it has none. */
export function resolveRepoIcon(
	icon: string | undefined,
	checkout: string | undefined,
): string | undefined {
	if (!icon) return undefined;
	const path = icon.startsWith("/") ? icon : `${checkout}/${icon}`;
	return existsSync(path) ? path : undefined;
}
