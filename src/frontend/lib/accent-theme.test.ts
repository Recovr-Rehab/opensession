import { beforeEach, describe, expect, test } from "bun:test";
import {
	ACCENT_THEME_OPTIONS,
	DEFAULT_ACCENT_THEME,
	getAccentTheme,
	getAccentThemeOption,
	getOnAccentInk,
	handleAccentStorageChange,
	isAccentTheme,
	setAccentTheme,
} from "./accent-theme";

class StorageStub {
	private values = new Map<string, string>();
	getItem(key: string) {
		return this.values.get(key) ?? null;
	}
	setItem(key: string, value: string) {
		this.values.set(key, value);
	}
	clear() {
		this.values.clear();
	}
}

const storage = new StorageStub();
const dataset: Record<string, string> = {};

beforeEach(() => {
	Object.defineProperty(globalThis, "localStorage", {
		value: storage,
		configurable: true,
	});
	Object.defineProperty(globalThis, "document", {
		value: { documentElement: { dataset } },
		configurable: true,
	});
	Object.defineProperty(globalThis, "window", {
		value: {
			dispatchEvent() {},
			addEventListener() {},
			removeEventListener() {},
		},
		configurable: true,
	});
	storage.clear();
	delete dataset.accent;
});

function luminance(hex: string) {
	const channels = [1, 3, 5].map((offset) => {
		const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
		return channel <= 0.03928
			? channel / 12.92
			: ((channel + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

describe("accent theme", () => {
	test("matches the native eleven-colour palette", () => {
		expect(ACCENT_THEME_OPTIONS).toHaveLength(11);
		expect(
			new Set(
				ACCENT_THEME_OPTIONS.map(({ light, dark }) => `${light}-${dark}`),
			).size,
		).toBe(11);
	});

	test("the CSS tokens and pre-paint bootstrap contain the same palette", async () => {
		const [css, html] = await Promise.all([
			Bun.file(new URL("../styles/base.css", import.meta.url)).text(),
			Bun.file(new URL("../index.html", import.meta.url)).text(),
		]);
		for (const option of ACCENT_THEME_OPTIONS) {
			const block = css.match(
				new RegExp(`html\\[data-accent="${option.value}"\\] \\{([\\s\\S]*?)\\}`),
			)?.[1];
			expect(block).toContain(`--accent-light: ${option.light}`);
			expect(block).toContain(`--accent-dark: ${option.dark}`);
		}
		const serializedValues = html
			.match(/var accents = (\[[^;]+\]);/)?.[1]
			.replaceAll("'", '"');
		expect(JSON.parse(serializedValues ?? "[]")).toEqual(
			ACCENT_THEME_OPTIONS.map((option) => option.value),
		);
		expect(css).toContain("--on-accent-light: #000000");
		expect(css).toContain("--on-accent-dark: #000000");
		expect(css).toContain("--accent-ink-light: #8d7110");
		// The pre-paint bootstrap has to retire the same selections the bundle
		// does, or a migrated accent flashes its old id for one frame.
		expect(html).toContain('var retired = { gold: "lime" }');
	});

	test("the picker gives every accent a column", async () => {
		const panel = await Bun.file(
			new URL("../components/settings/AppearancePanel.tsx", import.meta.url),
		).text();
		const columns = panel.match(/desktop:grid-cols-(\d+)"/)?.[1];
		expect(Number(columns)).toBe(ACCENT_THEME_OPTIONS.length);
	});

	test("every fill carries a legible glyph", () => {
		for (const option of ACCENT_THEME_OPTIONS) {
			for (const tone of ["light", "dark"] as const) {
				const fill = option[tone];
				const ink = getOnAccentInk(option.value, tone);
				const fillLuminance = luminance(fill);
				const inkLuminance = luminance(ink);
				const contrast =
					(Math.max(fillLuminance, inkLuminance) + 0.05) /
					(Math.min(fillLuminance, inkLuminance) + 0.05);
				expect(contrast).toBeGreaterThan(3);
			}
		}
	});

	test("migrates the removed Gold accent to Lime", () => {
		storage.setItem("opensession-accent", "gold");
		expect(getAccentTheme()).toBe("lime");
		expect(storage.getItem("opensession-accent")).toBe("lime");
	});

	test("defaults to teal for missing or unknown values", () => {
		expect(getAccentTheme()).toBe(DEFAULT_ACCENT_THEME);
		storage.setItem("opensession-accent", "chartreuse");
		expect(getAccentTheme()).toBe(DEFAULT_ACCENT_THEME);
	});

	test("persists and applies a selection", () => {
		setAccentTheme("purple");
		expect(getAccentTheme()).toBe("purple");
		expect(dataset.accent).toBe("purple");
	});

	test("a cross-tab storage clear restores the default", () => {
		dataset.accent = "purple";
		handleAccentStorageChange({ key: null });
		expect(dataset.accent).toBe(DEFAULT_ACCENT_THEME);
	});

	test("rejects values outside the palette", () => {
		expect(isAccentTheme("lime")).toBe(true);
		expect(isAccentTheme("gold")).toBe(false);
		expect(isAccentTheme("chartreuse")).toBe(false);
		expect(getAccentThemeOption("mono").dark).toBe("#ffffff");
	});
});
