# Prompt cache

Almost every token we send is a token we have sent before. A turn is one model
request per tool round, each one re-sending the whole conversation, so what a
run costs is decided less by how much it writes than by how much of its prompt
the provider will serve from cache. This is how to measure that, what the
measurement currently says, and the one change worth making.

## Measuring it

```sh
bun scripts/cache-report.ts            # last 7 days
bun scripts/cache-report.ts --days 30
bun scripts/cache-report.ts --json
```

It reads the engines' own message stores, the same ones `engine-usage.ts` reads
and for the same reason: the audit log records one `result` event per turn, so
it cannot see the individual requests a cache served or missed. The headline is

    hit rate = cacheRead / (cacheRead + uncachedInput)

and the report splits it by server pool, by provider and model, and by turn
position. Two of those need explaining, because the headline number on its own
gets this subject wrong in both directions.

**Read the write column, not only the hit rate.** The providers bill a broken
prefix differently. Anthropic sorts prompt tokens into three buckets, read from
cache, written to cache, and uncached, so a prefix that changed is re-cached
into `cache_creation` rather than billed as input. Our Anthropic traffic sits at
2 to 3 uncached input tokens per request no matter what happens, which makes the
hit rate a flat 100% and completely blind: the tokens still cost double, because
a 1-hour-TTL write is 2x base input. OpenAI has no write bucket and the same
breakage does surface as uncached input. So `read/req` and `write/req` are the
honest signal on both. A request that re-reads a whole context and writes a small
delta is healthy; one that reads little and writes a whole context is churning
its prefix, whatever its hit rate says.

**Turn position is the instrument.** Within a turn the prefix cannot change, so a
tool round always re-reads what the round before it wrote. A prefix that is
unstable *across* turns can only show up on the first request of a turn, and only
then if the cache should still have been warm. The report buckets those by how
long since that session's previous request. The under-5-minute bucket is the one
that admits no excuse: on both providers the cache is certainly still live, so a
miss there is a prefix that changed rather than a cache that aged.

## What it says today

Measured over the 7 days to 2026-08-16, 134.6k priced opencode requests:

| pool | requests | uncached in | cache read | cache write | hit rate |
| --- | --- | --- | --- | --- | --- |
| shared | 110.9k | 493.8M | 23.73B | 737.5M | 98.0% |
| per-session | 23.7k | 171.4M | 2.76B | 203.1M | 94.1% |

Overall 97.5% of 27.13B prompt tokens came back from cache.

### The per-prompt `system` append is not a problem

Eligible interactive runs multiplex onto a shared `opencode serve`, where the
session-context block rides the per-prompt `system` param rather than the server
config (`opencode-runner.ts`, the "Server lifecycle" note). Whether that breaks
the provider's prefix cache had been an open question. It does not:

- the shared pool is not worse than the per-session pool on any cut;
- on hot first-of-turn requests it reads *more* cache, 93.5k/req against 77.7k.

The mechanism explains why. Per-session servers deliver the same text through an
instructions file, and the server config hash covers that file's PATH, not its
content. Both pools therefore feed identical text into the system prefix and
differ only in transport, which is exactly what the numbers show. Nothing here
needs fixing, and the volatile values that are deliberately kept out of the
config hash should stay out of it: putting them back in would respawn servers
instead of stabilising anything.

### Session memory is the problem

The prefix does get invalidated, just not by the transport. `renderSessionMemoryNote`
(`session-memory.ts`) renders repo, user and team memory into the system prompt.
On this instance that block is roughly 290KB, about 70k tokens, and it changes
whenever any session stores a memory: team scope is global, and repo scope hits
every session on that repo.

Correlating requests against the `at` timestamps on memory entries, restricted to
hot (under 5 minutes) first-of-turn Anthropic requests over the same 7 days:

| gap since previous request contained | requests | read/req | write/req | read share |
| --- | --- | --- | --- | --- |
| a memory write | 47 | 51,984 | 188,774 | 21.6% |
| no memory write | 676 | 94,506 | 108,758 | 46.5% |

A memory write roughly halves the cache read and raises the re-write by about
74%, some 80k extra tokens re-cached per affected request. Uncached input stays
at 2 to 3 tokens in both rows, which is why this was invisible until the write
column existed. There were 198 memory adds in the window.

Two honest limits on that table. Memory entries record additions, so edits and
deletions are missing from the timeline and the effect is if anything
understated. And the correlation is mostly cross-session, one session's write
against another's next request, which is what makes it credible as cause rather
than as a property of sessions that happen to write memory.

It also does not explain everything: the no-write row still re-writes 108.8k per
request, so something else moves the prefix at turn boundaries. Breakpoint
placement inside the bridge is the obvious suspect and is not ours to set.

## Inventory: what mutates the prefix

Everything below lands in the system prompt through `buildRunInstructions`,
reaching shared servers as the per-prompt `system` param and per-session servers
as the instructions file.

| payload | source | changes |
| --- | --- | --- |
| policy text (data handling, AWS, GitHub owners) | `run-instructions.ts` | never |
| ask/scratch/repo-less briefings, PR flow, denied-tool notes | `run-instructions.ts` | per run, stable within a session |
| dial oracle / orchestrator notes | `run-instructions.ts` | when the model preset changes mid-session |
| `presetNote` | session record | never after creation |
| branch and stack discipline | `buildBranchNote` | when the branch or worktree changes |
| repos note | `buildReposNote` | when a repo is attached or detached |
| personal prompt | `personalPromptNoteFor` | when the user edits it in Settings |
| **session memory** | `renderSessionMemoryNote` | **whenever any session stores a memory** |
| Desk live-state briefing | `deskBriefingFor` | **every turn, by construction** |
| instance-local instructions | `readLocalInstructions` | when `AGENTS.local.md` is edited |

Only the last two are dynamic by design. The Desk briefing is the purer instance
of the anti-pattern, since it is rebuilt per turn and says so in its own text,
but there are currently zero Desk sessions on this instance, so it costs nothing
today. Memory is the one that is both dynamic and expensive.

The tool list is the other half of a prefix and is worth stating: `tools` strips,
the selected agent, and the MCP server set all sit ahead of the conversation, so
attaching a repo or changing a preset mid-session moves them.

## Plan: memory as a PromptContext

The fix is the pattern the system prompt is supposed to follow anyway. Keep the
system prompt static and ordered, and deliver every dynamic fact as a durable
user-role snapshot appended after retained history, re-emitted only when its
content changed. History does not invalidate a prefix; the system prompt does.

The delivery mechanism already exists. `wrapContext` (`prompt-context.ts`) fences
a block so the transcript strips it from the rendered conversation, and it
already neutralises nested sentinels against breakout. Automation runs already
receive memory this way, appended to the prompt rather than to the system block
(`automations.ts`), so user-role memory is established practice here rather than
a new idea.

This is written as a plan and not as a landed change deliberately. The measurement
above is worth having on its own, and the conversion has a silent failure mode,
memory absent from a run that believes it was already delivered, on an instance
whose team memory carries the shared-checkout git discipline. The economics do
not force it: roughly 47 affected requests a week, about $38 of list-price
equivalent, on capacity that is billed as a subscription anyway.

Three things have to be true before it lands.

**Convert both turn-1 paths in the same change.** Turn 1 builds its note in
`session-create.ts`; turns 2 and later build it in `run-session.ts` through
`buildSessionNote`. Converting only the second flips the system string between
turn 1 and turn 2 and buys a guaranteed prefix break at the start of every
session in exchange for a stochastic one. Move only the `renderSessionMemoryNote`
output: `memoryNoteFor` also carries the personal prompt, and the static
paragraph teaching the `opensession-memory` tools should stay in the system
prompt, where it costs nothing to cache and is followed more reliably.

**Key the change detection on the compaction epoch, not just the session.** The
obvious key is the engine session id plus a content hash, so a fresh or switched
engine session re-injects. That covers restart recovery, which resumes the same
engine session with its history intact. It does not cover autocompact, which
replaces history *within* one engine session id: after a compaction the hash
still matches, the session id still matches, and the memory block survives only
as whatever the summary kept. "History is append-only" is true of the transcript
store and false of the model's live context. The runner already observes
compaction, so the state must be invalidated when it does. Today's design is
immune to this because the system prompt rides every request, and the conversion
trades that immunity away, so it has to be bought back explicitly.

**Inject deltas, not the whole block.** Re-emitting 70k tokens on every memory
write appends them to history permanently and drags the next compaction forward.
Memory is append-mostly, so send the full block once per (engine session,
compaction epoch) and only the new entries on a change.

Land it behind a flag defaulting to current behaviour, with unit tests covering
engine-session replacement and a simulated compaction, and watch `write/req` in
`scripts/cache-report.ts` for a day after the restart. The instrument that makes
the rollback decision cheap already exists, which is the argument for using it
deliberately rather than landing blind.
