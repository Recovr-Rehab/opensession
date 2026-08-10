# Sandboxes work — running progress log (append-only)

Handoff log for the orb-inspired sandbox overhaul. Newest entries at the
bottom. Plan: [sandboxes-plan.md](sandboxes-plan.md). Phase 1 design:
[sandboxes-phase1-brain-inside.md](sandboxes-phase1-brain-inside.md).

## 2026-08-10 — research + plan approved

- Researched Amp's orbs (ampcode.com: manual/orbs, agents-in-orbs, portals,
  event-driven-orbs, size-the-orbs-of-production, putting-an-agent-in-an-orb,
  what-i-want-to-tell-you-about-orbs, schedule, multiplayer, from-agent-to-agent)
  and audited our sandbox stack (~5,200 lines, 8 providers, 3 certified).
- Michiel approved the plan (docs/sandboxes-plan.md, commit 8a5bb00b):
  microvm becomes the flagship, orb-level polish, default opt-in until it
  earns opt-out; goal is to prove sandboxes should replace the worktree
  default. Decisions: **brain-inside** (engine runs in the VM, scoped creds
  injected at boot; Michiel picked this explicitly), **no backwards
  compatibility** (no users of previews/sandboxes yet), **hooks move to
  `.agents/`** (`setup`, `resume`, `start.sh`, `preview.json`).

## 2026-08-10 — Phase 0 shipped

- 432f6c81 — hook rename `.opensession/` → `.agents/`, no aliases; also
  retired the pre-rename `.backstage/` fallback dir in every reader. Canonical
  contract doc: docs/repo-lifecycle.md. `.agents/resume` documented but has
  no reader yet (Phase 1 wires it).
- 0e6ec1d3 — hygiene sweep from the audit: Dockerfile path-parity fix
  (stale tella-backstage paths), duplicate OPENSESSION_BOOT_MODE deleted,
  e2b got assertDialbackReachable, busybox sha256-pinned, stale module docs
  fixed, old-plan § references repointed at docs/sandboxes-plan.md.
- Server restarted and verified healthy (active, 200, clean boot log).
- Consequence: repos still carrying `.opensession/` hooks (e.g. tella-fusion
  if it has them) lose Preview bootability until migrated to `.agents/`.

## 2026-08-10 — Phase 1 design done, Slice A in flight

- Design committed: docs/sandboxes-phase1-brain-inside.md (bf04d70d).
  Key points: lambda-microvm is already brain-inside Firecracker with the
  same control daemon — conversion largely copies it; bake runner payload
  into the golden (keeps ~1s restores; bootstrap stays as marker-check/self-
  heal); per-launch scoped-cred upload keeps the golden credential-free;
  WS dial-back for runs (gains restart-reattach) with a new
  `callbackBaseUrl` param so local VMs don't hairpin through public ingress;
  in-VM clone workspace (no bind — enables per-repo snapshots later);
  deletion of placement matrix + workspace-MCP (workspace-exec.ts SURVIVES —
  it serves diff/status/@-mentions for cloned workspaces).
- Slices: A baked golden (deploy-only, inert) → B adapter conversion +
  conformance entry → C matrix/workspace-MCP deletion + flat
  `sandboxableModelFamily` → D prewarm/docs → E (optional) GH_TOKEN +
  clone-token scrubbing.
- **Slice A is being implemented by a background worker right now**
  (Dockerfile.runner + refresh-sandbox-golden.sh golden.json + README;
  commits + pushes itself; does NOT restart the server). Check
  `git log --oneline` for its commit landing after bf04d70d.
- Slices B–D: Michiel has the design summary; he was asked to glance at
  §5 (deletion table) and §6 (workspace choice) before B–D roll. His last
  question (answered in chat): why Claude is blocked on microvm today —
  answer: the `claude` family row in SANDBOX_MODEL_FAMILIES
  (config.ts:669-673) is the **native Claude Code engine**, which runs
  engine-in-sandbox on every provider (docker mounts / remote bootstrap) but
  microvm can't host engines at all today (workspace-runtime only,
  microvm.ts:268-272 throws), and the hands-inside host-engine path only
  exists for opencode families — the native engine's tool loop can't be
  proxied. Anthropic models via opencode/Meridian bridge ARE allowed on
  microvm today (host-engine). The conversion makes the whole distinction
  moot: everything runs inside the VM, matrix deleted.

## 2026-08-10 — scope extension: ALL engines go inside

- Michiel: "we really need to host the pi and opencode engine in the
  sandboxes!" — so the phase-1 design's "survives" residue shrinks further:
  the flat family check should end up excluding ONLY native Codex
  (CODEX_HOME rotation). Pi needs a real design (in-process engine: bridge
  auth, session state, in-memory MCP servers live in the server process);
  opencode-other likely just needs a scoped per-launch provider-auth upload
  next to the existing Claude-slice/OpenAI-seed uploads in bootstrap.ts.
- A design agent is investigating pi + opencode-other in-sandbox; its
  addendum will amend Slice C of sandboxes-phase1-brain-inside.md. Slice C
  should not be implemented until that addendum lands.
- Refinement from Michiel (hard constraint, relayed to the design agent):
  **sandboxes adapt to the engines, never the reverse.** Opencode and pi
  stay architecturally exactly as they are — no pi service extraction, no
  dispatch-layer redesign, no engine auth-flow changes. Target shape: the
  in-guest runner-host embeds pi in-process the same way the server does on
  the host; opencode runs in-guest as the same subprocess + in-guest bridge
  it already is on remote providers. All non-sandboxed paths keep working
  unchanged.

## Next steps (for whoever picks this up)

1. Confirm Slice A's commit landed + its verification result (worker report).
2. Get Michiel's go on slices B–D, then implement in order (design §8 has
   file-level scope + verification per slice). Backend changes need one
   deliberate `systemctl restart opensession` after commit+push.
3. After D: wake-on-demand slice, then snapshot-after-setup per repo
   (design §7 lists the invariants already baked in), then Phase 2
   instrumentation/scorecard per docs/sandboxes-plan.md.
4. Remember the shared-checkout git rules (CLAUDE.md): specific-file adds,
   check the staged index, pathspec commits, push promptly.

## 2026-08-10 — Slice A verified, Slice B implemented

- Slice A landed as 3593fdb0. Its commit records a full golden rebuild and
  scratch-clone verification: bootstrap marker, OpenCode, Claude, and the
  runner checkout's `.git` all passed before the scratch VM was destroyed.
- Slice B converts local `microvm` to brain-inside: every ensure probes the
  private dial-back path, reconciles the baked runner through
  `bootstrapRemoteSandbox`, and launches the in-guest runner host over the
  existing run-ws/rpc-ws transport. `callbackBaseUrl` is now an optional
  per-handle override, so local Firecracker uses `sandboxCallbackBaseUrl()`
  while external providers keep the public-ingress default.
- Native Claude and OpenCode OpenAI/Anthropic now select the in-VM engine on
  microvm. Old sticky `sandbox.engine: host` state is deliberately ignored for
  microvm so pre-conversion sessions migrate. Pi and OpenCode-other still use
  the transitional host-engine/workspace path until their promised Slice C
  design addendum lands; no engine architecture was changed.
- Added `microvm` to `deploy/sandbox/conformance.ts`, including an explicit
  private callback base requirement. Final real Firecracker run: **28/28** —
  clone in 5.1s, reuse, exec semantics, volume workspace, private dial-back,
  real model response, WS drop/redial/replay, steer, cancel, get() reattach,
  destroy, and state cleanup. The run also found/fixed a stale conformance
  journal kind that the deny-by-default runner gate correctly rejected.
- Focused tests: 28 pass (`microvm.test.ts` + `capability-status.test.ts`);
  `bun run typecheck` passes. This host's private untracked sandbox config now
  points `callbackBaseUrl` at its tailnet-only Caddy endpoint for live runs.
- The tella-fusion lifecycle migration was already completed by the Slice A
  worker: private-repo PR #5604, commit d1c4c79a9f, moves `.opensession/` to
  `.agents/` and renames `setup.sh` to executable `setup` with internal path
  references updated.

## Next steps (updated)

1. Commit/push Slice B, restart Open Session once, and smoke health plus a
   live microvm session through the main server.
2. Recover or recreate the missing Pi + OpenCode-other design addendum before
   Slice C. Slice C must preserve the hard constraint that sandboxes adapt to
   each engine; engines and non-sandboxed paths do not change architecture.
3. Then implement Slice C (matrix/workspace-MCP deletion), Slice D (prewarm +
   docs), optional Slice E, wake-on-demand, and snapshot-after-setup.

## 2026-08-10 — Slice B shipped and live-smoked

- 2ad94e9c committed and pushed Slice B; Open Session was deliberately
  restarted and is healthy. Detached engine turns were re-adopted across the
  restart as designed.
- Main-server smoke used the normal authenticated `create_session` WebSocket
  path (not the standalone harness): an ask session on the `opensession` repo,
  `opencode/openai/gpt-5.6-sol`, `sandbox: "microvm"` materialized
  `microvm-64` and returned exactly `LIVE_MICROVM_OK` from the in-guest engine.
  The API then deleted the scratch session; the clone unit became inactive and
  the provider state file disappeared.
- The first live attempt proved the guest cannot resolve this host's
  MagicDNS-only `*.ts.net` name because the golden intentionally uses public
  resolvers. The private untracked config now uses `wss://os.tella.dev`: public
  DNS resolves it to the host's Tailscale IP, while Caddy binds that vhost only
  on the tailnet. The Phase 1 design's networking note was corrected.
- Slice B is complete. Slice C remains intentionally blocked on the missing Pi
  + OpenCode-other design addendum; do not delete the host-engine bridge until
  that design exists.

## 2026-08-10 — all-engines addendum recovered; Slice C unblocked

- The missing Pi/OpenCode-other investigation is now folded into
  `sandboxes-phase1-brain-inside.md` under the Slice C deletion plan. The key
  finding: `runner-host` already calls the same `runAgent` inside the guest,
  which embeds Pi in-process, launches normal OpenCode, and turns every trusted
  opensession-* MCP into an rpc-ws stdio proxy. No Pi service extraction,
  dispatch redesign, or engine auth-flow change is needed.
- Pi needs only an allowlisted per-launch `~/.opensession-pi.json`. Its
  Anthropic and OpenAI credentials are already covered by the scoped Claude
  account and rotation-proof OpenAI seed uploads; its native session jsonl
  persists on the VM COW disk, and its runner-host survives/reconnects across
  Open Session restarts.
- OpenCode-other already receives Settings provider keys because the launcher
  copies `.opensession-opencode.json`; that also exposed a misleading
  "no secrets" comment and over-broad copying. Slice C must project that config
  at the adapter boundary, optionally project only the selected entry from
  OpenCode's native `auth.json`, chmod/rewrite-or-remove both per launch, and
  never upload Anthropic/OpenAI native auth.
- Resulting flat sandboxability rule: every Claude, Pi, and OpenCode model can
  run brain-inside on every certified provider. Only native Codex remains
  host-only because its writable refresh-token family cannot safely cross the
  boundary; GPT sandboxes use `opencode/openai/*` or `pi/openai/*`.
- The tella-fusion follow-up is not lost: private PR #5604 is open from
  `michael/agents-lifecycle-hooks` at d1c4c79a9f. It moves the hooks into
  `.agents/` and makes the canonical setup hook `.agents/setup` (no `.sh`),
  matching Open Session's new contract.

## Next steps (current)

1. Implement Slice C's scoped launch projections first, with stale-authority
   removal tests and real Pi + OpenCode-other microvm smokes.
2. Delete the placement matrix and workspace-MCP host-engine path only after
   those smokes pass; leave `workspace-exec.ts` intact for UI git/file reads.
3. Continue with Slice D prewarm/docs, optional Slice E, wake-on-demand, and
   snapshot-after-setup.

## 2026-08-10 — Slice C shipped: every supported engine is brain-inside

- `fefed4c5` narrowed guest credential projection to the selected account and
  provider authority; stale authority is removed on every launch.
- `2f765226` deleted the remaining host-engine/workspace-MCP placement path.
  OpenCode, Pi and native Claude now run through the same in-guest runner. The
  only deliberate exclusion is native Codex; GPT-in-sandbox uses OpenCode or
  Pi because writable rotating `CODEX_HOME` is not copied into guests.
- `99c7cb20` disabled keep-alive reuse on Firecracker control requests, fixing
  the frozen TCP connection that could drop the first command after restore.
- Real main-server MicroVM smokes proved the scoped files arrived in the guest.
  OpenCode-other/Cerebras and Pi then hit provider-account exhaustion and
  correctly fell back to OpenAI; this was external capacity, not a sandbox
  auth or transport failure, so those requested-provider smokes are recorded
  as inconclusive rather than passed.

## 2026-08-10 — Portals and agent-to-agent artifacts shipped

- `eb59972a` added binary-safe `send_file_to_session`. An agent can copy one
  relative file from its host or sandbox-only workspace (or its Assets) into a
  peer's Assets inbox, then notify/steer the peer. Traversal, absolute paths,
  self-transfer and files over 4 MiB fail closed.
- `cfcbedc0` made `.ports.conf` a multi-service Portal manifest: every running
  `*_PORT` service receives a link in the Dev services menu. Each Caddy route
  forward-authenticates against Open Session before reaching the service.
  Firecracker exposes only a Caddy-reachable private upstream; its veth address
  never reaches the browser.
- `f0295662` extended the same authenticated wrapper to HTTPS endpoints issued
  by external sandbox providers. A direct provider URL is now an upstream, not
  an authentication bypass. The contract and security boundaries are recorded
  in `docs/portals-and-agent-communication.md`.

## 2026-08-10 — durable lifecycle, shell and post-setup repo templates shipped

- `5c631150` added MicroVM pause/resume, a five-minute idle pause, transparent
  wake for prompts/workspace reads/Portal requests, `.agents/setup` and
  `.agents/resume` execution with retained logs, plus the real in-guest PTY
  used by the Shell tab. A scratch VM preserved `survives` across pause/wake;
  measured cold wake was about five seconds. The refreshed golden's runner SHA
  matched the commit and a live PTY returned `PTY_LIVE_OK`.
- `2b54aa1d` added the session-header sandbox panel and API: live status,
  provider/id/cwd, setup/resume logs, busy locking, pause, wake and confirmed
  destructive recreate.
- `f0295662` completed snapshot-after-setup for local MicroVMs. Prewarm now
  runs `.agents/setup`, uses a stable per-repo stamp, scrubs clone authority,
  parks compute, and publishes a reflinked COW repo disk keyed by the runner
  signature. Later sessions cold-boot private copies for 24 hours, re-inject
  current clone authority on only that copy, fetch, branch and skip setup.
- The behavioral conformance matrix now exercises durable pause/wake and byte
  survival when a provider exposes lifecycle controls. A capacity failure to
  initialize the second model run is reported as one failure instead of four
  misleading reconnect/steer/cancel failures.

## 2026-08-10 — Phase 2 evidence plumbing complete

- `f0295662` emits structured audit metrics for worktree vs sandbox
  start-to-first-event, start-to-first-token, total outcome, sandbox-ready
  latency, Preview-ready latency and MicroVM wake latency. This supplies the
  scorecard required by the approved plan without turning a few hand-picked
  smokes into a default-flip claim.
- Full suite before the final warm-template slice: **1,859 pass, 4 skip, 0
  fail**; typecheck passed. Focused Portal/lifecycle/prewarm/file-transfer tests
  after the slice: **33 pass, 0 fail**; conformance bundles successfully.
- The full live MicroVM matrix previously passed **28/28**, including model
  response, WS redial/replay, steering and cancellation. After the golden
  refresh, the first real model run passed; the second could not initialize
  while provider accounts were exhausted, so its four dependent assertions
  timed out. The harness now avoids that cascade while continuing to fail the
  missing initialization itself.

## Remaining gates (not silently waived)

1. Collect normal-use Phase 2 metrics and make the documented human decision
   on changing the new-session default. The code does not pre-empt that gate.
2. Run the live behavioral matrix for E2B, Box and Lambda MicroVM when those
   provider accounts/images are available. Docker, Daytona, Modal and MicroVM
   have live evidence; untested adapters are not called equivalent.
3. Add a proper Firecracker jailer before claiming hostile multi-tenant
   isolation. Today's MicroVM is a durable execution boundary for trusted team
   code, not an adversarial tenant boundary.
4. Only after the default flip is approved: build the separate credential-free
   automation profile plus egress allowlist. Automation-owned sessions remain
   refused by the credential-bearing interactive sandbox path today.

## 2026-08-10 — final live acceptance

- The restarted production process reports healthy and re-adopted detached
  engine turns across the restart.

## 2026-08-10 — Firecracker jail and unattended profile accepted

- `5b6b29e6` moved every clone into a private chroot and runs Firecracker as
  uid 1000 / group kvm with zero effective capabilities, NoNewPrivileges,
  seccomp and a closed device cgroup. A live clone booted from both a repo
  template and a clean memory snapshot; `/proc/<pid>/root` was the jail and did
  not expose the host's `/etc/shadow`. Pause/wake preserved a disk marker.
- `31db6832` shipped MicroVM-only sandbox automations: one hard-pinned account,
  explicit MCP scope, no fallback, guest-only workspaces, selected config/
  credential projection, and host-resolved fail-closed egress rules.
- A disposable live automation completed with transcript
  `SANDBOX_AUTOMATION_OK`. Audit evidence recorded exactly one uploaded model
  account, the resolved egress set and successful outcome; the persisted
  session named its MicroVM, and deleting the temporary automation/session
  destroyed the clone.

## 2026-08-10 — measurement and provider gates made executable

- `a5213294` added `GET /api/sandbox/scorecard?days=30`. The gate requires real
  volume over multiple days and compares first-token latency and turn failure
  rate, plus preview, wake and restart-survival evidence. Restart recovery now
  emits its own terminal metric.
- The first live result is intentionally red: 5/20 worktree turns, 0/20 normal-
  use sandbox turns, zero preview/wake/restart sample sets. The default decision
  is therefore **remain opt-in**. Acceptance and conformance smokes were not
  relabelled as dogfooding.
- `0a831bd8` made the live matrix an enforcement boundary. Docker, Daytona,
  Modal and MicroVM are selectable; E2B, Box and Lambda MicroVM stay in the
  harness but are hidden and rejected for new sessions/prewarm until certified.

## 2026-08-10 — Portals and A2A raised to the same bar

- `d10dd599` fixed host-worktree multi-service Portals: every normal listening
  `.ports.conf` service now gets the authenticated Caddy URL already available
  to sandbox services, and all URLs are reflected into `.tunnels.env`.
- Portal forward auth now fails closed for Caddy routes the current Open Session
  process has not rediscovered after restart. Stop removes every service route,
  closing the stale-upstream/reused-port window.
- Cross-session messages now retain agent/session provenance instead of
  impersonating the inherited human identity. Every send gets a stable delivery
  receipt carried through persisted queues/steer receipts and emits a content-
  free source/target/outcome audit event. Binary file transfers share the same
  receipt convention.
- The tella-fusion lifecycle-hook migration is already complete: PR #5604,
  “Move agent lifecycle hooks from .opensession/ to .agents/,” merged at
  2026-08-10 19:50 UTC.
- A live `opensession` prewarm ran setup, parked `microvm-64` with compute
  inactive, and published a 25 GiB sparse/reflink repo template. A separate
  scratch VM cold-booted that template, proved the warm Git checkout and stable
  setup stamp existed, and reported only the scrubbed public origin
  `https://github.com/tellahq/opensession.git`; it was then destroyed.
- A real Bun service listening on the managed MicroVM private veth was placed
  behind the generated Caddy Portal contract. The same URL returned **401**
  without an Open Session cookie and **200 `PORTAL_OK`** with a valid team
  cookie. The VM returned to its parked/inactive state after the check.
- Final repository verification at HEAD: **1,872 pass, 4 skip, 0 fail** across
  188 test files; `bun run typecheck` passes; `/api/health` reports `ok: true`.
