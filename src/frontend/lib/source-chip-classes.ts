import type { SessionSource } from "./types";

/**
 * Source chips — the small pill naming where a session came from (slack,
 * linear, ask), plus the neutral variants the automation link and the
 * "Archived" button wear.
 *
 * The tone is a LOOKUP, not a built class name. The markup used to spell
 * `` `source-chip source-${session.source}` ``, which works for a stylesheet
 * but cannot work for utilities: Tailwind only compiles class names it can
 * find in the source, so a name assembled at runtime compiles to nothing at
 * all. Every tone below is a literal string for that reason — do not
 * reintroduce interpolation here.
 *
 * The tints themselves are tokens in base.css (`--chip-*`), so they re-tone
 * for the light theme on their own; see the note there.
 */
export const SOURCE_CHIP =
	"shrink-0 rounded-full px-2 py-0.5 text-meta font-bold tracking-[-0.01em]";

/** Neutral pill — the origins that get no hue of their own. */
const NEUTRAL = "bg-active text-dim";

const TONE: Record<string, string> = {
	slack: "bg-[var(--chip-slack-bg)] text-[var(--chip-slack-fg)]",
	linear: "bg-[var(--chip-linear-bg)] text-[var(--chip-linear-fg)]",
	ask: "bg-[var(--chip-ask-bg)] text-[var(--chip-ask-fg)]",
	cli: NEUTRAL,
};

/**
 * The tone for a session origin. `opensession` deliberately resolves to no
 * tone: the chip is only rendered for origins that are worth calling out, and
 * an untinted chip is what the app shipped. (The teal `.source-backstage`
 * rule this replaced had been unreachable since the rename — no session
 * carries that source any more.)
 */
export function sourceChipTone(source: SessionSource | "ask" | string): string {
	return TONE[source] ?? "";
}

/** The automation chip: a neutral pill that is also a link, so it needs the
 *  hover it had and a cap on how much width a long automation name may take. */
export const SOURCE_CHIP_AUTOMATION =
	`${NEUTRAL} max-w-[160px] truncate no-underline transition-[background,color] ` +
	"duration-[var(--dur-micro)] ease-[var(--ease)] hover:bg-hover hover:text-fg";

/** The "Archived" chip in the session header — a button, so it carries a
 *  pressed/disabled story the display-only chips don't. Its own padding and
 *  size deliberately override SOURCE_CHIP's: it is a tap target, not a label. */
export const SOURCE_CHIP_ARCHIVED =
	"cursor-pointer px-2.5 py-[3px] text-meta leading-[1.2] transition-[background,color] " +
	"duration-[var(--dur-micro)] ease-[var(--ease)] [&:hover:not(:disabled)]:bg-hover " +
	"[&:hover:not(:disabled)]:text-fg disabled:cursor-default disabled:opacity-60";
