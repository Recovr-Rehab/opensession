# Transcripts

How session transcripts are stored and served. Contributor doc — nothing here
is operator configuration.

## The store

Open Session owns every transcript as a per-session, sequence-numbered event
log in one SQLite database (WAL): `<sessions dir>/transcripts.db`, managed by
`src/server/transcript-store.ts`.

- A row is one parsed `TranscriptEntry`: `(session_id, seq)` primary key,
  dense 1-based `seq` per session, unique `(session_id, uuid)` for dedup —
  re-appending an entry id updates the row in place but keeps its original
  `seq`, which is what makes streamed assistant rewrites ("same id, last
  wins") work.
- Session ids are **unified** ids (`bks-…`, `slack-…`, `linear-…`), never
  engine session ids; `src/server/opencode-transcript.ts` keeps the
  engine-id → unified-id map, so engine account rotation (many engine ids,
  one session) doesn't fragment a transcript.
- Entries over 32 KB are stored twice: the full entry in a blob table, and a
  stripped wire form in the event row (content clamped, tool input
  summarized, images replaced by `os-blob:` markers). The UI resolves
  `os-blob:` markers and full entries through the `/entry` route.
- **Exactly one writer: the live server process.** No standalone script
  writes `transcripts.db`; backfills run in-process, and sandbox run-hosts
  proxy their appends through the server.

Appends publish on an in-process bus (`src/server/transcript-bus.ts`), so
live viewers of server-owned sessions get pushes, not polling.

## Serving to the UI

The client advertises `supportsSeq` on `watch`; the server serves seq-mode
when it owns the session and the store has it:

- init: a small `transcript_init` tail plus a `transcript_history` page
  moments later; older pages via `load_history {beforeSeq}`; reconnects
  resume with `sinceSeq` — no snapshot re-send.
- live: bus-driven `transcript_append` frames carrying `seq`.

Sessions the server does *not* own — CLI/tmux runs writing their own
transcript files — are served by the legacy file-watcher + byte-offset
protocol instead, and any seq-mode failure degrades to that same path. The
client keeps both modes and picks by what the init frame carries.

## Model-visible means logged

A turn's model input is more than the message a human typed: an engine handoff
transcript, the per-turn repos/memory note, an attached session's excerpt, a
ticket's context. `src/server/prompt-context.ts` fences those payloads so the
rendered conversation stays the human's own words — which used to mean they
were written down nowhere, so a stored session could not reproduce the request
that produced its answers.

`src/server/context-log.ts` records each one as an ordinary entry: a `system`
entry tagged `noticeKind: "context-injection"`, carrying the payload verbatim
plus its `contextInjection` metadata (`source` — handoff, repos-note, memory,
attached-session-excerpt, preamble… — and the `turnId` it rode with). Riding
the normal entry path is the point: blob-splitting bounds a 180KB handoff like
any other oversized entry, and the ws protocol needs no new frame.

- **Choke point**: `runOnModel` (`src/server/agent-runner.ts`) — the single
  dispatch for every engine (opencode, pi, claude-direct, codex-direct, the
  test fake) and every model of a fallback walk. The opencode runner calls in
  as well for the same-engine-restart handoff it prepends *below* that point;
  entry ids are content-derived, so overlapping calls upsert one row.
- **Attribution rides the fence**, not the call site: `wrapContext(body,
  source)` writes `<opensession:context source="…">`, so a new injection site
  is logged whether or not its author remembers this file (untagged blocks log
  as `unknown`).
- **Not conversation**: every client-bound projection drops them
  (`dropContextInjections`), as do the handoff builders and transcript
  excerpts — an injection record must never be folded back into the next
  prompt, or into a recap.

## Imports and drift

Legacy/external transcript files are imported into the store on first touch
(import happens *before* the first live append, so history always precedes
live rows in `seq`), and a session whose external file grows past its import
watermark is re-imported — the uuid upsert makes re-import idempotent. The
legacy parsers exist for exactly this: import sources and external-session
serving, not as an alternate store.

## Adjacent pieces

- **Session metadata** (the session JSON files) is written through
  `updateSessionFile(sessionId, mutator)` in `src/server/session-cache.ts` —
  a per-session mutex where each caller overlays only the fields it owns.
- **Engine boundary**: `src/server/engine/` defines the `EngineAdapter`
  surface (`startTurn` as an event stream, plus steer/cancel/reattach) that
  the transcript pipeline consumes; OpenCode is the production adapter.
- **Snapshot fixtures**: scripted sessions run through the real pipeline on a
  fake engine, freezing both the entries written here and the prompt/config
  the engine received. See [transcript-snapshots.md](transcript-snapshots.md);
  a change to context fencing, MCP scoping or handoff notes shows up there as
  a fixture diff.
- Deleting a session purges its transcript rows and blobs.
