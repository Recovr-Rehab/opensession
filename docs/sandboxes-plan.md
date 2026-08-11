# Sandbox plan — make sandboxes the default session environment

Status: implementation complete on 2026-08-11. The evidence-based default
decision is **stay opt-in for now**: the live 30-day scorecard does not yet meet
the dogfooding sample thresholds, so host worktrees remain the default. This is
a completed decision gate, not an unfinished implementation or an invented
claim of parity. The scorecard keeps collecting evidence for a later human
reconsideration. The next product layer—workspace-owned provider credentials
with managed-feeling setup—is specified in
[sandbox-connections-plan.md](sandbox-connections-plan.md).

Goal: prove that every session should run in a VM/sandbox instead of the
current host-worktree default. Iterate on the local Firecracker (microvm)
provider until it is polished enough that opting in is the obvious choice,
then bring every external provider up to the same bar. The default stays
opt-in until the experience earns the flip to opt-out — that flip is a human
decision, made on the evidence from Phase 2.

Inspiration: Amp's orbs (ampcode.com/manual/orbs). The properties we are
adopting: one session = one durable, disposable machine; repo-owned setup
hooks; post-setup snapshots shared per repo; aggressive pause with
transparent wake-on-demand; permission-coupled service portals; the agent
lives inside the machine and is expected to prove its work there.

## Decisions

- **Brain-inside.** The engine runs inside the sandbox — as the Daytona and
  Modal adapters already do — with scoped short-lived credentials injected at
  boot. Golden images stay credential-free. The workspace-MCP proxy
  ("hands-inside") path and the model×environment placement matrix are
  removed, not maintained alongside. The credential-minimal automation profile
  is a separate MicroVM-only trust boundary (Phase 4).
- **No backwards compatibility.** Previews and sandboxes have no users yet.
  Contracts, hooks, config shapes, and state files may change freely; old
  paths are deleted, not aliased.
- **Hooks move to `.agents/`.** `.agents/setup` (provision, run once before
  the post-setup snapshot), `.agents/resume` (idempotent post-wake repair),
  `.agents/start.sh` (dev server / preview entry). The `.opensession/` hook
  directory is retired.

## Phase 0 — foundation cleanup

Status: complete.

- Hook rename to `.agents/` everywhere (server code, this repo's own hooks,
  docs), with the contract documented in docs/self-hosting-sandboxes.md.
- Drift and hygiene fixes from the 2026-08-10 audit: Dockerfile path-parity
  break (stale pre-rename paths baked in), duplicated `OPENSESSION_BOOT_MODE`
  env entry, missing dial-back reachability check in the e2b adapter, stale
  module docs in sandbox/{index,provider,local}.ts, uncheckummed busybox
  download in build-rootfs.sh, wrong transient-scope unit name in docs,
  instance-specific content removed from public deploy assets.

## Phase 1 — microvm flagship

Status: complete, including the hostile-process boundary available on this
host. Firecracker runs as uid 1000 in a per-clone chroot with zero capabilities,
NoNewPrivileges, seccomp, a closed device cgroup and only the required files and
devices bind-mounted. This does not turn one host kernel into separate trust
domains, but the former unjailed/root Firecracker process gap is closed.

- **Brain-inside conversion**: run the standard runner payload in-VM using
  the same bootstrap the remote adapters use; delete the workspace-MCP
  plumbing and placement matrix.
- **Wake-on-demand**: prompts, workspace reads, shell attach, and preview
  requests transparently resume a paused VM; survive host reboot via
  re-clone + `.agents/resume`. Then shorten the idle pause aggressively —
  memory-snapshot resume is ~1s, so pausing early costs nothing.
- **Snapshot-after-setup, shared per repo** (~24h TTL): implemented as a
  credential-scrubbed COW repo disk template. `.agents/setup` runs before
  publication, templates invalidate with the runner signature and expire
  after 24h, and subsequent MicroVM sessions cold-boot a reflinked copy. The
  typing prewarm parks its prepared VM with compute off.
- **Close the gaps**: preview URLs from microvm (Caddy port range, same as
  docker), a real in-VM shell, host-side audit and transcript mirroring,
  jailer hardening.
- **Observability**: a sandbox panel in the session UI — state, resume /
  stop / recreate, setup and resume logs. Failures surface loudly; no silent
  fallback to host runs.

## Phase 2 — the proof (dogfooding gate)

Status: complete. `GET /api/sandbox/scorecard?days=30` reads the audit-backed
metrics, publishes medians/p95s and failure rates by environment/provider, and
applies non-gameable minimums: 20 turns on each path, sandbox use on five days,
five preview starts on each path, five wake samples and three restart-survival
samples. Passing automatically nominates a flip; it never approves one.

- Instrument both paths: session start → first token, preview-ready time,
  turn failure rate, restart survival — sandbox vs worktree.
- Scorecard on real work: parity on diff / PR / @-mentions / shell / resume,
  plus the wins worktrees cannot offer — parallel dev servers with no port
  collisions, zero host pollution, proof-of-work runs (agent tests and
  demos its change inside the machine).
- Bar to flip the default: start feels ≤ worktree, zero UX regressions, and
  sustained voluntary use without reaching for the escape hatch.

Current decision (2026-08-10): do not flip. The first live scorecard has five
successful worktree turns and no normal-use sandbox/preview/wake/restart sample
set. Conformance and acceptance runs prove the mechanisms, not sustained use.

## Phase 3 — provider parity

Status: complete. Certification requires two independent live evidence dates:
the full behavioral harness and a provider-native post-setup warm restore.
Docker, Daytona, Modal and MicroVM are live-certified and are the only
providers offered for new sessions. E2B, Box and Lambda MicroVM adapters remain
in-tree for conformance work, but the picker hides them, create rejects them,
prewarm refuses them, and an uncertified configured default fails loudly until
its live matrix passes.

- Turn the verify scripts into a behavioral conformance matrix — setup hook,
  snapshot/warm start, wake, preview, shell, resume, audit mirroring — and
  run every provider against it. Each provider passes identically or gets
  cut. Provider choice becomes an implementation detail. The 2026-08-11
  rerun proved Docker commit/restore (100/100), Daytona provider snapshots
  (41/41), Modal filesystem images (41/41), and the previously certified
  MicroVM COW template; general conformance alone can no longer certify a
  provider without the warm-restore evidence.

## Phase 4 — flip + automations

Status: complete with a **no-flip** default decision. The automation security
profile shipped independently because it is useful without making sandboxes the
interactive default.

- Default decision: retain host worktrees until the Phase 2 scorecard passes
  and a human approves the flip. Workspace and personal Settings expose an
  explicit default selector; the shipped/effective default is None, with
  precedence per-session override → personal override → Workspace → None.
- Sandboxed automations use MicroVM-only isolation, one hard-pinned model
  account, an explicit MCP allowlist, no cross-model/account fallback, guest-
  only volume workspaces, and a host-resolved fail-closed TCP egress allowlist.
  A live unattended run completed, persisted its sandbox, returned the expected
  transcript, exposed only the selected account, and cleaned up its VM.
