import { expect, test } from "bun:test";
import { composerBox, composerFlapBorder } from "../lib/composer-classes";

const CSS = new URL("./base.css", import.meta.url);
const TAILWIND = new URL("./tailwind.css", import.meta.url);
const SHIPPED = new URL(
	"../components/ShippedChangeComposer.tsx",
	import.meta.url,
);
const COMPOSER = new URL("../components/Composer.tsx", import.meta.url);

test("phone composers use the same quiet edge as the desktop ring", () => {
	expect(composerBox).toContain(
		"border-[color:color-mix(in_srgb,var(--composer-border)_35%,transparent)]",
	);
	expect(composerFlapBorder).toContain(
		"border-[color:color-mix(in_srgb,var(--composer-border)_35%,transparent)]",
	);
});

test("the installed phone composer keeps a quiet edge and hides auxiliary controls", async () => {
	const css = await Bun.file(CSS).text();
	const tailwind = await Bun.file(TAILWIND).text();
	const shipped = await Bun.file(SHIPPED).text();
	const composer = await Bun.file(COMPOSER).text();
	const mediaStart = css.indexOf(
		"@media (display-mode: standalone) and (max-width: 720px)",
	);
	const mediaEnd = css.indexOf("\n}\n", mediaStart) + 3;
	const standalonePhone = css.slice(mediaStart, mediaEnd);

	expect(standalonePhone).toContain(".app .composer");
	expect(standalonePhone).toContain(".app .pwa-composer-edge");
	expect(composerFlapBorder).toContain("pwa-composer-edge");
	expect(shipped).toContain("pwa-composer-edge");
	expect(standalonePhone).toContain(
		"border-color: color-mix(in srgb, var(--composer-border) 35%, transparent)",
	);
	expect(standalonePhone).toContain(".app .pwa-send-option");
	expect(standalonePhone).toContain("display: none");
	expect(composer.match(/pwa-send-option/g)).toHaveLength(3);
	expect(tailwind).toContain(
		"@custom-variant pwa (@media (display-mode: standalone))",
	);
	expect(composer).toContain("pwa:phone:inline-flex");
	expect(composer).toContain('aria-pressed={noteMode}');
});
