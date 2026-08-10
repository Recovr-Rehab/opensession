# Sandbox plan — make sandboxes the default session environment

Status: approved 2026-08-10.

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
  removed, not maintained alongside. A credential-free profile returns later
  as the automation mode (Phase 4).
- **No backwards compatibility.** Previews and sandboxes have no users yet.
  Contracts, hooks, config shapes, and state files may change freely; old
  paths are deleted, not aliased.
- **Hooks move to `.agents/`.** `.agents/setup` (provision, run once before
  the post-setup snapshot), `.agents/resume` (idempotent post-wake repair),
  `.agents/start.sh` (dev server / preview entry). The `.opensession/` hook
  directory is retired.

## Phase 0 — foundation cleanup

- Hook rename to `.agents/` everywhere (server code, this repo's own hooks,
  docs), with the contract documented in docs/self-hosting-sandboxes.md.
- Drift and hygiene fixes from the 2026-08-10 audit: Dockerfile path-parity
  break (stale pre-rename paths baked in), duplicated `OPENSESSION_BOOT_MODE`
  env entry, missing dial-back reachability check in the e2b adapter, stale
  module docs in sandbox/{index,provider,local}.ts, uncheckummed busybox
  download in build-rootfs.sh, wrong transient-scope unit name in docs,
  instance-specific content removed from public deploy assets.

## Phase 1 — microvm flagship

- **Brain-inside conversion**: run the standard runner payload in-VM using
  the same bootstrap the remote adapters use; delete the workspace-MCP
  plumbing and placement matrix.
- **Wake-on-demand**: prompts, workspace reads, shell attach, and preview
  requests transparently resume a paused VM; survive host reboot via
  re-clone + `.agents/resume`. Then shorten the idle pause aggressively —
  memory-snapshot resume is ~1s, so pausing early costs nothing.
- **Snapshot-after-setup, shared per repo** (~24h TTL): run `.agents/setup`
  once per repo, snapshot, boot every subsequent session from it. Fold the
  separate preview pool into this mechanism.
- **Close the gaps**: preview URLs from microvm (Caddy port range, same as
  docker), a real in-VM shell, host-side audit and transcript mirroring,
  jailer hardening.
- **Observability**: a sandbox panel in the session UI — state, resume /
  stop / recreate, setup and resume logs. Failures surface loudly; no silent
  fallback to host runs.

## Phase 2 — the proof (dogfooding gate)

- Instrument both paths: session start → first token, preview-ready time,
  turn failure rate, restart survival — sandbox vs worktree.
- Scorecard on real work: parity on diff / PR / @-mentions / shell / resume,
  plus the wins worktrees cannot offer — parallel dev servers with no port
  collisions, zero host pollution, proof-of-work runs (agent tests and
  demos its change inside the machine).
- Bar to flip the default: start feels ≤ worktree, zero UX regressions, and
  sustained voluntary use without reaching for the escape hatch.

## Phase 3 — provider parity

- Turn the verify scripts into a behavioral conformance matrix — setup hook,
  snapshot/warm start, wake, preview, shell, resume, audit mirroring — and
  run every provider against it. Each provider passes identically or gets
  cut. Provider choice becomes an implementation detail.

## Phase 4 — flip + automations

- Default new sessions to sandboxed; worktree becomes the explicit fallback.
- Sandbox automations using the credential-free profile plus an egress
  allowlist — the original security motivation, delivered last because it
  rides on everything above.
