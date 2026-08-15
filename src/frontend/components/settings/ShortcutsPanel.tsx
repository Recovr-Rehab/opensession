import { useEffect, useMemo, useRef, useState } from "react";
import { useShortcutsVersion } from "../../hooks/useShortcutBindings";
import { isApple } from "../../lib/platform";
import {
	chordFromEvent,
	commandsUsingChord,
	glyphsFor,
	isBindable,
	isShortcutCustomized,
	labelFor,
	resetAllShortcuts,
	resetShortcutBindings,
	setShortcutBindings,
	setShortcutRecording,
	shortcutBindings,
	shortcutCommand,
	shortcutKeys,
	SHORTCUT_COMMANDS,
	SHORTCUT_GROUPS,
	SHORTCUT_REFERENCE,
	type Chord,
	type ShortcutId,
} from "../../lib/shortcuts";
import { Button } from "../../ui/button";
import {
	SettingCard,
	SettingRow,
	SettingRowControl,
	SettingRowDescription,
	SettingRowText,
	SettingRowTitle,
	SettingsGroupLabel,
	SettingsHeader,
	SettingsHint,
	SettingsPanel,
	settingsInputClass,
} from "../../ui/settings";
import { Tooltip } from "../../ui/tooltip";
import { IconPencil, IconPlus, IconSearch, IconTrash } from "../icons";

/** How many chords one command may answer to. Two covers every default; the
 *  third is headroom for someone whose browser eats one of them. */
const MAX_BINDINGS = 3;

/** A keycap. Matches the palette's kbd treatment so a chord reads the same
 *  wherever it is shown. Unlike the palette's, this one stays on phones: the
 *  page is a reference and hiding the chords would empty it. */
function Keycap({ children }: { children: React.ReactNode }) {
	return (
		<kbd className="inline-flex min-w-6 items-center justify-center rounded-md border border-line-strong bg-hover px-1.5 py-0.5 font-sans text-meta text-dim">
			{children}
		</kbd>
	);
}

function ChordKeys({ keys }: { keys: string[] }) {
	return (
		<span className="flex items-center gap-1">
			{keys.map((key, i) => (
				<Keycap key={`${key}-${i}`}>{key}</Keycap>
			))}
		</span>
	);
}

/**
 * The live state while a chord is being captured.
 *
 * `index` is which binding is being replaced, or the length of the list when a
 * new one is being added. `held` mirrors the modifiers currently down so the
 * pill shows something as soon as ⌘ goes down, rather than staying blank until
 * the whole chord lands.
 */
interface Recording {
	id: ShortcutId;
	index: number;
	held: string[];
}

/** A captured chord that collides with another command, awaiting a decision. */
interface Conflict {
	id: ShortcutId;
	index: number;
	chord: Chord;
	takenBy: ShortcutId;
}

export function ShortcutsPanel() {
	const version = useShortcutsVersion();
	const [query, setQuery] = useState("");
	const [recording, setRecording] = useState<Recording | null>(null);
	const [conflict, setConflict] = useState<Conflict | null>(null);
	const [problem, setProblem] = useState<{
		id: ShortcutId;
		message: string;
	} | null>(null);
	// Where to put focus back when a capture ends, so the keyboard never lands
	// on the document after editing a row.
	const returnFocus = useRef<HTMLElement | null>(null);

	function stopRecording() {
		setRecording(null);
		const el = returnFocus.current;
		returnFocus.current = null;
		if (el?.isConnected) el.focus();
	}

	function beginRecording(id: ShortcutId, index: number, from: HTMLElement) {
		returnFocus.current = from;
		setConflict(null);
		setProblem(null);
		setRecording({ id, index, held: [] });
	}

	function commit(id: ShortcutId, index: number, chord: Chord) {
		const next = [...shortcutBindings(id)];
		next[index] = chord;
		setShortcutBindings(id, next);
	}

	// Capture the next chord. The listener runs in the capture phase at window,
	// so it sees the event before it descends to anything — including handlers
	// inside a Base UI popup, which stops propagation on the way back up. The
	// registry's recording flag is the backstop for any listener that reads the
	// event another way; between them, a keystroke aimed at the recorder can
	// never also run the command it is about to be bound to.
	useEffect(() => {
		if (!recording) return;
		setShortcutRecording(true);
		const { id, index } = recording;

		function heldModifiers(e: KeyboardEvent): string[] {
			const out: string[] = [];
			if (isApple ? e.metaKey : e.ctrlKey) out.push(isApple ? "⌘" : "Ctrl");
			if (isApple && e.ctrlKey) out.push("⌃");
			if (e.altKey) out.push(isApple ? "⌥" : "Alt");
			if (e.shiftKey) out.push(isApple ? "⇧" : "Shift");
			return out;
		}

		function onKeyDown(e: KeyboardEvent) {
			e.preventDefault();
			e.stopImmediatePropagation();
			if (e.key === "Escape") {
				stopRecording();
				return;
			}
			const chord = chordFromEvent(e);
			if (!chord) {
				// A modifier on its own: show it building up.
				const held = heldModifiers(e);
				setRecording((r) => (r ? { ...r, held } : r));
				return;
			}
			if (!isBindable(chord)) {
				setProblem({
					id,
					message: isApple
						? "Hold ⌘, ⌃, or ⌥ as part of the shortcut"
						: "Hold Ctrl or Alt as part of the shortcut",
				});
				setRecording((r) => (r ? { ...r, held: [] } : r));
				return;
			}
			const taken = commandsUsingChord(chord).filter((other) => other !== id);
			const first = taken[0];
			if (first) {
				setProblem(null);
				setConflict({ id, index, chord, takenBy: first });
				stopRecording();
				return;
			}
			setProblem(null);
			commit(id, index, chord);
			stopRecording();
		}

		function onKeyUp(e: KeyboardEvent) {
			e.preventDefault();
			e.stopImmediatePropagation();
			setRecording((r) => (r ? { ...r, held: heldModifiers(e) } : r));
		}

		window.addEventListener("keydown", onKeyDown, true);
		window.addEventListener("keyup", onKeyUp, true);
		return () => {
			window.removeEventListener("keydown", onKeyDown, true);
			window.removeEventListener("keyup", onKeyUp, true);
			setShortcutRecording(false);
		};
	}, [recording?.id, recording?.index]);

	function replaceConflicted() {
		if (!conflict) return;
		const { id, index, chord, takenBy } = conflict;
		// Take the chord off the other command first, so the two writes land as
		// one change rather than leaving both bound for a beat.
		setShortcutBindings(
			takenBy,
			shortcutBindings(takenBy).filter((c) => c !== chord),
		);
		commit(id, index, chord);
		setConflict(null);
	}

	const customizedCount = SHORTCUT_COMMANDS.filter((c) =>
		isShortcutCustomized(c.id),
	).length;

	const q = query.trim().toLowerCase();
	const matches = useMemo(() => {
		if (!q) return SHORTCUT_COMMANDS;
		return SHORTCUT_COMMANDS.filter((command) => {
			const chords = shortcutBindings(command.id)
				.map((chord) => `${labelFor(chord)} ${chord}`)
				.join(" ");
			return `${command.title} ${command.description} ${command.group} ${chords}`
				.toLowerCase()
				.includes(q);
		});
		// Bindings feed the haystack, so a rebind re-filters an open search.
	}, [q, version]);

	const referenceMatches = q
		? SHORTCUT_REFERENCE.filter((r) =>
				`${r.title} ${r.description} ${r.keys.join(" ")}`
					.toLowerCase()
					.includes(q),
			)
		: SHORTCUT_REFERENCE;

	function renderRow(id: ShortcutId) {
		const command = shortcutCommand(id);
		if (!command) return null;
		const bindings = shortcutBindings(id);
		const keys = shortcutKeys(id);
		const customized = isShortcutCustomized(id);
		const conflicted = conflict?.id === id ? conflict : null;

		return (
			<SettingRow key={id} className="group/row items-start">
				<SettingRowText>
					<SettingRowTitle>{command.title}</SettingRowTitle>
					<SettingRowDescription>{command.description}</SettingRowDescription>
					{conflicted && (
						<div
							className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-supporting text-dim"
							role="alert"
						>
							<ChordKeys keys={glyphsFor(conflicted.chord)} />
							<span>
								is already {shortcutCommand(conflicted.takenBy)?.title}
							</span>
							<Button size="sm" variant="primary" onClick={replaceConflicted}>
								Replace
							</Button>
							<Button size="sm" variant="soft" onClick={() => setConflict(null)}>
								Cancel
							</Button>
						</div>
					)}
					{problem?.id === id && (
						<div className="mt-1.5 text-supporting text-red" role="alert">
							{problem.message}
						</div>
					)}
				</SettingRowText>
				<SettingRowControl className="flex flex-col items-end gap-1.5">
					{keys.length === 0 && recording?.id !== id && (
						<div className="flex items-center gap-1">
							{customized && (
								<RowExtras>
									<ResetButton onClick={() => resetShortcutBindings(id)} />
								</RowExtras>
							)}
							<span className="text-supporting text-faint">Unassigned</span>
							<Tooltip label="Set a shortcut">
								<Button
									size="sm"
									variant="ghost"
									aria-label={`Set a shortcut for ${command.title}`}
									icon={<IconPencil size={20} />}
									onClick={(e) => beginRecording(id, 0, e.currentTarget)}
								/>
							</Tooltip>
						</div>
					)}
					{keys.map((chordKeys, i) => {
						// The row's own extras ride on the LAST binding's line rather than
						// a line of their own, so a one-chord command stays one line tall.
						// They stay hidden until the row is hovered or holds focus: adding
						// a second chord is rare, and a page of 22 rows each wearing four
						// controls reads as a form.
						//
						// They sit BEFORE the chord, so the cluster grows leftward. Every
						// line in this column is right-aligned, so the chord, its pencil
						// and its trash keep the same right edge as any other settings
						// control whether the row is hovered or not — a trailing reveal
						// either shifts the whole line on hover or, reserving its space,
						// parks the trash 30px inside the card's content edge.
						const last = i === keys.length - 1;
						return recording?.id === id && recording.index === i ? (
							<RecordingPill key={`rec-${i}`} held={recording.held} />
						) : (
							<div
								key={`${chordKeys.join("+")}-${i}`}
								className="flex items-center gap-1"
							>
								{last && recording?.id !== id && (
									<RowExtras>
										{customized && (
											<ResetButton onClick={() => resetShortcutBindings(id)} />
										)}
										{keys.length < MAX_BINDINGS && (
											<Tooltip label="Add another shortcut">
												<Button
													size="sm"
													variant="ghost"
													aria-label={`Add another ${command.title} shortcut`}
													icon={<IconPlus size={20} />}
													onClick={(e) =>
														beginRecording(id, bindings.length, e.currentTarget)
													}
												/>
											</Tooltip>
										)}
									</RowExtras>
								)}
								<ChordKeys keys={chordKeys} />
								<Tooltip label="Change shortcut">
									<Button
										size="sm"
										variant="ghost"
										aria-label={`Change ${command.title} shortcut`}
										icon={<IconPencil size={20} />}
										onClick={(e) => beginRecording(id, i, e.currentTarget)}
									/>
								</Tooltip>
								<Tooltip label="Remove shortcut">
									<Button
										size="sm"
										variant="ghost"
										className="hover:text-red"
										aria-label={`Remove this ${command.title} shortcut`}
										icon={<IconTrash size={20} />}
										onClick={() =>
											setShortcutBindings(
												id,
												bindings.filter((_, j) => j !== i),
											)
										}
									/>
								</Tooltip>
							</div>
						);
					})}
					{recording?.id === id && recording.index >= keys.length && (
						<RecordingPill held={recording.held} />
					)}
				</SettingRowControl>
			</SettingRow>
		);
	}

	return (
		<SettingsPanel>
			<SettingsHeader
				title="Keyboard shortcuts"
				description="Your bindings follow you to your other devices."
				actions={
					customizedCount > 0 ? (
						<Button size="sm" variant="soft" onClick={resetAllShortcuts}>
							Reset all
						</Button>
					) : undefined
				}
			/>

			<div className="relative px-5">
				<IconSearch
					size={20}
					className="pointer-events-none absolute left-8 top-1/2 -translate-y-1/2 text-faint"
				/>
				<input
					className={`${settingsInputClass} w-full !pl-11`}
					type="search"
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search shortcuts"
					aria-label="Search shortcuts"
				/>
			</div>

			{SHORTCUT_GROUPS.map((group) => {
				const rows = matches.filter((c) => c.group === group);
				if (rows.length === 0) return null;
				return (
					<div key={group}>
						<SettingsGroupLabel>{group}</SettingsGroupLabel>
						<SettingCard>{rows.map((c) => renderRow(c.id))}</SettingCard>
					</div>
				);
			})}

			{referenceMatches.length > 0 && (
				<>
					<SettingsGroupLabel>Always on</SettingsGroupLabel>
					<SettingCard>
						{referenceMatches.map((entry) => (
							<SettingRow key={entry.title}>
								<SettingRowText>
									<SettingRowTitle>{entry.title}</SettingRowTitle>
									<SettingRowDescription>
										{entry.description}
									</SettingRowDescription>
								</SettingRowText>
								<SettingRowControl>
									<ChordKeys keys={entry.keys} />
								</SettingRowControl>
							</SettingRow>
						))}
					</SettingCard>
					<SettingsHint>
						These are part of the interface rather than commands, so they stay
						as they are.
					</SettingsHint>
				</>
			)}

			{matches.length === 0 && referenceMatches.length === 0 && (
				<SettingsHint>No shortcuts match “{query.trim()}”.</SettingsHint>
			)}
		</SettingsPanel>
	);
}

/** The extras a row only offers once you reach for it: add another chord, and
 *  put the defaults back. Their space is held at rest, so revealing them moves
 *  nothing — they grow into the gap left of the chord rather than pushing the
 *  chord and its actions off the column's right edge.
 *
 *  They stay visible on a phone, where there is no hover to reveal them with
 *  and the reserved gap would otherwise sit empty for good. */
function RowExtras({ children }: { children: React.ReactNode }) {
	return (
		<span className="mr-0.5 flex items-center gap-1 opacity-0 transition-opacity phone:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100">
			{children}
		</span>
	);
}

/** Restores a row's default chords. Quiet: it only matters once you've
 *  changed something, and it should never compete with the chord itself. */
function ResetButton({ onClick }: { onClick: () => void }) {
	return (
		<Tooltip label="Restore the default shortcut">
			<button
				type="button"
				className="rounded-sm px-1 text-label text-faint transition-colors hover:text-dim focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
				onClick={onClick}
			>
				Reset
			</button>
		</Tooltip>
	);
}

/** The pill a row wears while it waits for a chord. */
function RecordingPill({ held }: { held: string[] }) {
	return (
		<span
			className="flex items-center gap-1.5 rounded-control bg-accent-soft px-2.5 py-1 text-meta text-accent"
			role="status"
			aria-live="polite"
		>
			{held.length > 0 ? (
				<span className="flex items-center gap-1">
					{held.map((key) => (
						<Keycap key={key}>{key}</Keycap>
					))}
				</span>
			) : null}
			<span>Press a shortcut</span>
		</span>
	);
}
