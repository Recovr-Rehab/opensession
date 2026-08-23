import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	TopBar,
	TopBarAction,
	TopBarActions,
	TopBarBack,
	TopBarLeading,
	TopBarTitle,
} from "./top-bar";

test("top bars share structure while keeping feature layout classes", () => {
	const html = renderToStaticMarkup(
		<TopBar as="header" className="sticky">
			<TopBarLeading>Leading</TopBarLeading>
			<TopBarTitle>Title</TopBarTitle>
			<TopBarActions>Actions</TopBarActions>
		</TopBar>,
	);

	expect(html).toContain("<header");
	expect(html).toContain('data-top-bar=""');
	expect(html).toContain("sticky");
	expect(html).toContain("Leading");
	expect(html).toContain("Title");
	expect(html).toContain("Actions");
});

test("floating controls reuse application mobile chrome", () => {
	const html = renderToStaticMarkup(
		<>
			<TopBarBack floating aria-label="Back" />
			<TopBarAction floating aria-label="More" icon={<span>Icon</span>} />
		</>,
	);

	expect(html).toContain("pwa-header-back");
	expect(html).toContain("mobile-header-control-surface");
	expect(html).toContain('aria-label="Back"');
	expect(html).toContain('aria-label="More"');
});
