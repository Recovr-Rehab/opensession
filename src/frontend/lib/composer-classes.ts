/**
 * Shared Tailwind class maps for the composer family (the `composer-*` block
 * that used to live in styles/legacy.css).
 *
 * Two rules shaped how these are written, and breaking either one fails
 * silently — no build error, just the wrong pixels:
 *
 * 1. **Every class is spelled out in full, literal text.** Tailwind scans
 *    source as text, so an interpolated class (`` `text-${tone}` ``) or one
 *    assembled from a constant is never generated. Add a variant by adding a
 *    literal entry here, never by building the string.
 * 2. **A base string carries geometry only; colour lives in the variant.** Two
 *    competing colour utilities on one element do not compose — the browser
 *    takes whichever Tailwind happened to emit last, not the one written last.
 *    Same for any pair that sets the same property (which is why the card's
 *    right padding is separate from the card itself: the composer needs room
 *    for a remove button, a transcript chip does not).
 */

/* ── The composer box ──────────────────────────────────────────────
   `.composer` stays on the markup as a hook: legacy.css still reaches through
   it into controls this family does not own (`.composer.composer-min
   .palette-icon-btn`, whose ::before wash is styled from the stylesheet, and
   `body.kb-open .viewer-input:has(.composer:not(.composer-min))`). The
   declarations below are what that rule used to paint. */
export const composerBox =
	"relative border border-[color:var(--composer-border)] bg-[var(--composer-surface)] shadow-[var(--composer-shadow)] transition-[border-color,box-shadow]";

/** Resting/expanded box. `--composer-inset-left` is read by the "+" menu to
 *  line its left edge up with the composer's outer edge rather than the
 *  button's, so it travels with the padding it describes. */
export const composerBoxExpanded =
	"rounded-[var(--composer-radius)] px-3.5 pt-3.5 pb-2.5 [--composer-inset-left:15px] max-[720px]:px-3 max-[720px]:pt-2.5 max-[720px]:pb-[9px] max-[720px]:[--composer-inset-left:13px]";

/** Phone resting pill: one row, even 4px inset, clear of the screen edges.
 *  Motion animates the radius between this and the expanded box; the class is
 *  here so a first paint (and any non-animated host) lands on the same shape. */
export const composerBoxMinimized =
	"mx-1.5 flex items-center gap-1 rounded-full p-1 [--composer-inset-left:5px]";

/* ── The draft field ──────────────────────────────────────────────
   `.composer-textarea` stays on the markup as a hook too: it is read as a
   class NAME by the sidebar swipe guard (lib/sidebar-swipe.ts) and by
   SessionViewer's keyboard handlers, which skip global shortcuts while the
   caret is in the composer.

   The mirror div that paints code tints behind the field (`.composer-hl`)
   shares these metrics exactly — any difference in font, padding or wrap
   desyncs the caret from the painted glyphs — so both read the same strings. */
export const composerTextarea =
	"block max-h-[320px] min-h-0 w-full resize-none border-none bg-transparent text-body leading-[1.55] outline-none max-[720px]:max-h-[240px] max-[720px]:text-[16px]";
export const composerTextareaPadding = "px-0 pt-0.5 pb-1";
/** In the resting pill the field is one row inside a 4px-inset box, so it
 *  carries the horizontal breathing room and no vertical padding at all. */
export const composerTextareaPaddingMinimized = "px-1 py-0";

/* ── Toolbar popover menus ─────────────────────────────────────────
   The popup surface for the "+" add menu and the send-later menu.
   `.composer-menu-item` / `.composer-menu-icon` are NOT migrated: SessionViewer
   renders rows into this menu (its `menuExtra`), so the row styling has to stay
   in the stylesheet until that file moves too. */
export const composerMenuPopup =
	"absolute bottom-[calc(100%+6px)] z-40 rounded-lg border border-line-strong bg-panel p-1 shadow-[0_8px_28px_rgba(0,0,0,0.28)]";
/** The menu's own floor width. Kept out of the surface above because a second
 *  `min-w-*` on the same element would not compose — the send-later menu is
 *  wider (it lists pending messages), and whichever Tailwind emitted last would
 *  win rather than the one written last. */
export const composerMenuWidth = "min-w-[172px]";
/** Default anchoring: the menu hangs off the right edge of its trigger. */
export const composerMenuAnchorRight = "right-0";
/** The "+" sits at the LEFT of the toolbar, so its menu grows rightward from
 *  the composer's outer left edge (not the button's — the toolbar lives inside
 *  the composer's padding, which left the menu inset and off-axis). */
export const composerMenuAnchorLeft =
	"left-[calc(-1*var(--composer-inset-left,17px))]";

/* ── The send disc ────────────────────────────────────────────────
   The one filled control in the toolbar and the one place a circle is right:
   it is the only control whose whole job is "commit this", and roundness is
   what keeps a full-strength fill from feeling heavy.

   Geometry only — each state below brings its own fill, ink and edge. The
   40px phone size is what the last of the three (!) competing phone blocks in
   legacy.css resolved to. */
export const composerSend =
	"inline-flex size-8 shrink-0 items-center justify-center rounded-full leading-none transition-[filter,border-radius,transform] enabled:hover:scale-105 disabled:cursor-default disabled:opacity-35 max-[720px]:size-10";
/** Ordinary send: the accent plate. Hover goes to ink rather than brightening —
 *  the accent is a wash now, and brightening it read as a disabled state. */
export const composerSendDefault =
	"bg-accent text-on-accent enabled:hover:bg-[color-mix(in_srgb,var(--text)_86%,var(--bg))]";
/** Busy + queue: a ring, not a plate. 2px because at 1px it read as a disabled
 *  send rather than a different one. */
export const composerSendQueue =
	"border-2 border-accent bg-raised text-accent enabled:hover:bg-[color-mix(in_srgb,var(--text)_86%,var(--bg))]";
/** Busy + steer: folds into the running turn, so it warns rather than commits.
 *  Saturated red brightens fine, which is why it keeps the filter hover. */
export const composerSendSteer =
	"border border-red bg-red-soft text-red enabled:hover:brightness-[1.12]";
/** Stop: the only full-strength red plate. */
export const composerSendStop =
	"bg-red text-white enabled:hover:brightness-[1.12]";
/** Inside the 50px resting pill a 40px disc is a blob against the hairline
 *  glyphs beside it. Keep the target, shrink the fill: padding plus
 *  background-clip paints a 32px disc without moving the hit area. */
export const composerSendMinimizedFill = "max-[720px]:bg-clip-content max-[720px]:p-1";

/* ── File attachment chips ────────────────────────────────────────
   Shared by the composer's staged attachments (removable) and a user turn's
   download chips in the transcript (a link). The right padding is deliberately
   not part of the card: the composer needs room for its × button. */
export const fileChipRow = "mb-2 flex flex-wrap gap-2";
export const fileChipCard =
	"relative inline-flex max-w-[240px] items-center gap-[9px] rounded-lg border border-line-strong bg-[var(--bg-hover)] py-1.5 pl-1.5";
/** Composer: leaves room for the absolutely-placed remove button. */
export const fileChipCardPaddingRemovable = "pr-[26px]";
/** Transcript: nothing to remove there, and `.msg-file-card` asked for 10px —
 *  but that rule sat ABOVE `.composer-file-card`'s padding shorthand in the
 *  stylesheet at equal specificity, so it never applied. This keeps what the
 *  chip has always rendered; closing it up is a design change, not a migration. */
export const fileChipCardPadding = "pr-[26px]";
export const fileChipThumb =
	"inline-flex size-[34px] shrink-0 items-center justify-center rounded-control bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[10px] font-bold tracking-[0.02em] text-accent";
export const fileChipMeta = "flex min-w-0 flex-col gap-px";
/** The chip's title. 13px (text-label) rather than the stylesheet's off-scale
 *  12px — it is interface copy, and the card's height comes from the 34px
 *  badge, so nothing reflows. */
export const fileChipName = "truncate text-label text-fg";
export const fileChipSub = "text-meta text-faint";
