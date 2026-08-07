import { describe, expect, test } from "bun:test";
import {
	REPO_TILE_COLORS,
	assignRepoTileColors,
	repoTileColor,
} from "./repo-tile-colors";

// The registered set this instance actually runs, plus the same-letter
// families that motivated set-aware assignment in the first place.
const REPOS = [
	"tella-fusion",
	"opensession",
	"gitops",
	"infra",
	"shared-infra",
	"tella-mac",
	"tella-windows",
	"gstreamer",
	"gst-plugins-rs",
];

describe("assignRepoTileColors", () => {
	test("gives every repo in the set its own color", () => {
		const colors = assignRepoTileColors(REPOS);
		expect(Object.keys(colors).sort()).toEqual([...REPOS].sort());
		expect(new Set(Object.values(colors)).size).toBe(REPOS.length);
	});

	test("separates repos a plain hash would collide", () => {
		// The pair that made the tile ambiguous: same letter, and the hash
		// alone lands them on the same swatch.
		const colors = assignRepoTileColors(["opensession", "os1-chrome"]);
		expect(repoTileColor("opensession")).toBe(repoTileColor("os1-chrome"));
		expect(colors["opensession"]).not.toBe(colors["os1-chrome"]);
	});

	test("depends on the set, not the order it is given in", () => {
		expect(assignRepoTileColors(REPOS)).toEqual(
			assignRepoTileColors([...REPOS].reverse()),
		);
	});

	test("keeps assigning past a full palette", () => {
		const many = Array.from({ length: 40 }, (_, i) => `repo-${i}`);
		const colors = assignRepoTileColors(many);
		expect(Object.keys(colors)).toHaveLength(40);
		// Sixteen distinct colors, then the palette repeats rather than
		// running out of tiles.
		expect(new Set(Object.values(colors)).size).toBe(REPO_TILE_COLORS.length);
	});

	test("hashes an unregistered repo to a palette color", () => {
		expect(REPO_TILE_COLORS).toContain(repoTileColor("some-local-checkout"));
		expect(repoTileColor("some-local-checkout")).toBe(
			repoTileColor("Some-Local-Checkout"),
		);
	});
});
