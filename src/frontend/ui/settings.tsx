import * as React from "react";
import { Card, CardList } from "./card";
import { cn } from "./cn";
import { fieldClasses } from "./input";

export function SettingsPanel({
	className,
	...props
}: React.ComponentPropsWithoutRef<"div">) {
	return <div className={cn("w-full max-w-[720px]", className)} {...props} />;
}

/**
 * A settings page's header: its title, an optional sentence of context, and
 * optional actions on the right. Every panel opens with one, so pages share a
 * top rhythm no matter who wrote them. The h1 hides inside the phone sheet,
 * which already names the section in its own nav bar.
 */
export function SettingsHeader({
	title,
	description,
	actions,
	className,
	...props
}: Omit<React.ComponentPropsWithoutRef<"header">, "title"> & {
	title: React.ReactNode;
	description?: React.ReactNode;
	actions?: React.ReactNode;
}) {
	return (
		<header
			className={cn("mb-5 flex items-start justify-between gap-4 px-5", className)}
			{...props}
		>
			<div className="min-w-0">
				<h1 className="m-0 text-page-title font-bold tracking-[-0.02em] text-fg [.settings-sheet_&]:hidden">
					{title}
				</h1>
				{description && (
					<p className="m-0 mt-1.5 text-supporting leading-relaxed text-dim [.settings-sheet_&]:mt-0">
						{description}
					</p>
				)}
			</div>
			{actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
		</header>
	);
}

/**
 * The label above a group of settings, with optional actions on its right —
 * the group's own "add"/"refresh" buttons. Pages kept re-deriving that row
 * (a flex override here, a local `SectionHeader` there), which is how the
 * groups drifted apart; the slot keeps one shape.
 */
export function SettingsGroupLabel({
	actions,
	className,
	children,
	...props
}: React.ComponentPropsWithoutRef<"div"> & { actions?: React.ReactNode }) {
	return (
		<div
			className={cn(
				// mt-9: a group's card and the hint under it read as one block, so
				// the space above the next label is what separates the groups.
				"mb-2 mt-9 flex min-h-6 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 px-5 text-label font-semibold text-faint",
				className,
			)}
			{...props}
		>
			<span className="min-w-0">{children}</span>
			{actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
		</div>
	);
}

/** The surface every settings group sits on: a soft fill, no border. The fill
 * alone separates a group from the page, so a page of settings reads as a few
 * quiet blocks rather than a stack of outlined boxes.
 *
 * Card supplies the borderless part now, so all this adds is the corner and the
 * fill. A settings group is a CONTAINER of rows rather than a single card, and
 * the scale gives a container the largest step: `rounded-2xl` (22px × --rf), the
 * same corner the phone sheet's section list already carries.
 *
 * The fill is `settings-plate`, not `raised`: a page of these is a column of
 * blocks, and at the full L1 grey the column reads as the page's material
 * rather than as a few quiet groups on paper. See base.css. */
const settingsSurface = "rounded-2xl bg-settings-plate";

export function SettingCard({
	className,
	...props
}: React.ComponentPropsWithoutRef<"div">) {
	return <CardList className={cn(settingsSurface, className)} {...props} />;
}

/** A section for content that isn't a list of rows — an editor, a picker, a
 * filter bar. Same surface SettingCard gives rows, so a page of prose sits in
 * the page's rhythm instead of floating on it. */
export function SettingsSection({
	className,
	...props
}: React.ComponentPropsWithoutRef<"div">) {
	return <Card className={cn(settingsSurface, "p-5", className)} {...props} />;
}

/**
 * One setting: its label and description on the left, its control on the
 * right. On a narrow screen the control drops to its own line instead of
 * squeezing the label into a two-word column — `flex-wrap` plus the text's
 * min width is what decides that, and the control's `ml-auto` keeps it
 * right-aligned once it lands there.
 *
 * Rows are centered, which is right while the text is a title and one line of
 * description. A row that grows past that (an account with usage bars) should
 * pass `items-start`: an avatar and a control floating in the middle of a tall
 * row read as unanchored, and top-aligning ties them to the title they belong
 * to.
 */
export function SettingRow({
	className,
	...props
}: React.ComponentPropsWithoutRef<"div">) {
	return (
		<div
			className={cn("flex flex-wrap items-center gap-x-4 gap-y-2.5 px-5 py-4", className)}
			{...props}
		/>
	);
}

export function SettingRowText({
	className,
	...props
}: React.ComponentPropsWithoutRef<"div">) {
	return <div className={cn("min-w-0 flex-1 max-sm:min-w-[55%]", className)} {...props} />;
}

export function SettingRowTitle({
	className,
	...props
}: React.ComponentPropsWithoutRef<"div">) {
	return <div className={cn("text-item-title font-medium text-fg", className)} {...props} />;
}

export function SettingRowDescription({
	className,
	...props
}: React.ComponentPropsWithoutRef<"div">) {
	return <div className={cn("mt-0.5 text-supporting text-dim", className)} {...props} />;
}

export function SettingRowControl({
	className,
	...props
}: React.ComponentPropsWithoutRef<"div">) {
	return <div className={cn("ml-auto shrink-0", className)} {...props} />;
}

/**
 * A row's state, read before its actions: a dot and a word. Connected rows
 * carry one and unconnected rows carry a Connect button, which is what keeps
 * the two apart at a glance. A row whose only difference is the verb on a
 * neutral button ("Connect" vs "Disconnect") reads as the same row twice.
 */
export function StatusChip({ label, dot }: { label: string; dot: string }) {
	return (
		<span className="flex flex-shrink-0 items-center gap-1.5 text-label text-dim">
			<span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} />
			{label}
		</span>
	);
}

/** The ⋯ trigger for a row's overflow menu: quiet until hovered or open.
 *  Shared so a row's actions look the same on every settings page.
 *
 *  `before:-inset-2` grows the 28px box to a 44px target without moving
 *  anything, which a row whose only path to an action is this menu needs on a
 *  phone. It is the last thing in the row, so the grown area overlaps only the
 *  status text beside it. */
export const rowMenuTriggerClasses =
	"relative flex size-7 shrink-0 items-center justify-center rounded-md text-faint transition-[color,background] before:absolute before:-inset-2 before:content-[''] hover:bg-hover hover:text-fg data-[popup-open]:bg-hover data-[popup-open]:text-fg";

export function SettingsHint({
	className,
	...props
}: React.ComponentPropsWithoutRef<"div">) {
	return <div className={cn("mt-2 px-5 text-meta text-faint", className)} {...props} />;
}

/**
 * Settings fields are the app's fields — `ui/input`'s recipe, not a local one.
 * These aliases stay because ~20 call sites pass a class rather than render a
 * component (native selects with their own appearance resets, mostly); the
 * shape behind them is now shared with every other field and, through it, with
 * every button.
 *
 * They go through `fieldClasses("md")` rather than composing `fieldClass` with
 * their own padding, which is what had settings rendering 35px fields beside
 * the primitive's 32px ones — two field heights visible on one page, e.g.
 * /settings/connections. Reaching for the size step instead of re-spelling it
 * is the whole point of having one.
 */
export const settingsSelectClass = fieldClasses("md", "cursor-pointer");

export function SettingsForm({
	className,
	...props
}: React.ComponentPropsWithoutRef<"div">) {
	return (
		<div
			className={cn(settingsSurface, "mb-3 flex flex-col gap-3.5 p-5", className)}
			{...props}
		/>
	);
}

export function SettingsFormTitle({
	className,
	...props
}: React.ComponentPropsWithoutRef<"div">) {
	return <div className={cn("mb-4 text-item-title font-semibold text-fg", className)} {...props} />;
}

export function SettingsFormRow({
	className,
	...props
}: React.ComponentPropsWithoutRef<"div">) {
	return <div className={cn("grid grid-cols-2 gap-3 max-sm:grid-cols-1", className)} {...props} />;
}

export function SettingsField({
	className,
	...props
}: React.ComponentPropsWithoutRef<"label">) {
	return (
		<label
			className={cn("mb-3 flex min-w-0 flex-col gap-1.5 text-label font-medium text-dim", className)}
			{...props}
		/>
	);
}

export const settingsInputClass = fieldClasses("md");

/** Multi-line text entry inside settings — memory entries, the personal
 *  prompt. One class so every editor in settings reads the same. */
export const settingsTextareaClass = fieldClasses("md", "resize-y py-2");

export function SettingsFormActions({
	className,
	...props
}: React.ComponentPropsWithoutRef<"div">) {
	return <div className={cn("mt-1 flex justify-end gap-2", className)} {...props} />;
}
