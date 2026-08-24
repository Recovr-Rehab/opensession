import { beforeEach, describe, expect, test } from "bun:test";
import {
	loadTranscriptSizes,
	saveTranscriptSizes,
	seededBlockEstimate,
	transcriptWidthBucket,
	type TranscriptWidthBucket,
} from "./transcript-sizes";

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

function sizes(entries: Record<string, number>) {
	return new Map(Object.entries(entries));
}

beforeEach(() => storage.clear());

describe("transcript sizes", () => {
	test("width buckets split phone from desktop", () => {
		expect(transcriptWidthBucket(true)).toBe<TranscriptWidthBucket>("narrow");
		expect(transcriptWidthBucket(false)).toBe<TranscriptWidthBucket>("wide");
	});

	test("round-trips measured heights per session and bucket", () => {
		saveTranscriptSizes("s1", "wide", sizes({ "range:a": 120.4 }), storage);
		expect(loadTranscriptSizes("s1", "wide", storage)).toEqual({
			"range:a": 120,
		});
		// The other bucket and other sessions stay untouched.
		expect(loadTranscriptSizes("s1", "narrow", storage)).toBeUndefined();
		expect(loadTranscriptSizes("s2", "wide", storage)).toBeUndefined();
	});

	test("merges over the previous visit without dropping unseen rows", () => {
		saveTranscriptSizes(
			"s1",
			"wide",
			sizes({ "range:a": 100, "range:b": 200 }),
			storage,
		);
		saveTranscriptSizes("s1", "wide", sizes({ "range:b": 240 }), storage);
		expect(loadTranscriptSizes("s1", "wide", storage)).toEqual({
			"range:a": 100,
			"range:b": 240,
		});
	});

	test("ignores empty, non-finite, and non-positive measurements", () => {
		saveTranscriptSizes("s1", "wide", new Map(), storage);
		expect(loadTranscriptSizes("s1", "wide", storage)).toBeUndefined();
		saveTranscriptSizes(
			"s1",
			"wide",
			sizes({ bad: Number.NaN, zero: 0 }),
			storage,
		);
		expect(loadTranscriptSizes("s1", "wide", storage)).toBeUndefined();
	});

	test("evicts the oldest session beyond the cap", () => {
		for (let index = 0; index < 25; index++) {
			saveTranscriptSizes(`s${index}`, "wide", sizes({ k: index }), storage);
		}
		expect(loadTranscriptSizes("s0", "wide", storage)).toBeUndefined();
		expect(loadTranscriptSizes("s24", "wide", storage)).toEqual({ k: 24 });
		// Revisiting refreshes recency, so it survives the next eviction.
		saveTranscriptSizes("s1", "wide", sizes({ k: 1 }), storage);
		for (let index = 25; index < 26; index++) {
			saveTranscriptSizes(`s${index}`, "wide", sizes({ k: index }), storage);
		}
		expect(loadTranscriptSizes("s1", "wide", storage)).toEqual({ k: 1 });
	});

	test("survives corrupt storage", () => {
		storage.setItem(
			"opensession.transcript-sizes.v1",
			"{not json",
		);
		expect(loadTranscriptSizes("s1", "wide", storage)).toBeUndefined();
		saveTranscriptSizes("s1", "wide", sizes({ k: 10 }), storage);
		expect(loadTranscriptSizes("s1", "wide", storage)).toEqual({ k: 10 });
	});
});

describe("seededBlockEstimate", () => {
	test("prefers a positive measured seed over the heuristic", () => {
		expect(seededBlockEstimate(96, { k: 312 }, "k")).toBe(312);
	});

	test("falls back to the heuristic without a usable seed", () => {
		expect(seededBlockEstimate(96, undefined, "k")).toBe(96);
		expect(seededBlockEstimate(96, {}, "k")).toBe(96);
		expect(seededBlockEstimate(96, { k: 0 }, "k")).toBe(96);
	});
});
