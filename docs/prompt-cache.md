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
bun scripts/cache-report.ts --prefix   # expiry vs prefix breakage
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

That last claim needs one correction, which `--prefix` exists to supply. Five
minutes is not tight enough for OpenAI, whose cache decays inside two, and a
first-of-turn request is not always a continuation: a compaction call, a switch
of agent, or a change of reasoning effort sends a different prompt on purpose.
Both of those inflate what the bucket reads as breakage, and on OpenAI they
inflate it by roughly six times. See the OpenAI section below.

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

## OpenAI: mostly not what it looked like

The headline above says OpenAI holds essentially all the uncached input, and
that the shared `gpt-5.6-sol` first-of-turn requests sit at 53.3% on the hot
bucket, roughly $2019 a week of list-price headroom. That is all true and all
misleading. The hit rate cannot separate a cache that aged from a prefix that
changed, because OpenAI bills both as uncached input, and the turn-position
table cannot separate either of those from a request that was never a
continuation in the first place.

`bun scripts/cache-report.ts --prefix` adds the missing instrument. It scores
each request against the one before it in the same session,

    coverage = cacheRead(N) / prompt(N-1)

and buckets that by the gap between them. Coverage near 1 means the request read
back everything its predecessor had sent, which is what a stable prefix should
produce. The gap buckets then tell expiry and breakage apart by shape rather
than by level: expiry decays as the gap grows, a changed prefix is a floor that
is already there at 30 seconds.

The other half is a control. A compaction call, a different agent and a
different reasoning-effort variant each send a deliberately different prompt, so
scoring them against their predecessor books a design decision as a cache
failure. Classifying those out is most of the finding.

### Where the uncached input actually goes

Same 7 days to 2026-08-16, all 59.8k OpenAI requests, 665.0M uncached input.
The dollar column is list-price headroom at `gpt-5.6-sol` rates, the same
convention the report uses.

| cause | requests | uncached in | share | headroom |
| --- | --- | --- | --- | --- |
| mid-turn, new tool output | 55.7k | 318.5M | 47.9% | $1432 |
| session start | 2.3k | 178.2M | 26.8% | $801 |
| agent/variant/model switch | 597 | 77.4M | 11.6% | $348 |
| continuation across a turn | 889 | 74.7M | 11.2% | $336 |
| compaction call | 213 | 16.6M | 2.5% | $75 |

Only the fourth row is a turn boundary that should have hit a warm cache, and it
is 11% of the total. Nearly half is mid-turn traffic reading a full context back
at 99% coverage and paying only for the tool output just appended, which is
inherent to a tool-calling turn and is not a cache problem. A quarter is the
first request of a session, which has no predecessor to hit.

### On true continuations, it is expiry

Restricted to boundaries where agent, variant and model are unchanged:

| gap since previous | reqs | coverage | full | zero |
| --- | --- | --- | --- | --- |
| <30s | 88 | 92.3% | 87.5% | 1.1% |
| 30s-1m | 50 | 84.5% | 70.0% | 0.0% |
| 1-2m | 65 | 71.7% | 53.8% | 1.5% |
| 2-5m | 143 | 69.6% | 55.2% | 6.3% |
| 5-10m | 177 | 78.4% | 69.5% | 6.2% |
| 10-20m | 138 | 62.3% | 46.4% | 11.6% |
| 20-40m | 88 | 42.6% | 18.2% | 21.6% |
| 40-60m | 19 | 20.8% | 5.3% | 47.4% |
| >6h | 64 | 6.7% | 0.0% | 75.0% |

That is a decay, not a floor. At under 30 seconds, where nothing can have aged,
coverage is 92.3% and one request in ninety reads nothing. The remaining 8% is
the 128-token block granularity plus the genuinely new tail. By 40 minutes half
the requests read nothing at all. OpenAI's automatic cache is documented as
minutes of inactivity and this is what minutes of inactivity looks like, so the
answer to "for hot requests well inside the TTL, what fraction of the prefix
still misses" is: about 8%, and essentially none of it is a full miss.

Anthropic's continuation row falls off in the same shape, and means something
different: its shortfall lands in `cache write` rather than in uncached input,
so the whole Anthropic continuation row is 2.2k uncached tokens for the week
against OpenAI's 74.7M. Same instrument, two very different bills.

### The one real break: changing reasoning effort mid-session

The `agent/variant/model switch` row is 77.4M of uncached input, and the variant
part of it is not a different prompt at all. Holding agent, model and gap fixed
and requiring the prompt to be within +0/+10% of its predecessor leaves the
effort variant as the only thing that moved:

| variant across the boundary | pairs | coverage | zero |
| --- | --- | --- | --- |
| unchanged | 176 | 87.0% | 1.1% |
| changed | 43 | 15.8% | 60.5% |

Individual pairs make it plainer than the aggregate. One `xhigh` to `high`
boundary sent 216,384 tokens against its predecessor's 216,405, 116 seconds
later, and read zero. Several `high` to no-variant boundaries appended a single
user message to a 100k-plus context, seconds apart, and read zero. Nothing had
expired and nothing of substance had changed in the text.

So changing the reasoning effort within a session discards the entire OpenAI
prefix. `variant` is sent per prompt from `openaiPromptVariant` over
`dial?.effort ?? orch?.effort ?? opts.effort` (`opencode-runner.ts`), so a
preset whose effort is re-picked per turn pays a full context re-read every time
it changes its mind. 300 such boundaries occurred in the window.

Two things are deliberately *not* concluded here. The mechanism, whether OpenAI
folds request parameters into the cache lookup or opencode reshapes the input
when effort changes, is not established, only the effect. And the 141 boundaries
involving an absent variant are unexplained: `normalizeModelEffort` cannot
return undefined for a `gpt-5.` model, so those requests were probably issued by
opencode itself rather than through our prompt path, which would make them a
different phenomenon wearing the same clothes.

### What was checked and found already correct

`prompt_cache_key` is already set, and per session. opencode sets
`promptCacheKey = sessionID` for any provider whose npm package is
`@ai-sdk/openai` (among others), our `openai` provider resolves to exactly that
package in `~/.cache/opencode/models.json`, and the `setCacheKey` provider
option that would disable it defaults to on. So the obvious cheap fix is not
available: it is already in place, and the only lever opencode exposes is
turning it off, not choosing its value.

That leaves one upstream option worth naming. The OpenAI SDK in the bundled
opencode binary accepts `promptCacheRetention: "24h"` and `promptCacheOptions`,
which is the parameter that would attack the dominant cause, expiry. opencode
does not pass either: its provider-option whitelist covers `store`,
`promptCacheKey`, `reasoningEffort`, `reasoningSummary`, `include`,
`textVerbosity` and `serviceTier`, and nothing else reaches the call. Enabling
it therefore requires an upstream change, and before that it needs an answer to
whether extended retention is even honoured on the ChatGPT-subscription backend
our codex accounts use, and how it is billed. That is why nothing was landed
here.

### If someone picks this up

The measurement to make first is the effort one, because it is the only
identified breakage and it is ours rather than upstream. Stop re-picking the
effort variant within a session and the 43 matched pairs a week that currently
read 15.8% should read 87%. It was not landed in this pass because the effort a
run uses is a model-behaviour decision, not a caching one, and trading reasoning
quality for cache hits is not a call to make inside a measurement task.

Whatever changes, the before/after is the same three numbers, over the same
7-day window, run before the change and a day after the restart:

- `--prefix` continuation coverage in the `<30s` and `30s-1m` buckets, which
  should be unaffected by anything except a genuine prefix fix;
- the effort-variant control table, where the `changed` row is the target;
- the cause table's `agent/variant/model switch` share of uncached input.

The trap to avoid is the headline hit rate. It moves with traffic mix, since a
week with more session starts or more compaction looks worse without anything
having regressed, and it is what made this look like a $2019 breakage rather
than a $336 one.

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
