import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { PrFileTree } from "./PrFileTree";

describe("PrFileTree", () => {
  test("shortens long file names from the center", () => {
    const entry = Bun.resolveSync("@pierre/trees", import.meta.dir);
    const source = readFileSync(join(dirname(entry), "render/FileTreeView.js"), "utf8");

    expect(source).toContain('split: "center"');
    expect(source).not.toContain('split: "extension"');
  });

  test("renders an accessible resize separator", () => {
    const html = renderToStaticMarkup(<PrFileTree paths={["src/index.ts"]} onOpenFile={() => {}} />);

    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-label="Resize changed files"');
    expect(html).toContain('aria-orientation="vertical"');
  });
});
