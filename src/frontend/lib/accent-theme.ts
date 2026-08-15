/**
 * Eleven accents, ordered as a walk around the hue wheel from the blues.
 *
 * Each fill runs at 92% of the chroma its hue can physically reach in sRGB at
 * its lightness, which is as saturated as the colour gets before it leaves the
 * gamut. That share is flat across the wheel, but the results are not: teal and
 * sky top out near chroma 0.10 and 0.13 where violet and orchid reach 0.26, so
 * the cool end reads calmer than the warm one no matter what is asked of it.
 *
 * Two entries sit outside the rule. `lime` (Honey) is a yellow, and yellow only
 * exists at high lightness, so it keeps one value in both appearances and takes
 * a black glyph; its ink form deepens instead, since a label has to clear text
 * contrast that a plate does not. `brown` (Walnut) is deliberately held near
 * neutral: it is the one accent that is a dark surface rather than a hue.
 *
 * The `value` is persisted per person, so these ids outlive their colours:
 * changing a hex re-themes everyone who chose that slot, while renaming one
 * drops them back to the default. Migrate instead: see `getAccentTheme`.
 */
export const ACCENT_THEME_OPTIONS = [
	{ value: "sky", label: "Sky", light: "#1d82bc", dark: "#2495d6" },
	{ value: "indigo", label: "Indigo", light: "#6361f5", dark: "#767bf6" },
	{ value: "purple", label: "Violet", light: "#9338f5", dark: "#9f5ff6" },
	{ value: "pink", label: "Orchid", light: "#b03bb6", dark: "#c44bcb" },
	{ value: "coral", label: "Coral", light: "#dd233a", dark: "#f73648" },
	{ value: "orange", label: "Tangerine", light: "#d3571c", dark: "#eb6221" },
	{ value: "brown", label: "Walnut", light: "#76451f", dark: "#82502a" },
	{ value: "lime", label: "Honey", light: "#f2c527", dark: "#f2c527" },
	{ value: "green", label: "Clover", light: "#1e8e45", dark: "#24a351" },
	{ value: "teal", label: "Teal", light: "#1f8a94", dark: "#259ea9" },
	{ value: "mono", label: "Mono", light: "#000000", dark: "#ffffff" },
] as const;

export type AccentTheme = (typeof ACCENT_THEME_OPTIONS)[number]["value"];

export const DEFAULT_ACCENT_THEME: AccentTheme = "teal";

const KEY = "opensession-accent";
const CHANGE_EVENT = "opensession-accent-changed";
const VALID_THEMES = new Set<AccentTheme>(
	ACCENT_THEME_OPTIONS.map((option) => option.value),
);

export function isAccentTheme(value: string | null): value is AccentTheme {
	return value !== null && VALID_THEMES.has(value as AccentTheme);
}

/**
 * Selections that outlived their colour. Each maps to the nearest hue still in
 * the palette, so someone who chose a removed accent lands somewhere close
 * rather than back on the default.
 */
const RETIRED_THEMES: Record<string, AccentTheme> = {
	gold: "lime",
};

export function getAccentTheme(): AccentTheme {
	const stored = localStorage.getItem(KEY);
	const retired = stored === null ? undefined : RETIRED_THEMES[stored];
	if (retired) {
		localStorage.setItem(KEY, retired);
		return retired;
	}
	return isAccentTheme(stored) ? stored : DEFAULT_ACCENT_THEME;
}

export function getAccentThemeOption(theme: AccentTheme) {
	return ACCENT_THEME_OPTIONS.find((option) => option.value === theme)!;
}

export function getOnAccentInk(
	theme: AccentTheme,
	tone: "light" | "dark",
): "#000000" | "#ffffff" {
	return theme === "lime" || (theme === "mono" && tone === "dark")
		? "#000000"
		: "#ffffff";
}

export function applyAccentTheme(theme: AccentTheme = getAccentTheme()) {
	document.documentElement.dataset.accent = theme;
}

export function setAccentTheme(theme: AccentTheme) {
	localStorage.setItem(KEY, theme);
	applyAccentTheme(theme);
	window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function onAccentThemeChanged(handler: () => void): () => void {
	window.addEventListener(CHANGE_EVENT, handler);
	return () => window.removeEventListener(CHANGE_EVENT, handler);
}

export function handleAccentStorageChange(event: Pick<StorageEvent, "key">) {
	// A null key is localStorage.clear(), which resets the accent to its default.
	if (event.key !== KEY && event.key !== null) return;
	applyAccentTheme();
	window.dispatchEvent(new Event(CHANGE_EVENT));
}

if (
	typeof window !== "undefined" &&
	typeof document !== "undefined" &&
	typeof window.addEventListener === "function"
) {
	window.addEventListener("storage", handleAccentStorageChange);

	// The inline bootstrap applies this before paint; repeat it on import so the
	// contract still holds if that bootstrap is ever removed.
	applyAccentTheme();
}
