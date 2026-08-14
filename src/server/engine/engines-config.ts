/**
 * Config for the two direct-SDK engines (claude-direct and codex-direct) plus
 * the per-model default-engine map. Mirrors pi-config.ts: one tiny JSON file,
 * read fresh per call so edits apply without a restart, raw read-modify-write
 * on the write path so unknown fields survive, atomic rename + 0600.
 *
 * File: ~/.opensession-engines.json. Missing file or `enabled: false` means
 * that direct engine is OFF everywhere at once: the Engine choice hides it and
 * the runner refuses to start a turn with a clear config error. The
 * OPENSESSION_ENGINES_CONFIG env override is a TEST SEAM, not the feature
 * switch; OPENSESSION_ENGINE_CLAUDE_DIRECT=1 is honored as a legacy alias for
 * the claude gate (the pre-config experimental flag).
 *
 * Shape:
 *   {
 *     "claude": { "enabled": true },
 *     "codex": { "enabled": false },
 *     "modelEngines": { "claude-opus-5": "claude", "gpt-5.6-sol": "codex" }
 *         // Per-model default engine, keyed by the BASE model id (never an
 *         // engine-prefixed id). Values are engine ids; entries for unknown
 *         // engines are dropped by normalization. An explicit engine choice
 *         // on the session (an engine-prefixed model id) always wins over
 *         // this map; the map wins over the global default engine.
 *   }
 *
 * Enablement for the other two engines stays where it lives today:
 * opencode-config.ts and pi-config.ts. This module only gates the direct
 * engines and owns the model-to-engine defaults.
 */

import { chmodSync, existsSync, readFileSync } from "fs";
import { stateDir } from "../paths";
import { writeJsonAtomic } from "../shared/atomic-write";

/** Engine ids, matching models.ts's Provider union and the UI's
 *  ENGINE_LABELS keys. */
export const ENGINE_IDS = ["claude", "codex", "opencode", "pi"] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

/** The two engines this file gates. */
export type DirectEngineId = "claude" | "codex";

export function enginesConfigPath(): string {
  return process.env.OPENSESSION_ENGINES_CONFIG || stateDir("engines.json");
}

export interface EnginesConfig {
  claude: { enabled: boolean };
  codex: { enabled: boolean };
  /** Base model id -> default engine for it. */
  modelEngines: Record<string, EngineId>;
}

function isEngineId(x: unknown): x is EngineId {
  return typeof x === "string" && (ENGINE_IDS as readonly string[]).includes(x);
}

/** Pure normalization (exported for tests): raw JSON to typed config.
 *  Tolerant: anything that is not a JSON object normalizes to the
 *  all-disabled config, and modelEngines entries whose value is not a known
 *  engine id (or whose key is engine-prefixed) are dropped. */
export function normalizeEnginesConfig(raw: unknown): EnginesConfig {
  const off: EnginesConfig = {
    claude: { enabled: false },
    codex: { enabled: false },
    modelEngines: {},
  };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return off;
  const r = raw as Record<string, unknown>;
  const gate = (v: unknown) =>
    !!v && typeof v === "object" && (v as Record<string, unknown>).enabled === true;
  const modelEngines: Record<string, EngineId> = {};
  if (r.modelEngines && typeof r.modelEngines === "object" && !Array.isArray(r.modelEngines)) {
    for (const [model, engine] of Object.entries(r.modelEngines as Record<string, unknown>)) {
      // Keys are base ids; an engine-prefixed key would double-route.
      if (!model || /^(?:opencode|pi|claude|codex)\//.test(model)) continue;
      if (isEngineId(engine)) modelEngines[model] = engine;
    }
  }
  return {
    claude: { enabled: gate(r.claude) },
    codex: { enabled: gate(r.codex) },
    modelEngines,
  };
}

export function readEnginesConfig(): EnginesConfig {
  const path = enginesConfigPath();
  if (!existsSync(path)) return normalizeEnginesConfig(null);
  try {
    return normalizeEnginesConfig(JSON.parse(readFileSync(path, "utf-8")));
  } catch (e) {
    console.warn(`[engines-config] Failed to parse ${path}:`, e);
    return normalizeEnginesConfig(null);
  }
}

/** Whether a direct engine may run at all. The claude gate also honors the
 *  legacy experimental env flag so existing test rigs keep working. */
export function directEngineEnabled(engine: DirectEngineId): boolean {
  if (engine === "claude" && process.env.OPENSESSION_ENGINE_CLAUDE_DIRECT === "1") {
    return true;
  }
  return readEnginesConfig()[engine].enabled;
}

/** The configured default engine for a BASE model id, or null when unset.
 *  Callers pass the base id (strip any engine prefix first). */
export function modelEngineDefault(model: string): EngineId | null {
  return readEnginesConfig().modelEngines[model] ?? null;
}

export function modelEngineDefaults(): Record<string, EngineId> {
  return readEnginesConfig().modelEngines;
}

// Write path (Settings). Raw read-modify-write so fields this module does not
// own survive a save; fail loudly on an unparseable existing file rather than
// clobbering it.

function readRawEnginesConfig(): Record<string, unknown> {
  const path = enginesConfigPath();
  if (!existsSync(path)) return {};
  const raw = JSON.parse(readFileSync(path, "utf-8"));
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Cannot update ${path}: existing content is not a JSON object`);
  }
  return raw as Record<string, unknown>;
}

function writeRawEnginesConfig(raw: Record<string, unknown>): void {
  const path = enginesConfigPath();
  writeJsonAtomic(path, raw);
  chmodSync(path, 0o600);
}

/** Turn a direct engine on or off. */
export function setDirectEngineEnabled(engine: DirectEngineId, enabled: boolean): void {
  const raw = readRawEnginesConfig();
  const existing =
    raw[engine] && typeof raw[engine] === "object" && !Array.isArray(raw[engine])
      ? (raw[engine] as Record<string, unknown>)
      : {};
  raw[engine] = { ...existing, enabled };
  writeRawEnginesConfig(raw);
}

/** Set (engine id) or clear (null) the default engine for a base model id.
 *  Throws on an engine-prefixed model key or an unknown engine id, matching
 *  normalizeEnginesConfig's drop rules so a UI write can never store an entry
 *  the reader would silently discard. */
export function setModelEngineDefault(model: string, engine: EngineId | null): Record<string, EngineId> {
  if (!model || /^(?:opencode|pi|claude|codex)\//.test(model)) {
    throw new Error(`Invalid model key "${model}" (pass the base model id, not an engine-prefixed one)`);
  }
  if (engine !== null && !isEngineId(engine)) {
    throw new Error(`Unknown engine "${engine}" (expected one of ${ENGINE_IDS.join(", ")})`);
  }
  const raw = readRawEnginesConfig();
  const map =
    raw.modelEngines && typeof raw.modelEngines === "object" && !Array.isArray(raw.modelEngines)
      ? { ...(raw.modelEngines as Record<string, unknown>) }
      : {};
  if (engine === null) delete map[model];
  else map[model] = engine;
  raw.modelEngines = map;
  writeRawEnginesConfig(raw);
  return normalizeEnginesConfig(raw).modelEngines;
}
