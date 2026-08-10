# Phase 1, slice 1 — brain-inside conversion for the microvm provider

Design for the first Phase 1 workstream of [sandboxes-plan.md](sandboxes-plan.md).
Status: designed 2026-08-10, implementation in slices A–E below.

## Summary

Convert `MicrovmProvider` from "engine on host + workspace tools over the
in-guest HTTP daemon" to the same shape as `lambda-microvm` — a Firecracker VM
that runs the full runner payload (`src/runner-host/host.ts` via `HOST_ENTRY`)
inside the guest, dialing back to the server over the existing run-ws/rpc-ws
WebSocket routes, with the per-launch scoped-credential upload that
`makeRemoteLauncher` already performs. The critical observation:
**`lambda-microvm` is already a brain-inside Firecracker provider using the
identical `control.py` daemon as its `RemoteDriver`**
(`src/server/sandbox/adapters/lambda-microvm.ts:347-351` calls
`assertDialbackReachable` + `bootstrapRemoteSandbox`). The microvm conversion
is largely "make the local Firecracker adapter do what the Lambda Firecracker
adapter does", plus a payload-baked golden so cold start stays snapshot-fast,
plus the deletion of the workspace-MCP/placement-matrix machinery.

## Where current code contradicts the plan's assumptions

1. **"Use the same bootstrap the remote adapters use" conflicts with the
   Phase 2 bar "start feels ≤ worktree".** `bootstrapRemoteSandbox` is
   documented as *minutes* cold (`bootstrap.ts:15-19`; `bun install` pulls the
   ~223MB vendored codex binary). A per-clone bootstrap would destroy the
   microvm's ~1s snapshot-restore advantage (`clone.sh:99-105`). Resolution:
   bake the payload into the golden and let the bootstrap's marker check
   (`bootstrap.ts:508-509`) short-circuit to a no-op — "same bootstrap" as the
   code path, not as the runtime cost.
2. **Claude models are currently hard-blocked on microvm** (`config.ts:672` —
   `environments: { ...ALL_ENVIRONMENTS, microvm: false }`), and
   `microvm.ts:268-272` throws on `runtime !== "workspace"`. Today the
   flagship provider cannot run the flagship model family at all. The
   conversion inverts this; both lines die.
3. **`workspace-exec.ts` must survive.** `workspace-mcp.ts` (the model-facing
   hands tools) dies, but `workspace-exec.ts` is the *host-UI* read/write seam
   (git status/diff/@-mention/file-index routing for volume workspaces —
   `file-index.ts:10`, `git-status.ts:10`, `code-flow.ts:197`,
   `run-session.ts:1003`). Brain-inside makes it **more** load-bearing:
   `microvm` is already in `isRemoteSandboxProvider` (`config.ts:553-561`), so
   those surfaces route through `sandbox.exec` → the control daemon.
4. **The runner Docker image is not a git checkout** (`deploy/sandbox/Dockerfile`
   COPYs the repo root; root `.dockerignore` excludes `.git`).
   `bootstrapRemoteSandbox`'s runnerSha reconcile skips non-git checkouts
   (`bootstrap.ts:550-556`) *and then still writes the new signature marker*
   (`bootstrap.ts:637`) — a runnerSha bump against a baked-but-gitless payload
   would silently freeze old code behind a fresh marker. The golden build must
   bake a real git clone (chosen) or gate at the store level.
5. **The bootstrap's credential-trust rationale is written for third-party
   compute** (`bootstrap.ts:44-50`). Local Firecracker is our own hardware —
   the scoped upload is strictly more acceptable there. Update the module
   comment so the trust story stays honest.
6. `docs/self-hosting-sandboxes.md:336-373` ("Local Firecracker MicroVM (host
   engine, guest workspace)") and the `microvm.ts:1-9` module header describe
   the architecture being deleted; `deploy/sandbox/verify-external-engine.ts`
   certifies exactly the boundary being removed.

## 1. Runner payload into the VM: bake into the golden

**Decision: bake, with the bootstrap kept as the reconciliation path.**

Per-clone bootstrap (remote-adapter style) would cost minutes of installs per
session, multi-GB COW write amplification, and network dependence at session
start — killing the flagship's core advantage. Rejected. The baked golden
keeps clone restore ~1s; first-turn cost is workspace clone + engine start
only. Payload changes require a golden refresh — acceptable because refresh is
one operator/CI command (`refresh-sandbox-golden.sh`) and the in-VM bootstrap
remains as a self-heal path for pin bumps between refreshes.

Mechanics:

- New `deploy/sandbox/microvm/Dockerfile.runner` (or extend
  `refresh-sandbox-golden.sh`) reproducing the **bootstrap layout, not the
  docker-image layout**: bun at `~/.bun/bin/bun`, claude at
  `~/.local/bin/claude`, opencode at `~/.bun/bin/opencode`
  (`bootstrap.ts:110-116`; the docker image installs opencode via npm global,
  which would leave `OPENSESSION_OPENCODE_BIN=~/.bun/bin/opencode`
  (`bootstrap.ts:928`) dangling). Simplest robust recipe: run the literal
  steps of `bootstrapRemoteSandbox` in a RUN layer — payload as a **shallow
  git clone** of the runner repo at the pinned sha (so `.git` exists and the
  in-VM reconcile at `bootstrap.ts:549-584` works), `bun install`, claude
  installer, `bun add -g opencode-ai@<pin>`, then write `~/.bks-bootstrapped`
  with the exact `bootstrapSignature()` string (`bootstrap.ts:415-419`).
- `refresh-sandbox-golden.sh` additionally writes `<store>/golden.json`
  `{ signature, builtAt, opencode, runnerSha }`.
- **Invalidation contract**: at `ensure()`, the adapter runs
  `bootstrapRemoteSandbox` as today's remote adapters do. Marker matches →
  no-op (fast path). Pin bumped since the golden was built → marker mismatch →
  the existing reconcile fetches/checks out the pin inside the clone and
  re-runs `bun install` (incremental, one-time per clone). The prewarm pool
  already refuses stale prewarms via `prewarmSignature`
  (`prewarm.ts:177-188, 390-395`). Optionally
  `sandboxProviderConfigured("microvm")` (`config.ts:794-802`) compares
  `golden.json.signature` against `bootstrapSignature()` and surfaces a
  "golden is stale — refresh recommended" note in `/api/sandbox/status`
  without blocking.

## 2. Credential injection at VM boot

**Transport: the existing control daemon (`/files` + `/exec`), driven by the
unchanged per-launch upload in `makeRemoteLauncher`.** No new mechanism.
`bootstrap.ts:828-915` already writes, per **launch** (not per boot):

- `~/.opensession-claude-accounts.json` — scoped Claude slice from
  `accountsForRemoteUpload(spec.user, spec.accountId)`, chmod 600, rewritten
  every launch.
- `~/.opensession-opencode.json` — bridge config, no secrets.
- `~/.opensession-codex-accounts.json` + `~/.opensession-openai-seeds/**` —
  rotation-proof OpenAI seed artifacts; removed when nothing is eligible.
- **Git clone token** rides the tokenized https origin
  (`remoteCloneUrl`/`injectToken`, `bootstrap.ts:308-364`) — the only
  credential at rest between turns.
- **gh token: not injected in this slice** (parity with remote adapters;
  docker's ro `~/.config/gh` mount is a docker-only affordance). Follow-up:
  export `GH_TOKEN` per launch from the same bot credential (slice E).

Why not a mounted drive or vsock: a second block device must attach pre-boot,
which fights snapshot restore (the vmstate pins the device set — see the
bind-over-golden-path trick at `clone.sh:94-95`); vsock needs guest agent
changes. The daemon path keeps injection *post-clone, per-launch* — which is
exactly what keeps the golden credential-free: `refresh-sandbox-golden.sh`
boots the golden without ever running a launch.

Lifetime/cleanup: credentials live only on the per-session COW disk
(`clone.sh:53`), rewritten or deleted every launch, destroyed with
`clone.sh destroy` (`microvm.ts:210-220`). Rule for future snapshot slices:
**any shared (per-repo) snapshot must be taken from a clone that has never
executed a launch** — setup uses only the clone token, and even that gets
scrubbed (§7).

## 3. Transport: WS dial-back for the run; HTTP daemon stays control plane

Both, with a strict split — lambda-microvm's proven shape:

- **Control plane** (bootstrap exec, file uploads, workspace clone, background
  spawn, health): the in-guest HTTP daemon on 8080/8081, DNAT'd through the
  netns (`clone.sh:69-71`), wrapped as a `RemoteDriver` (`microvm.ts:126-180`)
  with the restore-transient retry (`microvm.ts:191-208`). There is no other
  exec channel into a Firecracker guest.
- **Run transport**: WS dial-back — `driver.execBackground` launches
  `HOST_ENTRY` with `OPENSESSION_RUN_WS_URL/…_TOKEN/OPENSESSION_RPC_WS_URL`
  (`bootstrap.ts:936-958`); the guest's run host dials out;
  `HostHandle.connectWithWait` attaches (`bootstrap.ts:1199-1204`). Rationale:
  (a) the path daytona/modal/lambda-microvm/docker-ws all share — zero new
  protocol; (b) carries the seq/ack ring-buffer replay (`ws-buffer.ts`) that
  makes restart-resume and later pause/resume loss-free, which a
  request/response daemon fundamentally is not; (c) `resumeRemoteSandboxRun`
  (`bootstrap.ts:1274-1386`) works unchanged, and since clones survive
  opensession restarts in their systemd scopes (`clone.sh:94`), microvm gains
  true reattach-to-live-run — better than today's in-process host-engine runs.
- opensession-* MCP tools reach the host via the mcp-proxy's `/rpc-ws`
  dial-back (`host.ts:373-380`) — no rpc-socket bind mount needed.

Seam change: `makeRemoteLauncher` hardcodes `remoteSandboxCallbackBaseUrl()`
(`bootstrap.ts:919`), which prefers the **public ingress** URL. A local VM
should not hairpin through the internet-facing ingress. Add
`callbackBaseUrl?: string` to `RemoteSandboxParts` (`bootstrap.ts:1152-1163`),
thread into `makeRemoteLauncher`; microvm passes `sandboxCallbackBaseUrl()`
(`config.ts:950-956`) — the internal/tailnet base docker-ws uses. Default
unchanged for the remote adapters.

## 4. Networking

Egress is already unrestricted masquerade minus IMDS (`clone.sh:67-83`).
Brain-inside changes what *uses* the egress, not the rules:

- New guest-originated flows: Anthropic endpoints (the bridge runs *inside*
  the guest as part of the runner payload, serving from the uploaded scoped
  accounts — it is not the host's bridge), OpenAI endpoints for seeds,
  git hosts, bun registry only during a pin-bump reconcile.
- **Dial-back reachability is the one real risk.** The guest's resolv.conf is
  pinned to public DNS (`bks-sandbox-init:23`), so a DNS-named
  `callbackBaseUrl` must be publicly resolvable (ts.net MagicDNS names are).
  Mitigate like the remote adapters: `assertDialbackReachable(driver,
  "microvm")` before bootstrap in `ensure()`. Document that the callback host
  must accept connections from `10.200.0.0/16` (strict rp_filter setups are
  the caveat).
- **IMDS stays blocked** — more important now that the guest holds credentials
  and runs model-chosen commands. Keep `clone.sh:79-80` first-position.
  Nothing needs new inbound DNAT (8080/8081 remain; 3300 stays for the future
  preview slice).
- Trust framing to write down: previously the guest held no credentials so
  full egress was harmless; now full egress + scoped creds means the microvm
  is exactly as trusted as a daytona sandbox — interactive-only (automations
  already refused, `run-session.ts:1073-1076`). The egress allowlist is
  deliberately Phase 4.

## 5. Deletion plan

Dies with this conversion:

| Item | Location |
|---|---|
| `createRemoteWorkspaceMcpServer`, `remoteWorkspaceInstructions` + tests | `src/server/sandbox/workspace-mcp.ts`, `workspace-mcp.test.ts` |
| Host-engine branch of the sandbox launch path (`engineOutsideSandbox`, engine cwd hack, in-process `runAgent` with `disableLocalWorkspaceTools`) | `run-session.ts:1080-1221` |
| Workspace server injection for reattached host-engine runs | `interactive-mcp.ts:314-336` |
| Placement matrix: `environments` maps, `SandboxEnvironmentId`, `ENVIRONMENT_LABELS`, `sandboxEnginePlacement`, per-environment `sandboxModelSupport`, `SandboxCapabilityStatus.modelFamilies` | `config.ts:586-770` |
| `runtime?: "runner" \| "workspace"` on `SandboxSessionSpec` | `provider.ts:64-70` |
| `bootstrapRemoteWorkspaceRuntime`, `WORKSPACE_BOOTSTRAP_*` (folded into `bootstrapRemoteSandbox`) + tests | `bootstrap.ts:427-495` |
| `spec.runtime === "workspace"` branches in every adapter | `daytona.ts:311-316`, `modal.ts`, `e2b.ts`, `box.ts`, `lambda-microvm.ts:347-351` |
| `sandbox.engine: "host" \| "sandbox"` session field (always "sandbox" now) | `types.ts:260,505`, `run-session.ts:1110-1131`, `frontend/lib/api/automations.ts` |
| Brain-outside verify suite | `deploy/sandbox/verify-external-engine.ts` |
| Docs section "Local Firecracker MicroVM (host engine, guest workspace)" | `docs/self-hosting-sandboxes.md:336-373` |

**Survives, deliberately:**

- `workspace-exec.ts` in full (contradiction #3).
- A **family-level** residue of the matrix: codex-native (rotating
  `CODEX_HOME` refresh token) and pi (in-process engine) genuinely cannot run
  in *any* sandbox. Replace the environment matrix with a flat
  `sandboxableModelFamily(model): { ok } | { ok: false, error }`
  (provider-independent), enforced at the same create-path call sites and
  served in a simplified `/api/sandbox/status` shape for `NewSession.tsx`.
- `microvmPrewarmAdapter` (`microvm.ts:431-488`) — `prepare` swaps
  `bootstrapRemoteWorkspaceRuntime` for `bootstrapRemoteSandbox` (a marker
  no-op on a baked golden); `prewarmSignature` already covers the payload pin.

## 6. Workspace: in-VM clone (volume-style), not worktree bind

Firecracker exposes block devices, not shared directories (no virtiofs), so a
"bind" would mean carving each host worktree into a per-session ext4 attached
pre-restore — incompatible with memory-snapshot restore (the vmstate pins the
device set) and fatal to the snapshot goals:

- **Snapshot-after-setup**: with the clone on the root COW disk, "run
  `.agents/setup`, pause, Full snapshot" captures workspace + deps + daemon
  state in one artifact per repo. A host-bound workspace would be excluded
  from snapshots by construction.
- **Wake-on-demand / survive host reboot**: the plan's recovery story is
  "re-clone + `.agents/resume`" — a clone-based workspace with a pushed
  branch is exactly re-cloneable.
- The machinery already runs: `setupRemoteWorkspace` blobless clone +
  warm-adopt (`bootstrap.ts:698-767`), microvm prewarm pre-clones
  (`microvm.ts:459-465`), host-side reads route via `workspace-exec`
  (`workspace-exec.ts:109-117`). Docker's bind mode stays docker's; the
  flagship is volume.

Cost accepted: no host copy (push-your-work contract,
`run-session.ts:1252-1260`), and clone time on cold sessions — mitigated by
prewarm now and per-repo snapshots next.

## 7. Not painting the next slices into a corner

**Wake-on-demand (pause/resume):**
- Everything wake needs is on disk or host-side: spec.json mirrored host-side
  (`bootstrap.ts:805-811`), meta/journal in-VM on the COW disk, WS ring
  buffer + redial. A paused-then-resumed VM's run host simply redials — same
  as an opensession restart today. `RemoteDriver.ensureStarted`
  (`microvm.ts:173-179`) is the seam where "throw if not running" becomes
  "resume the paused VM"; `resumeRemoteSandboxRun` already calls it first.
- **Mid-turn pause**: pause only when no run is active (`hostRunBusy` gate,
  as in docker's sweep). A frozen mid-turn engine wakes with dead TLS streams
  and a skewed clock; the continuation machinery
  (`RESUME_CONTINUATION_PROMPT`, `bootstrap.ts:1348-1385`) is the recovery if
  a forced pause interrupts a turn, not the design center. Two invariants to
  preserve: clock repair after any resume (`clone.sh:107-113` — repeat on
  wake; SigV4/OAuth both care) and the `TRANSIENT_CONTROL_ERROR` retry on the
  first post-resume control call (`microvm.ts:182-208`).
- **Survive host reboot**: state files (`bootstrap.ts:176-259`) + pushed
  branches + baked golden means "re-clone + `.agents/resume`" needs no new
  state — only an `ensureStarted` path that falls through to `allocateClone`
  + `setupRemoteWorkspace` instead of erroring.

**Snapshot-after-setup per repo:** boot clone → bootstrap no-op → clone repo @
default branch → `.agents/setup` → pause → Full snapshot to
`<store>/repo-<id>.{ext4,mem,vmstate}` (~24h TTL) → sessions restore from it.
Two things the conversion must do now:
1. **Never launch a run before a shareable snapshot** — per-launch credential
   uploads make any launched-into VM per-session-only.
2. **Keep the clone token out of at-rest git config for snapshot candidates**:
   clone-then-scrub (`git remote set-url origin <plain-https>` after
   clone/fetch) plus per-boot token injection via a
   `GIT_ASKPASS`/credential-helper file uploaded like the other per-launch
   material (slice E).

## 8. Implementation slices (each shippable behind `firecrackerMicrovm.enabled`)

**Slice A — payload-baked golden + store metadata.** Deploy-side only; live
behavior unchanged (the bigger golden is inert to the workspace-runtime code,
whose marker check ignores it).
- Touches: `deploy/sandbox/microvm/Dockerfile.runner` (new),
  `refresh-sandbox-golden.sh` (build runner variant, write `golden.json`,
  keep rollback/locking), `deploy/sandbox/README.md`.
- Verify: rebuild golden; `clone.sh create` a scratch index; daemon `/exec`
  for `cat ~/.bks-bootstrapped`, `opencode --version`, `claude --version`,
  `test -d <payload>/.git`; destroy. Existing microvm sessions keep working.

**Slice B — adapter conversion.** The core change.
- Touches: `microvm.ts` (drop the `runtime !== "workspace"` throw + header;
  `ensure()` → `assertDialbackReachable` + `bootstrapRemoteSandbox`; pass
  `callbackBaseUrl: sandboxCallbackBaseUrl()`), `bootstrap.ts` (add
  `callbackBaseUrl` to `RemoteSandboxParts`/`makeRemoteLauncher`),
  `microvm.test.ts`.
- Interop: while Slice C isn't landed, `sandboxEnginePlacement` still returns
  `"host"` for opencode-on-microvm — flip the matrix rows in this slice
  (`config.ts:620-674`: claude `microvm: true`, stop forcing host placement).
  Pre-existing sessions carry `sandbox.engine: "host"` sticky state
  (`run-session.ts:1086-1088`) — no-backcompat: ignore/clear it.
- Verify: add a `microvm` entry to `deploy/sandbox/conformance.ts` (absent
  today — the real deliverable of this slice's verification): ensure/reuse,
  exec semantics, in-sandbox volume clone, launchRun round-trip + steer +
  cancel over WS dial-back, get() reattach, destroy. Manual restart-reattach
  check (kill opensession mid-run, confirm `resumeRemoteSandboxRun`
  reattaches).

**Slice C — delete the placement matrix + workspace-MCP path.** Server +
frontend surgery per §5; introduce `sandboxableModelFamily`.
- Touches: `config.ts`, `run-session.ts`, `interactive-mcp.ts`,
  `provider.ts`, `bootstrap.ts`, `workspace-mcp.ts`/tests (rm),
  `session-create.ts`, `session-control-wiring.ts`, `routes/workspace.ts`,
  `types.ts`, `frontend/components/NewSession.tsx`,
  `frontend/lib/api/automations.ts`, `capability-status.test.ts`, all
  adapters, `verify-external-engine.ts` (rm).
- Verify: `bun test`, `conformance.ts docker-socket docker-ws microvm`, live
  smoke: Claude-model microvm session, one turn, diff/status/@-mention
  through workspace-exec, push.

**Slice D — prewarm + docs + trust-note cleanup.**
- Touches: `microvm.ts` prewarm adapter, `docs/self-hosting-sandboxes.md`
  (rewrite microvm section: brain-inside, dial-back requirement, egress/trust
  framing, golden refresh cadence), `bootstrap.ts:44-50` credential note.
- Verify: warm-on-typing → adopt → first turn on the prewarmed clone,
  `conformance.ts` green, stale-signature prewarm refused after a deliberate
  opencode-pin bump.

**Slice E (optional, unblocks the snapshot slice):** per-launch `GH_TOKEN`
injection and clone-token scrubbing (§7.2) — small, independently landable.
