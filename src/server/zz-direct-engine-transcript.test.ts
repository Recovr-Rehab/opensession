/**
 * Reading a DIRECT-SDK engine session's transcript by engine session id.
 *
 * The claude-direct and codex-direct engines reuse the legacy provider tags
 * ("claude"/"codex") and session-id slots (claudeSessionId/codexThreadId) of
 * the CLI engines they replace, but they persist their turns into the
 * transcript STORE under the engine session id — there is no worktree jsonl
 * and no codex rollout to parse. readEngineTranscript is the read the
 * cross-engine handoff builds its note from (run-session.ts's prior-engine
 * read, agent-runner's fallback hop), so without a store fallback a handoff
 * FROM one of these sessions hands the incoming engine a blank conversation.
 *
 * Seams: same set as zz-opencode-mirror.test.ts — the writer path talks to
 * the transcriptStore() SINGLETON and to the globalThis-parked oc→unified
 * map, so both are force-replaced with scratch instances here and restored in
 * afterAll (this file is `zz-` for that reason: it mutates process-wide
 * seams).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  __setOpencodeBksMapPathForTest,
  __setOpencodeBksMapStateForTest,
  __restoreOpencodeBksMapStateForTest,
  __setOpencodeDbPathForTest,
  __setOpencodeTranscriptsDirForTest,
  appendOpencodeTranscript,
  recordBksSessionFor,
  transcriptLineAssistantText,
  transcriptLineUser,
} from "./opencode-transcript";
import { __setSessionsDirForTest } from "./paths";
import {
  TranscriptStore,
  __setTranscriptStoreForTest,
} from "./transcript-store";

const scratch = mkdtempSync(join(tmpdir(), "direct-engine-transcript-"));
const priorTranscriptsDir = __setOpencodeTranscriptsDirForTest(
  join(scratch, "transcripts")
);
const priorDb = __setOpencodeDbPathForTest(join(scratch, "opencode.db"));
const priorMapPath = __setOpencodeBksMapPathForTest(join(scratch, "oc-map.json"));
const priorMapState = __setOpencodeBksMapStateForTest();
const sessionsDir = join(scratch, "sessions");
mkdirSync(sessionsDir, { recursive: true });
const priorSessionsDir = __setSessionsDirForTest(sessionsDir);
// The codex arm asks findCodexRollout first; without this it walks this
// host's real ~/.codex rollout tree looking for a uuid that isn't there,
// which is both slow and a read of live data from a unit test.
const priorCodexHome = (await import("./codex-accounts")).__setCodexHomeForTest(scratch);
const priorStore = __setTranscriptStoreForTest(
  new TranscriptStore(join(scratch, "transcripts.db"))
);

// sessions.ts is loaded AFTER the seams above: a static import is hoisted
// ahead of them, and the module graph it pulls in reads the state paths at
// load time — the scratch dirs have to be in place first.
const { readEngineTranscript, readEngineTranscriptAsync } = await import("./sessions");

afterAll(async () => {
  (await import("./codex-accounts")).__setCodexHomeForTest(priorCodexHome);
  __setOpencodeTranscriptsDirForTest(priorTranscriptsDir);
  __setOpencodeDbPathForTest(priorDb);
  __setOpencodeBksMapPathForTest(priorMapPath);
  __restoreOpencodeBksMapStateForTest(priorMapState);
  __setSessionsDirForTest(priorSessionsDir);
  __setTranscriptStoreForTest(priorStore);
  rmSync(scratch, { recursive: true, force: true });
});

/** A direct engine's turn as it lands on disk: the session file whose engine
 *  slot holds the id, the engine→unified mapping (recorded before the runner
 *  yields init), then claude-shape lines into the store. */
function seedDirectEngineTurn(
  engineSessionId: string,
  unifiedId: string,
  slot: "claudeSessionId" | "codexThreadId",
  text: string
) {
  writeFileSync(
    join(sessionsDir, `${unifiedId}.json`),
    JSON.stringify({
      id: unifiedId,
      [slot]: engineSessionId,
      branch: "",
      worktreeDir: scratch,
      createdBy: "Alex",
      createdAt: "2026-08-14T18:00:00.000Z",
      lastActivity: "2026-08-14T18:00:00.000Z",
      mode: "code",
      source: "opensession",
    })
  );
  recordBksSessionFor(engineSessionId, unifiedId);
  appendOpencodeTranscript(engineSessionId, [
    transcriptLineUser(`ask: ${text}`, crypto.randomUUID()),
    transcriptLineAssistantText(`reply: ${text}`, crypto.randomUUID()),
  ]);
  // The owner lookup goes through the 2s session cache; the file was written
  // after this test file's earlier reads warmed it.
  require("./session-cache").invalidateSessionsCache();
}

describe("readEngineTranscript for direct-SDK engine sessions", () => {
  // No worktree jsonl and no codex rollout exists for these ids, which is
  // exactly what tells the reader it is looking at a direct-engine session.
  const worktree = join(scratch, "no-such-worktree");

  test("serves a claude-direct session's history from the store", () => {
    const engineId = crypto.randomUUID();
    seedDirectEngineTurn(engineId, "os-direct-claude", "claudeSessionId", "handoff");
    const entries = readEngineTranscript(worktree, engineId, "claude");
    expect(entries.map((e) => e.content).join("\n")).toContain("reply: handoff");
  });

  test("serves a codex-direct session's history from the store", () => {
    const engineId = crypto.randomUUID();
    seedDirectEngineTurn(engineId, "os-direct-codex", "codexThreadId", "rollout-less");
    const entries = readEngineTranscript(worktree, engineId, "codex");
    expect(entries.map((e) => e.content).join("\n")).toContain("reply: rollout-less");
  });

  test("the async read agrees with the sync one", async () => {
    const engineId = crypto.randomUUID();
    seedDirectEngineTurn(engineId, "os-direct-async", "claudeSessionId", "async");
    const entries = await readEngineTranscriptAsync(worktree, engineId, "claude");
    expect(entries.map((e) => e.content).join("\n")).toContain("reply: async");
  });

  test("an id nothing ever wrote stays empty rather than throwing", () => {
    expect(readEngineTranscript(worktree, crypto.randomUUID(), "claude")).toEqual([]);
    expect(readEngineTranscript(worktree, "", "codex")).toEqual([]);
  });
});
