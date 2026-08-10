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
