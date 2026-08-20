import { expect, test } from "bun:test";

const CSS = new URL("./base.css", import.meta.url);

test("the installed phone composer matches the desktop ring strength", async () => {
	const css = await Bun.file(CSS).text();
	const mediaStart = css.indexOf(
		"@media (display-mode: standalone) and (max-width: 720px)",
	);
	const mediaEnd = css.indexOf("\n}\n", mediaStart) + 3;
	const standalonePhone = css.slice(mediaStart, mediaEnd);

	expect(standalonePhone).toContain(".app .composer");
	expect(standalonePhone).toContain(
		"border-color: color-mix(in srgb, var(--composer-border) 35%, transparent)",
	);
});
