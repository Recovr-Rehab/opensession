export const ACCENT_THEME_OPTIONS = [
	{ value: "teal", label: "Teal", light: "#208a94", dark: "#269da9" },
	{ value: "sky", label: "Sky", light: "#1f82bb", dark: "#2595d5" },
	{ value: "indigo", label: "Indigo", light: "#6361f5", dark: "#767bf6" },
	{ value: "purple", label: "Violet", light: "#ad26e8", dark: "#bd4bf6" },
	{ value: "pink", label: "Rose", light: "#d1238c", dark: "#ee29a1" },
	{ value: "coral", label: "Coral", light: "#dd243b", dark: "#f73648" },
	{ value: "orange", label: "Tangerine", light: "#e84f00", dark: "#ff5a00" },
	{ value: "gold", label: "Gold", light: "#98741c", dark: "#ae8521" },
	{ value: "green", label: "Clover", light: "#209148", dark: "#26a653" },
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

export function getAccentTheme(): AccentTheme {
	const stored = localStorage.getItem(KEY);
	return isAccentTheme(stored) ? stored : DEFAULT_ACCENT_THEME;
}

export function getAccentThemeOption(theme: AccentTheme) {
	return ACCENT_THEME_OPTIONS.find((option) => option.value === theme)!;
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
