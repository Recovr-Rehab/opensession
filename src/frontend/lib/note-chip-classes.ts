/**
 * Inline @-mention chips in a shared note — what used to be the `note-chip`
 * family in legacy.css.
 *
 * Two surfaces render the same object and have to keep looking like one
 * thing: the CodeMirror widget that replaces `[label](kind:target)` in the
 * editor (components/NoteEditor.tsx) and the "Linked from" backlinks row
 * under it (components/Notes.tsx). Hence a shared module rather than a
 * className on either.
 *
 * NOTE_CHIP_TONE is spelled out one key at a time rather than built as
 * `note-chip-${kind}`, and that is the whole reason this file exists.
 * Tailwind compiles the class names it can FIND in the source, so a name
 * assembled at runtime compiles to nothing at all and the chip renders
 * unstyled — the same reason PR_DOT_TONE in lib/session-tab-classes.ts is a
 * literal lookup. scripts/css-audit.ts held the old rules back for exactly
 * this shape; a utility can never be a built string, so the interpolation had
 * to go before the rules could.
 *
 * The two theme-dependent inks are `light-dark()` rather than a pair of
 * `html[data-theme]` rules: base.css sets `color-scheme` per theme (and
 * theme.ts pins it inline), so one value covers both. The `session` tone
 * needed no such split — its old light override restated `var(--blue)`, which
 * is what it already resolved to in the dark sheet.
 */

/**
 * Shape, type and hit behaviour — every chip, both surfaces.
 *
 * `border` here is the WIDTH only; the colour belongs to the tone. The old
 * rule could open with `border: 1px solid transparent` and let a later rule
 * repaint it, but two border-colour utilities on one element are decided by
 * Tailwind's OUTPUT order rather than the order they are written in — a
 * `border-transparent` in this string beat every tone's edge and the chips
 * came out borderless. Each tone therefore carries its own colour, and this
 * carries no colour at all.
 */
export const NOTE_CHIP =
	"inline-flex cursor-pointer items-center gap-[3px] mx-px rounded-control border px-[7px] py-px align-baseline font-sans text-[12px] whitespace-nowrap hover:brightness-[1.15]";

/** Per-kind fill, ink and edge. Each entry carries its whole colour set. */
export const NOTE_CHIP_TONE: Record<"session" | "note" | "doc", string> = {
	session:
		"bg-blue-soft text-blue border-[color-mix(in_srgb,var(--blue)_30%,transparent)]",
	note: "bg-green-soft text-[color:light-dark(#1a7f37,#7ee094)] border-[rgba(63,185,80,0.3)]",
	doc: "bg-[rgba(163,113,247,0.14)] text-[color:light-dark(#6f42c1,#c4a6ff)] border-[rgba(163,113,247,0.3)]",
};
