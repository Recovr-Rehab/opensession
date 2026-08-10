import { describe, expect, test } from "bun:test";
import {
	adjacentAssetPath,
	assetFileFor,
	assetPreviewKind,
	formatAssetSize,
	resolvedAssetPath,
} from "./asset-preview";

describe("asset previews", () => {
	test("classifies files by the renderer they need", () => {
		expect(assetPreviewKind("report.html")).toBe("html");
		expect(assetPreviewKind("chart.svg")).toBe("html");
		expect(assetPreviewKind("notes.md")).toBe("markdown");
		expect(assetPreviewKind("data.json")).toBe("text");
		expect(assetPreviewKind("archive.zip")).toBe("binary");
	});

	test("keeps a chip openable before the listing catches up", () => {
		expect(assetFileFor("report.html", [])).toEqual({
			path: "report.html",
			size: 0,
			mtime: "",
		});
	});

	test("formats file sizes for the actions row", () => {
		expect(formatAssetSize(512)).toBe("512 B");
		expect(formatAssetSize(1536)).toBe("1.5 KB");
	});

	test("keeps tree navigation and overlay promotion on one selection", () => {
		const paths = ["chart.png", "demo/index.html", "index.html"];
		expect(resolvedAssetPath(paths, "chart.png")).toBe("chart.png");
		expect(resolvedAssetPath(paths, "missing.html")).toBe("index.html");
	});

	test("moves between assets and wraps at both ends", () => {
		const paths = ["chart.png", "demo.html", "notes.md"];
		expect(adjacentAssetPath(paths, "demo.html", -1)).toBe("chart.png");
		expect(adjacentAssetPath(paths, "demo.html", 1)).toBe("notes.md");
		expect(adjacentAssetPath(paths, "chart.png", -1)).toBe("notes.md");
		expect(adjacentAssetPath(paths, "notes.md", 1)).toBe("chart.png");
		expect(adjacentAssetPath(paths, "missing.txt", 1)).toBeNull();
		expect(adjacentAssetPath(["only.txt"], "only.txt", 1)).toBeNull();
	});
});
