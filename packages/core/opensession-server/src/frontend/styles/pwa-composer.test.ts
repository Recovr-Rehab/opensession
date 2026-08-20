import { expect, test } from "bun:test";
import { composerFlapBorder } from "../lib/composer-classes";

const CSS = new URL("./base.css", import.meta.url);
const SHIPPED = new URL(
	"../components/ShippedChangeComposer.tsx",
	import.meta.url,
);

test("the installed phone composer family matches the desktop ring strength", async () => {
	const css = await Bun.file(CSS).text();
	const shipped = await Bun.file(SHIPPED).text();
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
});
