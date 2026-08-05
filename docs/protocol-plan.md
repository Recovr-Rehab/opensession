# OpenSession as a protocol — extraction plan

Positioning: **"OpenSession: an open protocol for cloud agent sessions — bring
your own runner, bring your own UI."** The webapp, iOS, Mac and Chrome apps are
official/reference implementations, not the product boundary.

This doc records the 2026-08-05 audit of how far the codebase already is from
that shape, and the concrete extraction steps.

## The two protocols

There are two seams, and they are different protocols with different consumers:

1. **Runner protocol (south side): server ↔ run host.**
   "Bring your own runner." Already effectively spec-shaped:
   - `src/runner-host/protocol.ts` — `RunHostSpec` in, host/client message
     unions, NDJSON framing over unix socket, documented live-only semantics.
   - `src/server/run-events.ts` — engine-neutral `StreamEvent` vocabulary
     (`init`, `text_chunk`, `tool_use`, `tool_result`, `usage_snapshot`,
     `done`, `error`, `model_switch`, `runner_notice`) + `TurnUsage`.
   - `src/runner-host/ws-buffer.ts` — seq/ack replay layer for the remote
     (WS) transport.
   A conformant third-party runner = anything that accepts a `RunHostSpec`
   and emits `StreamEvent`s + persists a transcript. Claude/Codex/opencode
   already prove engine neutrality.

2. **Session protocol (north side): client ↔ server.**
   "Bring your own UI." The de-facto contract is `src/frontend/lib/types.ts`
   (~1160 lines): `UnifiedSession`, `TranscriptEntry`, `SessionDiff`, PR
   types, `AskQuestion`, `ChatMessage`, and the `WSClientMessage` /
   `WSServerMessage` unions (~43 message types), plus ~125 HTTP endpoints
   across `src/server/routes/*`.

Shared middle: the **session record** — the durable stuff a host must persist
and serve: session metadata JSON (`~/.opensession-chats/<id>.json` et al.),
the transcript jsonl, assets, and the ask/answer log. This is the ATProto
"repo"; the streams are the firehose; UIs are app views.

## Audit findings

**Good news — the webapp is already logically detached.** It is a static SPA
bundle that talks to the server exclusively over HTTP + one WS, with every URL
derived from `BASE_PATH` (`src/frontend/lib/base.ts`). There is exactly one
type-level leak across the boundary: `frontend/lib/types.ts` imports
`WorkflowRunSnapshot` from `../../server/workflow-types`. No runtime coupling.
Serving the bundle from the same process is a distribution convenience, not an
architectural coupling — same as a Mastodon instance serving its own web UI.

**The API surface is a superset, not a protocol.** The ~125 endpoints and 43
WS message types mix three tiers:

- **Protocol core** (~30–45 endpoints): session CRUD/list, `prompt` (send/
  steer), `cancel`, transcript fetch + `watch`/`stream_*`/`transcript_append`
  WS flow, asks (`ask_resolved`, human-asks routes), status/usage
  (`session_status`, `usage_update`), diffs/git status, PR refs,
  session-transfer (fork/handoff), assets/uploads, models list.
- **Official-app extensions**: notes (Yjs CRDT), terminal (`term_*`), feeds,
  todos, pins, reports, analytics, workflows UI, presence/typing.
- **Deployment (Tella) extensions**: Plain support, Slack channel links,
  goals, papercuts, deploys, setup-team.

The runner protocol has a few Tella-isms in `RunHostSpec` that must become
extensions or generic capability fields: `aws`, Claude account-pool fields
(`accountId`/`accountStrict`/`usageCredits`), `journalKind`.

## Answer to "do we have to detach the webapp from the server?"

**No — not physically.** What must detach is the *contract*, not the
deployment. The rule that makes "protocol" honest is:

> The official clients consume only the documented protocol surface plus
> explicitly-declared extension namespaces — no private endpoints.

Bluesky's app being a separate deploy from the PDS is incidental; the
requirement is only that the app speaks the same lexicons anyone else can.
Keep serving the SPA from the server binary (it's a feature — single-binary
self-hosting). The litmus test: *could the iOS app be built against only the
documented core?* Today it would need roughly a third of the surface; the rest
is extensions it should either not need or that get declared as such.

## Extraction steps

1. **`@opensession/protocol` package** (answers the npm-name question):
   - Runner protocol: `RunHostSpec` (minus Tella-isms → `extensions` field),
     host/client messages, `StreamEvent`, `TurnUsage`, framing + seq/ack
     semantics.
   - Session record: session metadata schema (core subset of
     `UnifiedSession`), transcript jsonl entry schema, ask records.
   - Session protocol: core HTTP endpoints + core WS message subset.
   - Ship as Zod schemas + inferred types + a small reference TS client;
     version it (`v0`) and treat additive changes as minor.
2. **Fix the one boundary leak** — move `WorkflowRunSnapshot` (or its core
   subset) into the shared package; frontend imports only from the package.
3. **Tier the route modules** — mark each `src/server/routes/*` file core /
   app-extension / deployment-extension; namespace non-core endpoints (e.g.
   `/api/x/plain/...`) so the core surface is enumerable.
4. **De-Tella the runner spec** — account pool, `aws`, `journalKind` move to
   a namespaced extensions bag on `RunHostSpec`.
5. **Second implementation as proof** — a trivial runner in another language
   (Python wrapper around any agent CLI) and/or a read-only TUI viewer built
   only on the published package. Two independent implementations is what
   turns "our types, published" into a protocol.
6. **Then** prose spec + the capability/auth story (per-run bearer tokens +
   scoped MCP allowlists are already the right primitive — formalize).

Non-goals for v0: federation between servers, open relays, identity (DID-like)
portability. Sessions are private and side-effectful; capability scoping, not
open federation, is the trust model.
