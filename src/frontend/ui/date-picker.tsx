import * as React from "react";
import { IconCalendar, IconChevronLeft, IconChevronRight } from "../components/icons";
import {
	addDays,
	addMonths,
	clampDay,
	dayInMonth,
	dayOfMonth,
	formatDay,
	formatDayLong,
	isIsoDay,
	isSameMonth,
	isWithin,
	monthGrid,
	monthTitle,
	rangeSpanAt,
	startOfMonth,
	todayIsoDay,
	weekdayHeadings,
	weekStartFor,
	type IsoDay,
	type RangeSpan,
} from "../lib/date-grid";
import { Button } from "./button";
import { cn } from "./cn";
import { Popover } from "./popover";

/**
 * Date field: a `YYYY-MM-DD` day, shown the way the reader writes dates and
 * picked from our own calendar.
 *
 * It replaces `<input type="date">`, which is the one control in the app the
 * browser drew for us: a system calendar with system blue, system corners, a
 * system focus ring and Clear/Today in the browser's language, dropped into a
 * page that shares none of that. It also read the day in LOCAL time while
 * every range in the app is UTC days, so the field and the chart it filtered
 * could disagree by one day.
 *
 * The trigger keeps the shape it had as an input: `rounded-control` and a
 * hairline, matching the segmented control it sits beside in the Analytics
 * header. An input is one of the few things that genuinely is an edge, and
 * this is still a field. It just opens our popup instead of the browser's.
 *
 * A field can be told about the whole range it belongs to (`rangeStart` /
 * `rangeEnd`), and paints the span behind the days between them. Two fields
 * pointed at one range then read as one control: opening either end shows what
 * is currently selected rather than a lone highlighted day.
 */

type DateFieldProps = {
	/** The day in effect, `YYYY-MM-DD`. */
	value: IsoDay;
	onValueChange: (value: IsoDay) => void;
	/** Accessible name for the field: "From date", "Start". */
	label: string;
	/** Inclusive bounds. Days outside them are shown, dimmed, and unpickable:
	 *  taking them out would reflow the grid month to month. */
	min?: IsoDay;
	max?: IsoDay;
	/** The range this field is one end of, painted behind the days between. */
	rangeStart?: IsoDay;
	rangeEnd?: IsoDay;
	className?: string;
};

export function DateField({
	value,
	onValueChange,
	label,
	min,
	max,
	rangeStart,
	rangeEnd,
	className,
}: DateFieldProps) {
	const [open, setOpen] = React.useState(false);
	const has = isIsoDay(value);

	return (
		<Popover.Root open={open} onOpenChange={setOpen}>
			<Popover.Trigger
				// The date is the label a sighted reader gets, so it belongs in the
				// spoken one too: a bare "From date, button" says nothing about the
				// range being charted.
				aria-label={has ? `${label}, ${formatDay(value)}` : label}
				className={cn(
					"inline-flex cursor-pointer select-none items-center gap-1.5",
					"rounded-control border border-line bg-control px-2.5 py-1.5",
					"text-control-label text-fg whitespace-nowrap",
					// The phone step the segmented control beside it takes: a tap
					// box, and a size a date is comfortable to read at arm's length.
					"phone:px-3 phone:py-2 phone:text-item-title",
					"transition-[color,background-color,border-color] focus-ring",
					"hover:border-line-strong data-[popup-open]:border-line-strong",
					className,
				)}
			>
				{/* Support, not the label: the date is what is being read. */}
				<IconCalendar size={20} className="shrink-0 opacity-55" />
				<span className="[text-box:trim-both_cap_alphabetic]">
					{has ? formatDay(value) : label}
				</span>
			</Popover.Trigger>
			<Popover.Popup align="end" sideOffset={6} initialFocus={false}>
				<Calendar
					value={value}
					min={min}
					max={max}
					rangeStart={rangeStart}
					rangeEnd={rangeEnd}
					label={label}
					onPick={(day) => {
						onValueChange(day);
						setOpen(false);
					}}
				/>
			</Popover.Popup>
		</Popover.Root>
	);
}

/**
 * The month grid. Focus is roving, the way a date grid is expected to work:
 * the calendar is one tab stop, arrows walk days and weeks, and PageUp/PageDown
 * page months (Shift for years). Only the focused day is tabbable, so Tab
 * leaves the grid rather than walking 42 cells.
 *
 * The month on show (`anchor`) is deliberately NOT derived from the focused
 * day. Chromium focuses a button on mousedown, before the click: if the grid
 * re-anchored on focus, pressing a lead-in day from the neighbouring month
 * would page the calendar and unmount that very button, so the click never
 * landed and the press read as "the calendar jumped instead of picking".
 * Walking with the keyboard moves both; focus alone moves only the ring.
 */
function Calendar({
	value,
	min,
	max,
	rangeStart,
	rangeEnd,
	label,
	onPick,
}: {
	value: IsoDay;
	min?: IsoDay;
	max?: IsoDay;
	rangeStart?: IsoDay;
	rangeEnd?: IsoDay;
	label: string;
	onPick: (day: IsoDay) => void;
}) {
	const today = todayIsoDay();
	// Clamped: a value outside the bounds would put the grid's only tab stop on
	// a disabled cell, leaving the calendar unreachable by keyboard.
	const start = clampDay(isIsoDay(value) ? value : today, min, max);
	const [focused, setFocused] = React.useState<IsoDay>(start);
	const [anchor, setAnchor] = React.useState<IsoDay>(startOfMonth(start));
	// Which day the DOM should take focus to. Only a keyboard move sets it, so
	// paging with the chevrons leaves focus on the chevron.
	const pendingFocus = React.useRef<IsoDay | null>(null);
	const gridRef = React.useRef<HTMLDivElement | null>(null);

	const weekStart = React.useMemo(() => weekStartFor(), []);
	const headings = React.useMemo(() => weekdayHeadings(weekStart), [weekStart]);
	const weeks = React.useMemo(() => monthGrid(anchor, weekStart), [anchor, weekStart]);

	React.useEffect(() => {
		const want = pendingFocus.current;
		pendingFocus.current = null;
		// A move the bounds clamped back onto the current day never re-renders,
		// so the ref can outlive its move; only honour it while it still names
		// the focused day.
		if (!want || want !== focused) return;
		gridRef.current
			?.querySelector<HTMLButtonElement>(`[data-day="${want}"]`)
			?.focus();
	}, [focused]);

	// The grid opens with focus on the day in effect, so the keyboard lands
	// where the eye does. Base UI's own initialFocus can't reach a cell that
	// only exists once this component has rendered. Once per open: the popup
	// unmounts on close, so there is no later state for this to disagree with.
	React.useEffect(() => {
		gridRef.current
			?.querySelector<HTMLButtonElement>(`[data-day="${start}"]`)
			?.focus();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	/** A keyboard step: the ring and the month both follow the day. */
	function moveTo(day: IsoDay) {
		// Walking past a bound stops at it rather than doing nothing: the reader
		// asked to go that way, and the edge of the range is where that ends.
		const next = clampDay(day, min, max);
		if (next === focused) return;
		pendingFocus.current = next;
		setFocused(next);
		setAnchor(startOfMonth(next));
	}

	/** A chevron press: the month turns under the ring, focus stays put. */
	function pageMonth(delta: number) {
		const target = addMonths(anchor, delta);
		const day = clampDay(dayInMonth(target, dayOfMonth(focused)), min, max);
		setAnchor(startOfMonth(day));
		setFocused(day);
	}

	function onKeyDown(e: React.KeyboardEvent) {
		const step: Record<string, number> = {
			ArrowLeft: -1,
			ArrowRight: 1,
			ArrowUp: -7,
			ArrowDown: 7,
		};
		if (e.key in step) {
			e.preventDefault();
			moveTo(addDays(focused, step[e.key]));
			return;
		}
		if (e.key === "PageUp" || e.key === "PageDown") {
			e.preventDefault();
			const by = e.key === "PageUp" ? -1 : 1;
			moveTo(addMonths(focused, e.shiftKey ? by * 12 : by));
			return;
		}
		if (e.key === "Home" || e.key === "End") {
			e.preventDefault();
			const offset = (new Date(`${focused}T00:00:00Z`).getUTCDay() - weekStart + 7) % 7;
			moveTo(addDays(focused, e.key === "Home" ? -offset : 6 - offset));
		}
	}

	const title = monthTitle(anchor);
	// A step is only offered when some day in that month can be picked.
	const canGoBack = !min || min < anchor;
	const canGoForward = !max || max >= addMonths(anchor, 1);

	return (
		// Wider on a phone, where a day is a thumb target rather than a click:
		// 308px puts the columns on 44px, and still clears the 390px viewport.
		<div className="w-[252px] p-2.5 phone:w-[308px]" role="group" aria-label={label}>
			{/* The title sits on the grid's own left edge: the band under it
			    starts at the first cell, not at the first numeral. */}
			<div className="flex items-center justify-between gap-2 pb-1.5">
				{/* Live, because a chevron turns the month without moving focus. */}
				<div aria-live="polite" className="text-item-title font-semibold text-fg">
					{title}
				</div>
				<div className="flex items-center gap-0.5">
					<MonthStep
						label="Previous month"
						enabled={canGoBack}
						onStep={() => pageMonth(-1)}
						icon={<IconChevronLeft size={20} />}
					/>
					<MonthStep
						label="Next month"
						enabled={canGoForward}
						onStep={() => pageMonth(1)}
						icon={<IconChevronRight size={20} />}
					/>
				</div>
			</div>

			{/* Gapless columns: the range band has to run unbroken across a week,
			    so the air between days lives inside each cell, around the chip.
			    Each row is its own 7-column grid rather than one 42-cell grid,
			    because `role="grid"` wants real rows between it and its cells. */}
			<div ref={gridRef} role="grid" aria-label={title} onKeyDown={onKeyDown}>
				<div role="row" className="grid grid-cols-7">
					{headings.map((h) => (
						<span
							key={h.long}
							role="columnheader"
							aria-label={h.long}
							className="pb-1 text-center text-meta font-medium text-faint"
						>
							{/* The initial is decoration: every cell below announces its
							    own weekday, and a `title` here would raise the browser's
							    own tooltip over our popup. */}
							<span aria-hidden>{h.short}</span>
						</span>
					))}
				</div>
				{weeks.map((week) => (
					<div key={week[0]} role="row" className="grid grid-cols-7">
						{week.map((day, i) => (
							<Day
								key={day}
								day={day}
								selected={day === value}
								outside={!isSameMonth(day, anchor)}
								today={day === today}
								disabled={!isWithin(day, min, max)}
								tabbable={day === focused}
								span={rangeSpanAt(day, week, i, rangeStart, rangeEnd)}
								onPick={onPick}
								onFocus={() => setFocused(day)}
							/>
						))}
					</div>
				))}
			</div>
		</div>
	);
}

/**
 * A month chevron. It goes `aria-disabled` rather than `disabled` at the end
 * of the range: a real `disabled` attribute arriving on the button that
 * currently holds focus drops focus to the document, so paging to the last
 * available month would strand a keyboard user.
 */
function MonthStep({
	label,
	enabled,
	onStep,
	icon,
}: {
	label: string;
	enabled: boolean;
	onStep: () => void;
	icon: React.ReactNode;
}) {
	return (
		<Button
			variant="ghost"
			size="sm"
			aria-label={label}
			aria-disabled={enabled ? undefined : true}
			className="aria-disabled:pointer-events-none aria-disabled:opacity-40"
			onClick={() => enabled && onStep()}
			icon={icon}
		/>
	);
}

function Day({
	day,
	selected,
	outside,
	today,
	disabled,
	tabbable,
	span,
	onPick,
	onFocus,
}: {
	day: IsoDay;
	selected: boolean;
	outside: boolean;
	today: boolean;
	disabled: boolean;
	tabbable: boolean;
	span: RangeSpan;
	onPick: (day: IsoDay) => void;
	onFocus: () => void;
}) {
	const name = formatDayLong(day);
	return (
		// 36px row holding a 32px chip: the 4px is the air between weeks, and
		// the band takes exactly the chip's height so an endpoint fuses with the
		// span instead of standing a step taller than it.
		<div
			role="gridcell"
			aria-selected={selected}
			className="relative grid h-9 place-items-center phone:h-12"
		>
			{span && (
				<span
					aria-hidden
					className={cn(
						"pointer-events-none absolute inset-y-0.5 inset-x-0 bg-accent-soft",
						span.open && "rounded-l-md",
						span.close && "rounded-r-md",
					)}
				/>
			)}
			<button
				type="button"
				data-day={day}
				tabIndex={tabbable ? 0 : -1}
				disabled={disabled}
				// Screen readers read state off the focused element, and the
				// `aria-selected` above sits on the cell around it, so the day in
				// effect says so in its own name.
				aria-label={selected ? `${name}, selected` : name}
				aria-current={today ? "date" : undefined}
				onClick={() => onPick(day)}
				onFocus={onFocus}
				className={cn(
					"relative grid h-8 w-full cursor-pointer place-items-center rounded-md",
					"text-control-label tabular-nums phone:h-11 phone:text-item-title",
					"transition-[color,background-color] duration-[var(--dur-micro)] ease-[var(--ease)]",
					"focus-ring",
					// A day from the neighbouring month is context for the week it
					// completes, not an option being offered. It stays pickable,
					// because that is what the row is for.
					outside ? "text-faint" : "text-fg",
					// Today is marked by an edge rather than a fill: a second filled
					// day in the month would compete with the one that is selected.
					today && !selected && "font-semibold ring-1 ring-inset ring-line-strong",
					selected
						? "bg-accent text-on-accent font-semibold hover:bg-accent-hover"
						: "hover:bg-hover",
					"disabled:cursor-default disabled:text-faint disabled:opacity-45 disabled:hover:bg-transparent",
				)}
			>
				{dayOfMonth(day)}
			</button>
		</div>
	);
}
