/**
 * The support conversation's surfaces — a Plain thread as it renders in the
 * ticket pane, the workspace Conversation tab and the swipe deck.
 *
 * Every block here used to be drawn inside a hairline: a message, a note, an
 * attachment and each action all carried a box of their own, so a thread was
 * four nested outlines deep on a page whose only job is to be read.
 * `src/frontend/AGENTS.md` has the rule — a block sitting on its own fill is
 * already separated from the page, and an edge around it adds a second one. So
 * a message is a plate, a note takes the yellow wash the transcript already
 * gives a team note (lib/tinted-surface.ts), and the actions are the Button
 * primitive at its quiet weight.
 *
 * Both sides of the thread take the SAME plate. Who spoke is the name on the
 * message and the edge it hugs, the way the transcript tells your own turn
 * from an answer; a second fill for our own replies would say it a third time,
 * in colour, across the half of the thread that is mostly autoresponder.
 */

/** Shared shape. The corner is the note bubble's (`rounded-2xl` at this
 *  padding), because a support message is that block, not a chat tail. */
const ENTRY = "flex max-w-[86%] flex-col gap-1 rounded-2xl bg-panel px-4 py-3";

/** A message from the customer. */
export const plainEntryIn = `${ENTRY} self-start`;

/** A message from our side: a teammate's reply, the autoresponder, an agent. */
export const plainEntryOut = `${ENTRY} self-end`;

/** An internal note. Full width and washed rather than plated, so it reads as
 *  an aside on the thread instead of another message in it. The wash itself is
 *  inline: `color-mix` on a token can't be a compiled utility. */
export const plainEntryNote = "flex flex-col gap-1 rounded-2xl px-4 py-3";

/** The name / channel / time line over a message. Mirrored on our own side so
 *  the name lands on the edge the message hugs — the transcript's own rule for
 *  a speaker label (lib/msg-classes.ts). */
export const plainEntryHead = "flex flex-wrap items-baseline gap-x-2 gap-y-0.5";

/** Who spoke. */
export const plainEntryName = "text-supporting font-semibold text-fg";

/** Channel and time, in one faint run: two separate spans read as two facts
 *  when they are one aside. */
export const plainEntryMeta = "text-meta text-faint";

/** The message itself, at the transcript's reading size — this is the page's
 *  content, not a preview of it. */
export const plainEntryBody =
	"whitespace-pre-wrap break-words text-body leading-relaxed text-fg";
