import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  normalizePiConfig,
  piBridgeAccounts,
  piEngineEnabled,
  piPickerModels,
  readPiEngineConfig,
} from "./pi-config";

const savedConfig = process.env.OPENSESSION_PI_CONFIG;
afterEach(() => {
  if (savedConfig === undefined) delete process.env.OPENSESSION_PI_CONFIG;
  else process.env.OPENSESSION_PI_CONFIG = savedConfig;
});

/** Point the test seam at a throwaway file holding `raw` (or nothing). */
function withConfigFile(raw?: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-config-"));
  const path = join(dir, "pi.json");
  if (raw !== undefined) {
    writeFileSync(path, typeof raw === "string" ? raw : JSON.stringify(raw));
  }
  process.env.OPENSESSION_PI_CONFIG = path;
  return dir;
}

describe("normalizePiConfig", () => {
  it("normalizes anything that isn't a JSON object to the disabled config", () => {
    for (const raw of [null, undefined, 42, "yes", [], true]) {
      expect(normalizePiConfig(raw)).toEqual({ enabled: false, pickerModels: [] });
    }
  });

  it("treats only a literal true as enabled", () => {
    expect(normalizePiConfig({ enabled: true }).enabled).toBe(true);
    for (const v of [1, "true", "yes", {}, undefined]) {
      expect(normalizePiConfig({ enabled: v }).enabled).toBe(false);
    }
  });

  it("keeps only full pi/<provider>/<model> picker ids", () => {
    expect(
      normalizePiConfig({
        enabled: true,
        pickerModels: [
          "pi/anthropic/claude-opus-5",
          "pi/anthropic", // no model segment
          "pi/", // empty remainder
          "opencode/anthropic/claude-opus-5", // wrong engine
          "claude-opus-5", // bare native id
          42,
          null,
        ],
      }).pickerModels
    ).toEqual(["pi/anthropic/claude-opus-5"]);
  });

  it("tolerates a missing or malformed pickerModels field", () => {
    expect(normalizePiConfig({ enabled: true }).pickerModels).toEqual([]);
    expect(normalizePiConfig({ enabled: true, pickerModels: "pi/a/b" }).pickerModels).toEqual([]);
  });

  it("keeps bridgeAccounts as non-empty string ids, absent by default", () => {
    expect(normalizePiConfig({ enabled: true }).bridgeAccounts).toBeUndefined();
    expect(
      normalizePiConfig({
        enabled: true,
        bridgeAccounts: ["acc-1", "", 42, null, "acc-2"],
      }).bridgeAccounts
    ).toEqual(["acc-1", "acc-2"]);
  });

  it("normalizes an empty or malformed bridgeAccounts to absent", () => {
    // Present-implies-non-empty: downstream (anthropic-bridge) treats the
    // field's presence as "pi designates accounts".
    expect(
      normalizePiConfig({ enabled: true, bridgeAccounts: [] }).bridgeAccounts
    ).toBeUndefined();
    expect(
      normalizePiConfig({ enabled: true, bridgeAccounts: [42, ""] }).bridgeAccounts
    ).toBeUndefined();
    expect(
      normalizePiConfig({ enabled: true, bridgeAccounts: "acc-1" }).bridgeAccounts
    ).toBeUndefined();
  });
});

describe("readPiEngineConfig", () => {
  it("returns null when the file is missing", () => {
    const dir = withConfigFile();
    expect(readPiEngineConfig()).toBeNull();
    expect(piEngineEnabled()).toBe(false);
    expect(piPickerModels()).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails soft (null) on unparseable JSON", () => {
    const dir = withConfigFile("{not json");
    expect(readPiEngineConfig()).toBeNull();
    expect(piEngineEnabled()).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("reads and normalizes a valid config fresh per call", () => {
    const dir = withConfigFile({
      enabled: true,
      pickerModels: ["pi/anthropic/claude-opus-5", "bogus"],
    });
    expect(readPiEngineConfig()).toEqual({
      enabled: true,
      pickerModels: ["pi/anthropic/claude-opus-5"],
    });
    expect(piEngineEnabled()).toBe(true);
    expect(piPickerModels()).toEqual(["pi/anthropic/claude-opus-5"]);
    // An edit applies on the next call — no restart, no cache.
    writeFileSync(
      join(dir, "pi.json"),
      JSON.stringify({ enabled: false, pickerModels: ["pi/anthropic/claude-opus-5"] })
    );
    expect(piEngineEnabled()).toBe(false);
    expect(piPickerModels()).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("hides picker models while disabled — models absent, ids still normalized", () => {
    const dir = withConfigFile({ pickerModels: ["pi/anthropic/claude-opus-5"] });
    expect(readPiEngineConfig()).toEqual({
      enabled: false,
      pickerModels: ["pi/anthropic/claude-opus-5"],
    });
    expect(piPickerModels()).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("serves piBridgeAccounts only while enabled with accounts", () => {
    const dir = withConfigFile({ enabled: true, bridgeAccounts: ["acc-1"] });
    expect(piBridgeAccounts()).toEqual(["acc-1"]);
    // Disabled config keeps its ids but designates nothing.
    writeFileSync(
      join(dir, "pi.json"),
      JSON.stringify({ enabled: false, bridgeAccounts: ["acc-1"] })
    );
    expect(piBridgeAccounts()).toEqual([]);
    // Enabled without accounts designates nothing either.
    writeFileSync(join(dir, "pi.json"), JSON.stringify({ enabled: true }));
    expect(piBridgeAccounts()).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});
