/**
 * One per-user flat-file store, spelled once. Pins, read marks, lanes,
 * snoozes, hides, tab colors, UI prefs and personal prompts are the same
 * thing: one JSON file per person under `~/.opensession-<name>/`, holding a
 * single field. They used to be seven copies of that code, and the copies
 * disagreed about the two things that matter, so one person's pins and drafts
 * could land in differently-named files.
 *
 * The rules this owns, so no store can answer them differently:
 *
 * - THE FILENAME: `<sanitized>-<sha256 of the lowercased identity>.json`, the
 *   spelling drafts.ts already uses. Two display names that differ only in
 *   characters a filename can't hold ("a/b" and "a_b") can no longer share
 *   one file, and case variants of a name are one person, as in drafts.
 * - THE DIRECTORY, resolved per call and never pinned at module load: a test
 *   or a dev instance that repoints OPENSESSION_STATE_DIR must not keep
 *   reading and writing the live operator's state.
 * - READING THE LOSING SPELLINGS. Every one of these stores holds live state
 *   written under an older filename, so a read that finds no canonical file
 *   falls back to the legacy names before giving up: the plain sanitized slug
 *   (pins, reads, lanes, snoozes, hides, tab colors, UI prefs) and the
 *   identity verbatim (personal prompts' `user-<slackId>`). The first write
 *   after this lands on the canonical name and wins from then on; the legacy
 *   file is left in place rather than deleted, so nothing is lost if the
 *   change is rolled back.
 *
 * WHO the identity is stays per store, because that is a real difference and
 * not an accident: most key on the self-selected display name, personal
 * prompts resolves the teammate first so a person's prompt follows them
 * across surfaces.
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { writeJsonAtomic } from "./atomic-write";
import { stateDir } from "../paths";

/** Identity → the filename stem every store writes (mirrors drafts.ts). */
function canonicalName(identity: string): string {
	const normalized = identity.trim() || "Anonymous";
	const cleaned = normalized.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40);
	const hash = createHash("sha256")
		.update(normalized.toLocaleLowerCase())
		.digest("hex")
		.slice(0, 16);
	return `${cleaned || "Anonymous"}-${hash}`;
}

/** A name safe to read back verbatim: no separators, no traversal. */
const SAFE_VERBATIM = /^[A-Za-z0-9@._-]+$/;

/** Filename stems these stores wrote before canonicalName; read-only. */
function legacyNames(identity: string): string[] {
	const normalized = identity.trim() || "Anonymous";
	const slug =
		normalized.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "Anonymous";
	const names = [slug];
	if (
		normalized !== slug &&
		SAFE_VERBATIM.test(normalized) &&
		!normalized.includes("..")
	) {
		names.push(normalized);
	}
	return names;
}

export interface UserStore<T> {
	/** The store's directory, resolved per call. */
	dir(): string;
	/** This user's state, or the empty value when they have none. */
	get(user: string): T;
	/** Replace this user's state. Returns what was stored. */
	set(user: string, value: unknown): T;
}

export function userStore<T>(options: {
	/** State-dir base: "pins" → `~/.opensession-pins`. */
	name: string;
	/** The single top-level field in the file: `{ [field]: value }`. */
	field: string;
	/**
	 * Validate and normalize both what is read and what is written. Called
	 * with `undefined` for a missing file, so it also defines the empty value.
	 */
	clean: (raw: unknown) => T;
	/**
	 * Which person this is. `null` means "no one": reads answer empty and
	 * writes are dropped. Defaults to the trimmed user name.
	 */
	identity?: (user: string) => string | null;
	/** Extra top-level fields stamped on every write. */
	extra?: () => Record<string, unknown>;
}): UserStore<T> {
	const { name, field, clean, extra } = options;
	const identity = options.identity ?? ((user: string) => user ?? "");
	const dir = () => stateDir(name);

	return {
		dir,
		get(user) {
			const id = identity(user);
			if (id === null) return clean(undefined);
			const root = dir();
			// The first file that EXISTS answers, even when it holds an empty
			// value: a user who cleared their pins must not have the legacy
			// copy resurrect them.
			for (const stem of [canonicalName(id), ...legacyNames(id)]) {
				const file = `${root}/${stem}.json`;
				if (!existsSync(file)) continue;
				try {
					return clean(JSON.parse(readFileSync(file, "utf8"))?.[field]);
				} catch {
					return clean(undefined);
				}
			}
			return clean(undefined);
		},
		set(user, value) {
			const id = identity(user);
			if (id === null) return clean(undefined);
			const cleaned = clean(value);
			const root = dir();
			try {
				if (!existsSync(root)) mkdirSync(root, { recursive: true });
				writeJsonAtomic(`${root}/${canonicalName(id)}.json`, {
					[field]: cleaned,
					...extra?.(),
				});
			} catch {}
			return cleaned;
		},
	};
}
