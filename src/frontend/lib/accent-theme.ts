/**
 * Ten accents, ordered as a walk around the hue wheel starting at the default.
 *
 * Every fill sits at lightness 0.56 to 0.63 and carries chroma 0.13, or 80% of
 * what its hue can physically reach in sRGB, whichever is lower. That ceiling
 * is why the warm and teal hues read quieter than the purples without looking
 * underpowered: at a shared lightness, orange tops out around chroma 0.17
 * while violet reaches 0.29, so a single flat chroma would run one at its limit
 * and the other at a third of its range.
 *
 * Two entries sit outside the rule on purpose. `lime` (Honey) is a yellow, and
 * yellow only exists at high lightness, so no value both reads as yellow and
 * separates from a white page. It takes a genuinely different fill per
 * appearance and a black glyph. `mono` has no hue to place.
 *
 * The `value` is persisted per person, so these ids outlive their colours:
 * changing a hex re-themes everyone who chose that slot, while renaming one
 * drops them back to the default. Migrate instead: see `getAccentTheme`.
 */
export const ACCENT_THEME_OPTIONS = [
	{ value: "teal", label: "Teal", light: "#208a94", dark: "#269da9" },
	{ value: "sky", label: "Sky", light: "#1f82bb", dark: "#2595d5" },
	{ value: "purple", label: "Violet", light: "#825dbc", dark: "#885fc5" },
	{ value: "pink", label: "Orchid", light: "#9f52a1", dark: "#a653a9" },
	{ value: "coral", label: "Coral", light: "#c44b4d", dark: "#cc5354" },
	{ value: "orange", label: "Tangerine", light: "#d26232", dark: "#db6634" },
	{ value: "brown", label: "Walnut", light: "#724727", dark: "#7e502f" },
	{ value: "lime", label: "Honey", light: "#efc53f", dark: "#f4e78f" },
	{ value: "green", label: "Clover", light: "#2b8948", dark: "#238f48" },
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
	indigo: "sky",
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
