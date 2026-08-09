/**
 * The two floating action buttons — what used to be `mobile-fab` and
 * `desk-fab` in legacy.css.
 *
 * They are a pair, and the numbers only make sense read together: on a phone
 * the new-session + sits 12px from the right edge at 58px across, and the Desk
 * trigger sits one 12px gutter further in — which is why its phone `right` is
 * still spelled `calc(12px + 58px + 12px)` rather than the 82px it resolves
 * to. Both ride z-500: above the content, below the action sheet (4000) and
 * the palettes (6000).
 *
 * Every phone value is a `phone:` variant rather than an unprefixed base with
 * a `desktop:` undo. The Desk FAB genuinely has two looks (a quiet 44px
 * outline on desktop, a 58px shadowed twin of the + on phones) and the
 * new-session + does not exist above the breakpoint at all, so writing the
 * phone look as the base would leave desktop reading values it never had.
 *
 * `rounded-full` is deliberate on both, and is the one radius spelling that
 * opts OUT of the app's squircle: these were authored as a bare
 * `border-radius: 50%`, i.e. a true circle, not a scaled corner. Anything in
 * the chrome that squircles wants `rounded-[999px]` instead.
 */

/**
 * Phones only: the new-session + in the thumb corner of the root list.
 * App.tsx already gates it on `!mobileDetail`; `hidden` covers desktop, where
 * the sidebar's own + does the job.
 */
export const MOBILE_FAB =
	"hidden phone:fixed phone:right-3 phone:bottom-[calc(18px+env(safe-area-inset-bottom,0px))] " +
	"phone:z-500 phone:flex phone:size-[58px] phone:items-center phone:justify-center " +
	"phone:rounded-full phone:border-none phone:bg-accent phone:text-on-accent " +
	"phone:shadow-[0_6px_20px_rgba(0,0,0,0.3),0_2px_6px_rgba(0,0,0,0.18)] " +
	"phone:transition-transform phone:active:scale-[0.92]";

/**
 * The ⌘J Desk trigger. Desktop lifts it a pixel and warms the glyph on hover;
 * phones cancel the lift (there is no pointer to lift under) and swap it for
 * the same press tick the + uses. `transition` lists the properties the states
 * actually move — `scale` and `translate` are their own properties in Tailwind
 * v4, so a bare `transform` in the list would animate neither.
 */
export const DESK_FAB =
	"fixed right-[18px] bottom-[18px] z-500 flex size-11 items-center justify-center " +
	"rounded-full border border-line bg-panel text-dim " +
	"shadow-[0_1px_2px_rgba(0,0,0,0.08),0_2px_6px_rgba(0,0,0,0.08)] " +
	"transition-[color,translate,scale] hover:-translate-y-px hover:text-fg " +
	"phone:right-[calc(12px+58px+12px)] phone:bottom-[calc(18px+env(safe-area-inset-bottom,0px))] " +
	"phone:size-[58px] phone:text-fg " +
	"phone:shadow-[0_6px_20px_rgba(0,0,0,0.3),0_2px_6px_rgba(0,0,0,0.18)] " +
	"phone:hover:translate-y-0 phone:active:scale-[0.92]";
