/**
 * The Plain thread status pill (Todo / Done / Snoozed).
 *
 * A lookup rather than the old `plain-status-${status.toLowerCase()}`: a class
 * assembled at render time can never be proven unused, so it pins its rules in
 * the stylesheet permanently — the whole point of the migration is to be able
 * to delete what nothing reaches.
 *
 * Snoozed was authored against `var(--amber, #d29922)`, and `--amber` is not a
 * token this app defines — so it always resolved to the literal fallback and
 * stayed the dark-theme yellow even in light mode. It uses the real `--yellow`
 * token now, which does re-resolve per theme.
 */
const BASE =
	"shrink-0 rounded-full px-[7px] py-0.5 text-meta font-bold tracking-[-0.01em]";

const TONES: Record<string, string> = {
	todo: "bg-[color-mix(in_srgb,var(--blue)_18%,transparent)] text-blue",
	done: "bg-[color-mix(in_srgb,var(--green)_18%,transparent)] text-green",
	snoozed: "bg-[color-mix(in_srgb,var(--yellow)_20%,transparent)] text-yellow",
};

export function plainStatusClass(status: string): string {
	const tone = TONES[status.toLowerCase()] ?? "bg-active text-faint";
	return `${BASE} ${tone}`;
}
