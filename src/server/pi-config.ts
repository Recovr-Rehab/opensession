/**
 * Config for the pi engine (pi.dev's coding agent, served by pi-runner.ts).
 *
 * File: ~/.opensession-pi.json — missing or `enabled: false` means the pi
 * engine is OFF everywhere at once: `pi/<provider>/<model>` ids are absent
 * from the UI picker (refreshPiPickerModels in models.ts folds pickerModels
 * only while enabled) AND the runner refuses to start a turn with a clear
 * config error. Deliberately config-driven, never an env flag; the
 * OPENSESSION_PI_CONFIG override is a TEST SEAM (like
 * OPENSESSION_OPENCODE_CONFIG — verify scripts point it at a temp file), not
 * the feature switch.
 *
 * Shape:
 *   {
 *     "enabled": true,
 *     "pickerModels": ["pi/anthropic/claude-opus-5"],
 *         // Full pi/<provider>/<model> ids to surface in the UI model
 *         // picker; malformed entries are dropped. Any other well-formed
 *         // pi/ id still resolves (resolveModel's pi/ branch) — it's just
 *         // not advertised. v1 serves only pi/anthropic/* (the loopback
 *         // Anthropic bridge); other providers error clearly at run time.
 *     "bridgeAccounts": ["<claude-accounts id>"]
 *         // Optional: designated accounts for the loopback Anthropic bridge
 *         // when opencode's own bridgeAccountIds list is empty — same
 *         // never-the-pool containment (anthropic-bridge.ts walks exactly
 *         // these ids through the usable-account gate). Absent (the
 *         // default) = pi rides whatever opencode designates.
 *   }
 *
 * Read fresh per call (tiny file) so edits apply without a restart. No write
 * path and no secrets in v1 — the file is hand-edited, so plain reads with a
 * fail-soft null are enough (mirrors opencode-config.ts).
 */

import { existsSync, readFileSync } from "fs";
import { stateDir } from "./paths";

/** Pi-config file path (env override is a test seam, not the feature flag). */
export function piConfigPath(): string {
  return process.env.OPENSESSION_PI_CONFIG || stateDir("pi.json");
}

export interface PiEngineConfig {
  enabled: boolean;
  /** Model ids (pi/<provider>/<model>) to show in the UI picker. */
  pickerModels: string[];
  /** Designated claude-accounts ids that may serve the loopback Anthropic
   *  bridge when opencode's bridgeAccountIds list is empty (never the pool —
   *  see anthropic-bridge.ts). Absent = no pi-side designation. */
  bridgeAccounts?: string[];
}

/** Pure normalization (exported for tests): raw JSON → typed config. Tolerant
 *  — anything that isn't a JSON object normalizes to the disabled config, and
 *  pickerModels entries that aren't full `pi/<provider>/<model>` ids are
 *  dropped (a bare "pi/foo" would otherwise mint a bogus opencode passthrough
 *  downstream). bridgeAccounts keeps non-empty strings only; nothing left (or
 *  not an array) normalizes to the field being absent, so `bridgeAccounts`
 *  present always means "at least one designated id". */
export function normalizePiConfig(raw: unknown): PiEngineConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { enabled: false, pickerModels: [] };
  }
  const r = raw as Record<string, unknown>;
  const pickerModels = Array.isArray(r.pickerModels)
    ? r.pickerModels.filter(
        (x: unknown): x is string =>
          typeof x === "string" &&
          x.startsWith("pi/") &&
          x.slice("pi/".length).includes("/")
      )
    : [];
  const bridgeAccounts = Array.isArray(r.bridgeAccounts)
    ? r.bridgeAccounts.filter(
        (x: unknown): x is string => typeof x === "string" && !!x
      )
    : [];
  return {
    enabled: r.enabled === true,
    pickerModels,
    ...(bridgeAccounts.length ? { bridgeAccounts } : {}),
  };
}

export function readPiEngineConfig(): PiEngineConfig | null {
  const path = piConfigPath();
  if (!existsSync(path)) return null;
  try {
    return normalizePiConfig(JSON.parse(readFileSync(path, "utf-8")));
  } catch (e) {
    console.warn(`[pi-config] Failed to parse ${path}:`, e);
    return null;
  }
}

/** Whether the pi engine may run at all. */
export function piEngineEnabled(): boolean {
  return readPiEngineConfig()?.enabled === true;
}

/** Pi model ids to surface in the UI picker (empty when disabled). */
export function piPickerModels(): string[] {
  const cfg = readPiEngineConfig();
  if (!cfg?.enabled) return [];
  return cfg.pickerModels;
}

/** Designated bridge accounts for pi runs — empty unless the engine is
 *  enabled AND names accounts, so callers can treat non-empty as "pi may
 *  serve bridge traffic on these ids". */
export function piBridgeAccounts(): string[] {
  const cfg = readPiEngineConfig();
  if (!cfg?.enabled) return [];
  return cfg.bridgeAccounts || [];
}
