/**
 * Transcript message classes — what used to be the `msg-*` family in
 * legacy.css.
 *
 * A message row is rendered from four surfaces (MessageBubble, SessionViewer's
 * optimistic and streaming bubbles, TurnBlock's intermediate replies, the Desk
 * pane), so the shared shapes live here instead of being re-typed — and
 * re-drifted — at each call site.
 *
 * A handful of `msg-*` names survive on the markup as bare hooks with no
 * styling of their own, because things OUTSIDE this migration name them:
 *
 *   · base.css's selection policy (`chrome isn't selectable, content is`)
 *     names .msg, .msg-label, .msg-body and .msg-system-text;
 *   · base.css's reduced-motion exceptions name `.msg-sending .msg-label-user`
 *     and `.msg-streaming .msg-body-assistant::after`;
 *   · useSessionScroll queries `.msg` and `.msg-user` to find turn boundaries.
 *
 * Drop one of those class names and copy/paste, the sending pulse or the
 * scroll-to-turn behaviour breaks silently, so they stay.
 */

/**
 * The shared reading column every row sits in. Flex — not block — because
 * WebKit paints selection as full-width bands across block gaps; a flex column
 * makes the highlight hug the words (same reason as .viewer-messages).
 */
const msgRowBase = "msg mx-auto flex w-full max-w-[var(--session-col)] flex-col";

/** A normal turn: assistant answer, user bubble, teammate reply. */
export const msgRow = `${msgRowBase} mb-4.5`;

/**
 * A centered notice pill. Tighter bottom margin than a turn, and no top margin
 * at all: flex margins don't collapse, so the previous row's 18px is the gap.
 */
export const msgSystemRow = `${msgRowBase} mb-3 text-center`;

/**
 * Your own and a teammate's turns start 4px lower — the old 22px collapsed
 * against the previous sibling's bottom margin, which flex margins don't do.
 */
export const msgOwnTurn = "mt-1";

/**
 * Speaker label. Right-aligned (row-reverse) so the identity dot lands on the
 * outer edge, mirroring the assistant side. The ::selection masks are WebKit
 * only: it paints a highlight over unselectable label text caught inside a
 * selection range, and a fully transparent background is ignored — 1% sticks.
 *
 * `before:content-none` is load-bearing while legacy.css still holds
 * `.msg-label::before` (the dot used to be a pseudo-element; it is a real span
 * now). Without it the kept .msg-label hook paints a second dot.
 */
export const msgLabel =
	"msg-label mb-1.25 flex flex-row-reverse items-center gap-1.75 text-meta font-semibold tracking-[-0.01em] text-faint before:content-none selection:bg-[rgba(0,0,0,0.01)] [&_*::selection]:bg-[rgba(0,0,0,0.01)]";

/** Identity dot in front of a label. No token: these two are identity marks
 *  (a person's own turns, a teammate stepping in), not palette colours. */
export const msgDotUser =
	"size-1.75 shrink-0 rounded-xs bg-[#5b7cfa] opacity-90";
export const msgDotHuman =
	"size-1.75 shrink-0 rounded-full bg-[linear-gradient(135deg,#28d3b4,#0f8f7a)]";

/** A teammate's reply routed back into the session — a warm teal, so it reads
 *  as someone else stepping in rather than the driver's own words. */
export const msgLabelHuman = "text-[#1f9e8a]";

/**
 * Prose body. Flex column for the same WebKit selection-band reason as the row.
 * Bubbles use `msgBubbleUser` / `msgBubbleHuman` instead, which stay block —
 * they have a surface of their own, so there is no gap to band-paint.
 */
export const msgBody =
	"msg-body flex flex-col items-stretch text-body leading-6 break-words";

/** Bubble bodies: shrink-wrapped to their words and hugging the right edge,
 *  capped short of the column so a long message still reads right-aligned. */
const msgBubble =
	"msg-body block max-w-[min(600px,90%)] self-end text-body leading-6 break-words text-fg";
export const msgBubbleUser = `${msgBubble} rounded-lg bg-panel px-3.5 py-2.5`;
export const msgBubbleHuman = `${msgBubble} rounded-row bg-[rgba(31,158,138,0.12)] px-3.5 py-2.25`;

/** Assistant prose. Block while streaming so the caret ::after (legacy.css,
 *  kept for base.css's reduced-motion exception) stays on the text's line. */
export const msgBodyStreaming =
	"msg-body msg-body-assistant block text-body leading-6 break-words text-fg";

/** The centered notice pill itself. */
export const msgSystemText =
	"msg-system-text inline-block max-w-[min(560px,100%)] self-center rounded-row bg-panel px-3.5 py-1.5 text-center text-meta leading-[1.45] text-faint";

/**
 * A toned notice reads as a sentence, not a banner: everything the server and
 * the runner write lands in this one pill, so "switched account and retried"
 * and "your run died 40 minutes ago" used to be typographically identical.
 */
export const msgSystemToned = "inline-flex items-start gap-1.5 text-left";

/** Inline attachments under a turn. Right-aligned inside a bubble's column. */
export const msgMedia = "mt-1.5 flex flex-wrap gap-2";

/** Short relative time in a label row (hover for the real one). */
export const msgTime =
	"ml-1.5 cursor-default text-meta font-medium tracking-normal text-faint";
