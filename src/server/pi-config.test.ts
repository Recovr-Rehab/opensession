import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  addPiPickerModel,
  isPiModelId,
  normalizePiConfig,
  piBridgeAccounts,
  piConfigPath,
  piEngineEnabled,
  piPickerModels,
  readPiEngineConfig,
  removePiPickerModel,
  setPiBridgeAccounts,
  setPiEnabled,
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

describe("isPiModelId", () => {
  it("accepts only full pi/<provider>/<model> ids", () => {
    expect(isPiModelId("pi/anthropic/claude-opus-5")).toBe(true);
    expect(isPiModelId("pi/openai/gpt-5.2-codex")).toBe(true);
    for (const bad of [
      "pi/anthropic", // no model segment
      "pi/", // empty remainder
      "opencode/anthropic/claude-opus-5", // wrong engine
      "claude-opus-5", // bare native id
      42,
      null,
      undefined,
    ]) {
      expect(isPiModelId(bad)).toBe(false);
    }
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

describe("write path", () => {
  const rawFile = () => JSON.parse(readFileSync(piConfigPath(), "utf-8"));

  it("setPiEnabled creates the file when missing and toggles in place", () => {
    const dir = withConfigFile();
    setPiEnabled(true);
    expect(rawFile()).toEqual({ enabled: true });
    expect(piEngineEnabled()).toBe(true);
    setPiEnabled(false);
    expect(rawFile()).toEqual({ enabled: false });
    expect(piEngineEnabled()).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes 0600 and preserves unknown fields", () => {
    const dir = withConfigFile({ enabled: false, futureField: { keep: "me" } });
    setPiEnabled(true);
    expect(rawFile()).toEqual({ enabled: true, futureField: { keep: "me" } });
    expect(statSync(piConfigPath()).mode & 0o777).toBe(0o600);
    rmSync(dir, { recursive: true, force: true });
  });

  it("refuses to write over an unparseable file", () => {
    const dir = withConfigFile("{not json");
    expect(() => setPiEnabled(true)).toThrow();
    expect(() => addPiPickerModel("pi/anthropic/claude-opus-5")).toThrow();
    // The broken content survives untouched — nothing clobbered it with {}.
    expect(readFileSync(piConfigPath(), "utf-8")).toBe("{not json");
    rmSync(dir, { recursive: true, force: true });
  });

  it("addPiPickerModel appends idempotently and validates the id", () => {
    const dir = withConfigFile({ enabled: true });
    expect(addPiPickerModel("pi/anthropic/claude-opus-5")).toEqual([
      "pi/anthropic/claude-opus-5",
    ]);
    expect(addPiPickerModel("pi/openai/gpt-5.2-codex")).toEqual([
      "pi/anthropic/claude-opus-5",
      "pi/openai/gpt-5.2-codex",
    ]);
    // Idempotent — a repeat add doesn't duplicate.
    expect(addPiPickerModel("pi/anthropic/claude-opus-5")).toEqual([
      "pi/anthropic/claude-opus-5",
      "pi/openai/gpt-5.2-codex",
    ]);
    // Malformed ids throw instead of writing something the reader drops.
    for (const bad of ["pi/anthropic", "anthropic/claude-opus-5", "opencode/xai/grok-4", ""]) {
      expect(() => addPiPickerModel(bad)).toThrow(/Invalid pi model id/);
    }
    expect(rawFile().pickerModels).toEqual([
      "pi/anthropic/claude-opus-5",
      "pi/openai/gpt-5.2-codex",
    ]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("removePiPickerModel filters the stored list (missing id is a no-op)", () => {
    const dir = withConfigFile({
      enabled: true,
      pickerModels: ["pi/anthropic/claude-opus-5", "pi/openai/gpt-5.2-codex"],
    });
    expect(removePiPickerModel("pi/anthropic/claude-opus-5")).toEqual([
      "pi/openai/gpt-5.2-codex",
    ]);
    expect(removePiPickerModel("pi/never/was-there")).toEqual(["pi/openai/gpt-5.2-codex"]);
    expect(piPickerModels()).toEqual(["pi/openai/gpt-5.2-codex"]);
    rmSync(dir, { recursive: true, force: true });
  });

  it("setPiBridgeAccounts replaces wholesale; empty deletes the field", () => {
    const dir = withConfigFile({ enabled: true, bridgeAccounts: ["old-1"] });
    setPiBridgeAccounts(["acc-1", "acc-2"]);
    expect(rawFile().bridgeAccounts).toEqual(["acc-1", "acc-2"]);
    expect(piBridgeAccounts()).toEqual(["acc-1", "acc-2"]);
    // Empty selection deletes the field — the file stays canonical
    // (bridgeAccounts present always means "at least one designated id").
    setPiBridgeAccounts([]);
    expect("bridgeAccounts" in rawFile()).toBe(false);
    expect(piBridgeAccounts()).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});
