# Rust backend rewrite plan

## Summary

Rewrite the Open Session backend incrementally, preserving the web, native, and
Chrome client protocols while moving runtime ownership to Rust one service at a
time. Do not replace the backend in one cutover.

The main performance goal is not simply “use Rust.” It is to:

1. remove blocking filesystem, SQLite, parsing, and process work from the
   network runtime;
2. execute independent sessions on different cores;
3. retain strict serialization for mutations within one session;
4. bound every queue and expensive resource;
5. measure improvements against repeatable production-shaped workloads.

The current backend is already split into a gateway, a multi-lane SessionKernel
service, an executor, and detached run hosts. Those boundaries make a staged
rewrite possible. Rust should preserve them initially rather than combining all
work into a new monolith.

A rewrite will improve gateway responsiveness, concurrent session capacity,
memory use, startup time, transcript work, and CPU-bound control-plane tasks. It
will not materially reduce model-provider latency, GitHub latency, sandbox
startup, or the duration of agent tools. Those need separate product and
provider optimizations.

## Scope and completion definitions

The tracked non-frontend TypeScript server and protocol tree currently contains
roughly 960 files and 279,000 lines including tests. Treat this as a multi-stage
migration, not a translation project.

### Practical completion

The public gateway, authentication and policy enforcement, session authority,
persistence, WebSocket control plane, schedulers, effects, executor, and run
orchestration run in Rust. A small Bun process may remain behind a private,
versioned adapter protocol for JavaScript-only model or provider SDKs.

This is the recommended first destination. Rust owns every durable decision and
security boundary even when an adapter invokes a JavaScript SDK.

### Pure-Rust completion

Replace the remaining engine and provider adapters and remove Bun from the
production runtime. The TypeScript/React frontend remains unchanged and is
built ahead of deployment.

Make this a separate final program. Reimplementing fast-moving AI SDKs early
would add risk without improving the main gateway and concurrency bottlenecks.

## Non-goals

- Do not rewrite the frontend, native apps, or Chrome extension.
- Do not redesign the external client protocol during the language migration.
- Do not replace SQLite merely because the implementation language changes.
- Do not parallelize mutations within one session.
- Do not introduce a second live writer or dual-write session state.
- Do not use Rust FFI inside Bun. Use process boundaries and versioned protocols.
- Do not change security policy, tool availability, or credential scope as an
  incidental part of the rewrite.
- Do not claim success from microbenchmarks alone.

## Current boundaries to preserve

The migration must start from the architecture documented in
[Session kernel architecture](session-kernel-architecture.md),
[Executor architecture](executor-architecture.md), and
[Transcripts](transcripts.md).

The important invariants are:

- One `SessionKernel` actor is the logical and physical mutation owner for a
  canonical session ID.
- One session is serialized. Different sessions may run concurrently.
- Per-session SQLite databases are authoritative; the central database is a
  placement and wake catalog.
- The online service never scans or opens every actor database. Cross-session
  views use catalog-maintained projections and counters.
- External work is emitted as durable, fenced, retryable effects. Actor turns
  stay short and do not wait for models, Git, sandboxes, filesystems, or the
  network.
- The gateway, kernel, and executor fail closed when ownership, credentials, or
  protocol compatibility is ambiguous.
- Run hosts receive a minimal environment and explicit tool/MCP policy.
- Client command request IDs, run IDs, generations, effect IDs, transcript
  change cursors, and deletion tombstones retain their current semantics.
- Service startup, shutdown, deployment, and schema rollback checks remain
  ordered and health-gated.

A Rust implementation that violates one of these invariants is not a valid
migration even if its benchmark is faster.

## Target architecture

```text
Web/native/Chrome clients
            |
            v
  Rust gateway (Tokio + Axum)
    |       |        |
    |       |        +--> integrations and projections
    |       +-----------> Rust SessionKernel service
    +-------------------> Rust executor / run-host control
                                 |
                                 +--> Rust-native engine adapter, or
                                      private Bun compatibility adapter
```

Keep the existing process roles and the current three-service supervision
boundary for the first complete Rust release:

1. `opensession server`
2. `opensession session-kernel-service`
3. `opensession executor`
4. `opensession runner-host`
5. `opensession mcp-proxy`
6. `opensession transcript-search-worker`
7. CLI commands

They can ship as one Rust multi-call binary with subcommands, matching the
current compiled executable model. Separate processes retain failure isolation,
minimal environments, credentials, and independent capacity limits.

### Proposed Cargo workspace

| Crate | Responsibility |
| --- | --- |
| `opensession-protocol` | Versioned HTTP, WebSocket, executor, run-host, MCP, and record types using `serde` |
| `opensession-domain` | IDs, fences, state machines, policy decisions, errors, and pure reducers |
| `opensession-storage` | SQLite schemas, migrations, transactions, placement routing, actor connection LRU, and writer claims |
| `opensession-kernel` | Per-session command mailboxes, timers, outbox, quarantine, and actor RPC |
| `opensession-gateway` | Axum routes, WebSockets, auth, static frontend, limits, and request lifecycle |
| `opensession-coordinator` | Schedulers, effect dispatch, recovery, projections, and shutdown fencing |
| `opensession-executor` | Fixed-policy detached host launch, inspect, stop, and capacity admission |
| `opensession-run-host` | Engine lifecycle, journaling, cancellation, transcript relay, and MCP proxying |
| `opensession-integrations` | GitHub, Slack, storage, webhooks, and other HTTP integrations |
| `opensession-engine-protocol` | Private streaming contract for native and compatibility engine adapters |
| `opensession-observability` | `tracing`, metrics, health/readiness, audit fields, and redaction |
| `opensession` | Multi-call binary, config loading, service composition, and CLI |

Keep dependency direction one way: transport and integrations may call domain
interfaces, but domain reducers must not import HTTP clients, process launchers,
or SDKs.

### Concurrency model

Use different pools for different work instead of putting everything on Tokio's
worker threads.

- **Network runtime:** a Tokio multi-thread runtime handles HTTP, WebSockets,
  timers-as-wakes, and nonblocking sockets.
- **Session actor lanes:** route canonical session IDs to a bounded set of OS
  threads or dedicated blocking lanes. Each session has a FIFO mailbox and
  stable lane affinity while active. Separate sessions can commit in parallel.
- **SQLite:** keep a connection per activated actor in a bounded LRU. Run
  transactions only on actor/storage lanes. Never call `rusqlite` from an async
  network task. Preserve the current short busy timeout and session quarantine
  behavior.
- **CPU pool:** use a bounded Rayon pool for parsing, indexing, hashing, diff
  preparation, compression, and other measured CPU-heavy pure work.
- **External work:** Git, process launch, provider SDKs, sandboxes, object
  storage, and MCP calls run in bounded task groups with per-kind semaphores and
  cancellation tokens.
- **Backpressure:** all channels are bounded. Overload returns an explicit
  retryable response or waits within a documented deadline. It must not create
  unbounded tasks or buffers.

Do not hold an actor mailbox across an `await`. An actor reduction validates and
commits a fact, emits a fenced effect, and releases the mailbox. Completion
returns as another typed fact.

During the kernel prototype, benchmark two storage-lane designs:

1. N long-lived actor threads with lane-local SQLite connection caches;
2. async actor mailboxes dispatching transactions to an N-thread storage pool.

Choose based on p95 queue delay, fairness under one locked database, memory per
active actor, and crash behavior. The design must preserve per-session ordering
without a global lock.

## Performance contract

Phase 0 must record baselines on the same hardware, data fixture, release build,
and kernel settings. Ratify exact targets after collecting the baseline. The
initial program targets are:

| Area | Provisional target at practical completion |
| --- | --- |
| Non-model HTTP throughput | At least 2x at the same or lower p95 latency |
| Independent kernel commands | At least 70% parallel efficiency from 1 to 8 cores |
| Kernel p95 latency | No regression while handling 4x the baseline concurrent sessions |
| WebSocket fanout and resume | No messages lost; p95 processing latency at least 50% lower under the baseline stress fixture |
| Process RSS | At least 30% lower for the same idle and active-session fixture |
| Cold readiness | At least 2x faster without skipping recovery or migration checks |
| Reliability | No increase in indeterminate commands, quarantines, dead letters, or recovery failures |

Measure at least these workloads:

- health, session list, session detail, search, and transcript range requests;
- 1, 100, and 1,000 concurrent WebSocket clients with reconnect/resume;
- independent actor commands spread across sessions;
- a hot single session to prove serialization and Stop responsiveness;
- transcript append/read/search with small and oversized entries;
- scheduler and outbox bursts with slow and failing destinations;
- 100 or more detached runs streaming events concurrently;
- startup and recovery with realistic catalog, projection, and journal sizes.

Record throughput, p50/p95/p99, queue delay, CPU time, RSS, allocations where
available, SQLite busy time, open file descriptors, dropped connections, and
scheduler lag. Separate model/tool wall time from Open Session overhead.

## Migration strategy

### Phase 0: inventory, profiles, and acceptance fixtures

Deliverables:

- Add a repeatable backend benchmark harness and production-shaped synthetic
  state generator. Never copy production credentials or private transcripts
  into fixtures.
- Add request, actor-queue, SQLite, WebSocket, scheduler, outbox, and run-host
  spans with stable names shared by both implementations.
- Capture CPU and allocation profiles for idle, list/search, transcript append,
  WebSocket streaming, and concurrent actor workloads.
- Produce an endpoint and background-job inventory. For each item record its
  data owner, side effects, auth requirements, inputs, outputs, and tests.
- Classify current synchronous filesystem/process work on request and event-loop
  paths.
- Freeze a representative compatibility fixture set, including failure and
  recovery outcomes.

Exit gate: target metrics and fixtures are reviewed, reproducible in CI or a
controlled benchmark host, and identify where current time is actually spent.
Do not start bulk translation before this gate.

### Phase 1: schema-first protocols and Rust foundation

The current TypeScript types are the compatibility source. Introduce a
language-neutral schema representation for externally visible and service
protocols. JSON remains the first wire encoding.

Deliverables:

- Generate or validate TypeScript and Rust types from versioned JSON Schemas.
- Preserve unknown-field, optional-field, integer, timestamp, and error-shape
  behavior explicitly.
- Define canonical JSON or canonical field encoding anywhere a digest or
  request fingerprint depends on bytes.
- Add golden fixtures for HTTP, WebSocket, executor, run-host, SessionKernel,
  transcripts, and config records.
- Add a Rust workspace with formatting, Clippy, deny/audit policy, tests,
  reproducible release builds, and cross-platform artifact packaging.
- Implement shared config parsing, secret redaction, structured logging,
  shutdown, health, and readiness primitives.

Do not switch to Protobuf, CBOR, or another transport during this phase. A later
measured change can add an encoding behind protocol negotiation.

Exit gate: TypeScript and Rust decode and re-encode every golden fixture with
identical domain meaning, and both reject the same invalid security-sensitive
inputs.

### Phase 2: read-only worker and executor

Start with roles that prove packaging and service operation without taking
session write authority.

1. Rewrite `transcript-search-worker` in Rust. It is read-only and provides a
   real parsing, SQLite, and CPU performance comparison.
2. Rewrite the fixed-policy executor while preserving its Unix socket protocol,
   request idempotency, spec hash, host ID validation, systemd helper policy,
   capacity admission, and minimal environment.
3. Teach the multi-call artifact and installer to select the Rust role while
   retaining a release-level rollback switch.

Exit gate: differential tests match current output, fault tests match current
failure behavior, artifact installation works on supported platforms, and the
search benchmark demonstrates a meaningful measured win.

### Phase 3: SessionKernel service

This is the best high-value migration boundary because the gateway already uses
an authenticated, versioned service protocol. It is also the highest correctness
risk.

Deliverables:

- Port pure reducers and state machines before persistence code.
- Run existing transition fixtures against TypeScript and Rust.
- Implement the exact current schema and migration reader before proposing any
  Rust-only schema.
- Preserve writer claims, file mode, placement routing, per-session databases,
  catalog wake indexes, connection passivation, command idempotency, run
  generations, outbox/timer retries, quarantine, dead letters, and tombstones.
- Implement `/live`, `/ready`, authenticated `/rpc`, protocol negotiation,
  request/response limits, and incarnation fencing.
- Reproduce crash points around command admission, SQLite commit, effect
  dispatch, destination acceptance, actor settlement, and outbox
  acknowledgement.
- Keep the gateway's existing TypeScript actor client for the first production
  canary. The service boundary should make the implementation swap invisible.

Conformance must run on copied or generated state. Never open one live actor
database with both implementations, even read-only while a writer is active.
Shadow comparison replays recorded commands into isolated databases and
compares state, replies, changes, and effects.

Exit gate:

- all state-machine, schema, migration, crash, and ownership tests pass;
- a copied-state audit produces equivalent durable state;
- sustained multicore load meets the ratified kernel target;
- one session remains responsive to Stop while unrelated effects are slow;
- old and Rust services can each read the last mutually compatible schema;
- canary rollout and rollback are proven with the gateway stopped during the
  writer handoff.

### Phase 4: Rust gateway shell and read paths

Use a strangler gateway rather than replacing every route at once.

- Bind the Rust gateway to the public/private application listener.
- Serve the prebuilt frontend and static assets from Rust.
- Put the legacy Bun gateway on a private Unix socket or authenticated loopback
  address during migration. It must not be publicly reachable.
- Strip client-supplied internal identity headers. Authenticate and authorize in
  exactly one owner before proxying, and authenticate the private proxy hop.
- Port health, readiness, config reads, session list/detail, transcript ranges,
  search, media reads, and other side-effect-free routes first.
- Move read projections to Rust-owned bounded stores. Never replace projection
  reads with full-fleet actor database fanout.
- Compare responses from isolated fixtures and optionally shadow only
  side-effect-free requests.

Assign each route to exactly one implementation. Do not let a route perform
half of a mutation in Rust and half in Bun.

Exit gate: Rust owns the listener and all selected reads, protocol responses are
compatible with every shipped client, and proxy removal for migrated routes is
observable and reversible at the release level.

### Phase 5: WebSocket and session command plane

Port one complete WebSocket connection mode at a time. Do not split one stream
between runtimes.

Deliverables:

- handshake and capability negotiation;
- authentication and connection ownership;
- transcript init/index/range/live/resume;
- durable mutation request IDs, replay, command acknowledgement, and storage
  caps;
- queueing, steering, Stop, asks, session create, and deletion;
- bounded per-connection outbound buffers, slow-consumer policy, heartbeat, and
  reconnect behavior;
- post-commit publication from SessionKernel replies.

Use deterministic network tests that inject duplication, reordering,
disconnection, slow consumers, gateway restart, and kernel restart.

Exit gate: web, phone, iOS, and Chrome protocol suites pass against Rust; soak
runs show no missed or duplicate durable commands; and a release flag can move
the whole WebSocket endpoint back to the legacy gateway.

### Phase 6: schedulers, effects, recovery, and control-plane routes

Port authoritative coordination in vertical slices:

1. durable timers and scheduled prompts;
2. generic and opening-turn outbox executors;
3. transcript and session projections;
4. automation intake and recovery;
5. GitHub workflows and review coordination;
6. portals, sandboxes, Runners, and workload identity;
7. configuration mutations, setup, account, and admin routes;
8. Slack and other agent integrations.

Each slice must include intake, policy, persistence, effect execution, recovery,
shutdown fencing, observability, and operator repair paths. Merely porting the
happy-path route is incomplete.

Exit gate: Bun no longer owns a public route, durable scheduler, recovery loop,
or privileged control-plane decision.

### Phase 7: run orchestration and engine adapter boundary

Move lifecycle authority to Rust before replacing AI SDKs.

Define a private, versioned bidirectional engine protocol over a Unix socket or
stdio framing. Rust sends a fully resolved, non-secret-or-explicitly-scoped run
spec. The adapter streams typed events and accepts fenced cancellation and tool
responses.

Rust owns:

- journal admission and recovery;
- run ID and generation fencing;
- host launch, adoption, liveness, and cancellation;
- environment construction and credential projection;
- MCP allowlists and denied-tool enforcement;
- context logging and transcript destination writes;
- fallback policy and terminal outcome projection.

The compatibility Bun adapter owns only SDK-specific translation for Pi,
Anthropic, Codex, or provider libraries. It cannot mutate SessionKernel or actor
SQLite directly and does not inherit the gateway environment.

Then replace adapters individually where Rust ecosystem support is mature and
where profiling shows a reason. A provider adapter can remain isolated without
blocking practical completion.

Exit gate: Rust can restart, adopt, stop, and settle all supported local,
sandbox, and Runner executions; killing the compatibility adapter cannot lose
or duplicate an authoritative turn; and security tests prove that disallowed
credentials and tools never reach it.

### Phase 8: remove the legacy backend and simplify

- Remove the Bun gateway proxy and TypeScript backend entrypoints after at least
  one full compatibility window.
- Keep explicit migration readers until rollback policy permits removal.
- Consolidate service templates and release packaging around the Rust binary.
- Re-run profiles and remove compatibility serialization or copies only when
  benchmarks justify it.
- Decide whether pure-Rust engine adapters and CLI are worth completing.
- Archive the final protocol fixtures and migration audit procedure.

Exit gate: no production request, durable decision, or recovery path depends on
the legacy backend. Any remaining JavaScript process is a documented,
least-privilege provider adapter.

## Verification strategy

### Differential testing

Build one harness that can execute the same operation against the TypeScript and
Rust implementations with isolated state directories. Normalize only declared
nondeterminism such as timestamps, random IDs, and ordering that the protocol
already defines as unordered. Compare:

- status, headers, and JSON body;
- WebSocket frames and resume cursors;
- actor reply and emitted effects;
- durable rows and schema versions;
- audit events and redaction;
- restart and recovery results.

A difference needs an explicit compatibility decision, not a growing ignore
list.

### State-machine and property testing

Use table fixtures plus property tests for commands, queueing, steering, Stop,
creation, run generations, timers, effects, deletion, and transcript receipts.
Generate duplicate, stale, conflicting, and reordered events. Assert that:

- one session has one mutation order;
- stale generations cannot affect successors;
- exact request replay is idempotent;
- conflicting request reuse fails closed;
- no accepted durable intent disappears;
- deletion cannot be undone by a late event.

Use model checking or a concurrency test tool for the small primitives that
coordinate mailbox shutdown, actor passivation, and cancellation.

### Crash and fault testing

Automate process termination and injected failures before and after every
important durable boundary. Cover full disks, permission failures, SQLite busy
and corruption responses, truncated frames, service version mismatch, slow
consumers, DNS/network timeout, destination ambiguity, and process restart.

### Client compatibility

Run contract suites for the web/phone bundle, iOS, and Chrome extension against
both backends throughout phases 3 to 7. Keep at least one mixed-version test for
every supported rolling or rollback combination.

### Security verification

Port security rules before their routes and keep tests at the enforcement layer:

- minimal subprocess environments;
- MCP allowlists and per-user gates;
- unattended-run denied tools;
- GitHub actor and repository credential scope;
- customer, identity, incident, and money-moving mutation restrictions;
- private service authentication and protocol fencing;
- path traversal, symlink, request-size, decompression, and SSRF defenses;
- audit logging without secrets.

Run dependency audit, license policy, fuzzing on public parsers, and secret
scanning on release artifacts.

## Deployment and rollback

Migrate by service role and immutable release, not by random per-request
experiments.

1. Build TypeScript and Rust implementations from the same commit.
2. Keep existing wire versions until both ends support a negotiated successor.
3. For read-only roles, canary on isolated traffic and compare outputs.
4. For a writable role, stop its clients, verify the old writer is inactive,
   start exactly one new writer, run readiness and ownership checks, then start
   clients.
5. Record the highest schema opened by a release and reject an unsafe rollback.
6. Use offline copied-state audits for migrations. Never dual-write and never
   shadow a live actor database with another implementation.
7. Roll back the entire role, not individual requests, if ownership or durable
   semantics are uncertain.
8. Keep operator repair, dead-letter, quarantine, and migration audit commands
   available before the canary.

A release is healthy only after recovery gates complete. A fast listener that
has not reconciled journals, actor ownership, or durable effects is not ready.

## Main risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Semantic drift across a large rewrite | Schema-first contracts, golden fixtures, differential tests, and vertical slices |
| Rust is faster in microbenchmarks but not in real turns | Phase 0 profiles, production-shaped load, and separate Open Session overhead from provider time |
| New concurrency creates races | Preserve per-session actors, use bounded message passing, avoid shared mutable maps, and property/fault test |
| SQLite blocks async workers | Dedicated storage lanes, short busy bounds, per-session quarantine, and no SQLite on network tasks |
| Two writers corrupt authority | Role-level cutovers with clients stopped, writer claims, and no dual-write mode |
| JavaScript-only AI/provider SDKs delay completion | Least-privilege process adapter with Rust-owned policy and durability |
| Gateway proxy weakens authentication | Private authenticated hop, strip synthetic headers, one auth owner per route, remove proxy incrementally |
| Rust build increases platform/release complexity | Prove packaging with read-only and executor roles before kernel or gateway cutover |
| Rewrite stalls while TypeScript keeps changing | Protocol ownership, domain freeze windows per slice, small mergeable phases, and delete migrated code promptly |
| Team lacks Rust operating experience | Establish coding, review, profiling, unsafe-code, dependency, and incident practices in phase 1 |

## Recommended first implementation sequence

The first mergeable changes should be:

1. benchmark and fixture harness with current TypeScript baselines;
2. endpoint/background-job ownership inventory;
3. Cargo workspace, release build, logging, config, health, and CI foundation;
4. protocol schema and cross-language golden tests;
5. Rust transcript search worker with differential benchmark;
6. Rust executor with fault and packaging tests;
7. pure SessionKernel reducer port and property tests;
8. Rust SessionKernel storage against generated/copied fixtures;
9. authenticated kernel service canary behind the existing gateway;
10. Rust gateway shell and read-route migration.

Do not begin by translating `opensession.ts` route by route. That would preserve
its current coupling in another language and postpone the actor, protocol,
backpressure, and ownership decisions that make multithreading safe.

## Program-level definition of done

Practical completion requires all of the following:

- Ratified throughput, latency, scaling, memory, and startup targets are met on
  the same hardware and fixtures used for the baseline.
- Rust owns all public listeners, auth/policy decisions, durable state,
  orchestration, recovery, and privileged process control.
- Per-session serialization, cross-session parallelism, bounded queues, and
  backpressure are demonstrated under load.
- Every shipped client passes compatibility tests.
- Crash tests prove no accepted intent is silently lost or executed twice where
  the destination contract promises idempotency.
- Security enforcement and credential isolation are equivalent or stronger.
- Deployment, schema compatibility, canary, and rollback procedures are tested
  and documented.
- The TypeScript backend is removed. Any remaining Bun process is an explicit
  SDK adapter with no durable authority and a minimal environment.
- Production observability can attribute latency and saturation to network,
  actor queue, SQLite, CPU pool, external effect, provider, and client fanout.

Only after those gates should the project decide whether removing the final SDK
adapter is worth the maintenance cost of pure-Rust completion.
