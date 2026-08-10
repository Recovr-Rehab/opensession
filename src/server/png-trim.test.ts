import { describe, expect, test } from "bun:test";
import { deflateSync } from "node:zlib";
import { trimIconMargin } from "./png-trim";

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

/** Minimal 8-bit RGBA PNG, so the test doesn't lean on a checked-in file. */
function png(size: number, draw: (x: number, y: number) => number[]): Uint8Array {
	const raw = new Uint8Array((size * 4 + 1) * size);
	for (let y = 0; y < size; y++) {
		raw[y * (size * 4 + 1)] = 0; // filter: none
		for (let x = 0; x < size; x++) {
			raw.set(draw(x, y), y * (size * 4 + 1) + 1 + x * 4);
		}
	}
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	const chunk = (type: string, data: Uint8Array) => {
		const out = new Uint8Array(12 + data.length);
		const view = new DataView(out.buffer);
		view.setUint32(0, data.length);
		for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
		out.set(data, 8);
		let crc = 0xffffffff;
		for (const byte of out.subarray(4, 8 + data.length)) {
			crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
		}
		view.setUint32(8 + data.length, (crc ^ 0xffffffff) >>> 0);
		return out;
	};
	const ihdr = new Uint8Array(13);
	const view = new DataView(ihdr.buffer);
	view.setUint32(0, size);
	view.setUint32(4, size);
	ihdr[8] = 8;
	ihdr[9] = 6;
	const parts = [
		new Uint8Array(SIGNATURE),
		chunk("IHDR", ihdr),
		chunk("IDAT", new Uint8Array(deflateSync(raw))),
		chunk("IEND", new Uint8Array(0)),
	];
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

/** The dimensions a PNG declares, read back from its header. */
function sizeOf(bytes: Uint8Array): { width: number; height: number } {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	return { width: view.getUint32(16), height: view.getUint32(20) };
}

describe("trimIconMargin", () => {
	// An icon like the ones this exists for: artwork on the middle 60%, the
	// rest transparent.
	const padded = png(100, (x, y) =>
		x >= 20 && x < 80 && y >= 20 && y < 80 ? [10, 20, 30, 255] : [0, 0, 0, 0],
	);

	test("crops the empty margin down to a small even one", () => {
		const out = trimIconMargin(padded);
		expect(out).not.toBeNull();
		const { width, height } = sizeOf(out!);
		expect(width).toBe(height);
		// 60px of art plus 4% each side, rather than the 100px it arrived in.
		expect(width).toBe(64);
	});

	test("leaves art that already fills its canvas alone", () => {
		const full = png(40, () => [10, 20, 30, 255]);
		expect(trimIconMargin(full)).toBeNull();
		// And its own output is tight enough not to be trimmed twice.
		expect(trimIconMargin(trimIconMargin(padded)!)).toBeNull();
	});

	/** A disc of `r` centred in a `size` canvas — the roundest icon there is. */
	const disc = (size: number, r: number) =>
		png(size, (x, y) =>
			(x + 0.5 - size / 2) ** 2 + (y + 0.5 - size / 2) ** 2 <= r * r
				? [10, 20, 30, 255]
				: [0, 0, 0, 0],
		);

	test("gives round art the margin back, so it carries a square's ink", () => {
		// Same 60px box as `padded`, but a circle fills ~79% of it. It ends up
		// bigger in the tile than the square does (64px of canvas), which is
		// what makes the two read the same weight.
		const out = trimIconMargin(disc(100, 30));
		expect(out).not.toBeNull();
		const { width, height } = sizeOf(out!);
		expect(width).toBe(height);
		expect(width).toBeLessThan(64);
		expect(width).toBeLessThanOrEqual(62); // i.e. no margin left to give

		// A gently rounded square sits between the two: some margin, less than
		// a flat square's.
		const r = 18; // corner radius, as heavy as the OpenSession mark's
		const rounded = png(100, (x, y) => {
			const ax = Math.abs(x + 0.5 - 50);
			const ay = Math.abs(y + 0.5 - 50);
			const dx = Math.max(0, ax - (30 - r));
			const dy = Math.max(0, ay - (30 - r));
			const inside = ax <= 30 && ay <= 30 && dx * dx + dy * dy <= r * r;
			return inside ? [10, 20, 30, 255] : [0, 0, 0, 0];
		});
		const roundedOut = trimIconMargin(rounded);
		expect(roundedOut).not.toBeNull();
		expect(sizeOf(roundedOut!).width).toBeLessThan(64);
		expect(sizeOf(roundedOut!).width).toBeGreaterThan(sizeOf(out!).width);
	});

	test("never crops a square icon to match a rounder one", () => {
		// The compensation only ever removes margin. Square art that already
		// fills its canvas keeps every pixel...
		const full = png(40, () => [10, 20, 30, 255]);
		expect(trimIconMargin(full)).toBeNull();
		// ...and padded square art lands at the plain margin, not tighter.
		expect(sizeOf(trimIconMargin(padded)!).width).toBe(64);
		// Round art is idempotent too: once it has no margin left, a re-serve
		// finds nothing to do rather than eating into the artwork.
		expect(trimIconMargin(trimIconMargin(disc(100, 30))!)).toBeNull();
	});

	test("keeps the artwork centred when it sits off to one side", () => {
		const corner = png(100, (x, y) =>
			x < 40 && y < 40 ? [255, 0, 0, 255] : [0, 0, 0, 0],
		);
		const out = trimIconMargin(corner);
		expect(out).not.toBeNull();
		const { width } = sizeOf(out!);
		expect(width).toBe(44);
	});

	test("declines anything it can't decode rather than mangling it", () => {
		expect(trimIconMargin(new Uint8Array([1, 2, 3, 4]))).toBeNull();
		const transparent = png(20, () => [0, 0, 0, 0]);
		expect(trimIconMargin(transparent)).toBeNull();
	});
});
