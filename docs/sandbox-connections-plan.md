# Sandbox connections plan — managed-feeling BYOC

Status: ready to goal. Implementation has not started.

This is the next product layer after [sandboxes-plan.md](sandboxes-plan.md).
The underlying providers, brain-inside runner, lifecycle hooks, warm templates,
Portals and behavioral certification already work. This plan removes the
operator work between “I have a sandbox-provider account” and “my workspace can
run sessions there.”

## Objective

Make self-hosted Open Session operate user-funded sandbox infrastructure as if
it were managed:

1. A workspace administrator opens **Workspace → Sandboxes**.
2. They connect Daytona or Modal by entering workspace credentials, or enable
   Docker or Local MicroVM with one generated host command.
3. Open Session configures and qualifies the connection, prepares repository
   environments and keeps them healthy.
4. Workspace members only choose where sessions run. They never configure a
   provider or handle its credentials.

There is no Open Session cloud control plane, hosted relay, provider account or
consolidated bill. The operator hosts Open Session; the workspace owns each
provider account and pays that provider directly.

## Fixed decisions

- **BYOC only.** Daytona and Modal use workspace-owned accounts and billing.
  Open Session does not proxy billing or resell compute.
- **Configuration is workspace-only.** Only a workspace administrator can add,
  edit, test or disable a sandbox connection. Personal settings contain no
  credentials and cannot change provider configuration.
- **Selection has three levels.** An explicit per-session choice wins over the
  person's default, which wins over the workspace default.
- **None remains first-class.** None means the current host/worktree path. It
  remains visible and is the shipped workspace default. This plan does not
  approve the evidence-gated default flip from `sandboxes-plan.md`.
- **Local MicroVM remains first-class.** It is not hidden behind a generic cloud
  label and should become the best self-hosted isolated experience.
- **Provider names remain visible choices.** Ready providers appear as None,
  Local MicroVM, Docker, Daytona and Modal. We are not adding an opaque `Auto`
  placement policy in this plan.
- **Keep the proven dial-back transport.** Remote runner-hosts continue to dial
  Open Session over `run-ws` and `rpc-ws`. Reversed transport is out of scope
  unless real setup telemetry later proves public callback ingress is the
  dominant failure.
- **Extend Caddy, not the webhook process.** Caddy terminates public TLS and
  routes exact paths to separate loopback listeners. Webhooks remain on 3848,
  sandbox control remains on 3860 and the main app remains on 3850.
- **Certification and qualification are different.** The repository's full
  live matrices certify an adapter release. A short disposable smoke qualifies
  a particular workspace account and host. Users never run the 41/41 or
  100/100 release suites during setup.
- **No silent provider fallback.** A failed Daytona session does not start on
  Modal, MicroVM or the host. Retrying the same provider is allowed; changing
  the execution/security/billing boundary requires a person to choose it.
- **One connection per provider initially.** Supporting several Daytona or
  Modal accounts in one workspace adds selection and secret-ownership UX with
  no value for the first release. The stored shape may use stable connection
  IDs so this can expand later.

## Current baseline

The completed sandbox plan already provides:

- Live-certified Docker, Daytona, Modal and MicroVM adapters.
- Engines inside the sandbox, durable WebSocket replay and restart reattach.
- `.agents/setup`, `.agents/resume` and `.agents/start.sh`.
- Provider-native post-setup templates with credential scrubbing.
- Prewarming, pause/wake, terminals and authenticated multi-service Portals.
- Workspace and personal defaults with effective default None.
- A fail-closed provider picker: only configured and certified providers can be
  selected.

The remaining operator experience is not acceptable as a mainstream setup:
raw `~/.opensession-sandbox.json`, provider tokens in configuration, manual
Caddy/public callback configuration, Docker image builds, MicroVM golden-image
work and manual verification commands. Those become implementation details of
connections and setup commands.

## Product model

### Workspace configuration

Add a dedicated **Workspace → Sandboxes** settings section. It owns provider
connections and the workspace default.

The page begins with:

- Workspace default: None, Local MicroVM, Docker, Daytona or Modal.
- A short explanation that people can override the default personally or per
  session.
- A connection card for each compiled provider.

Only connections that are both release-certified and workspace-qualified can
be selected as defaults. Uncertified adapters may appear under an Advanced
development disclosure, but cannot be enabled for ordinary sessions.

### Personal selection

**Personal → Preferences → Default sandbox** remains a selector, with no setup
controls. Its choices are:

- Workspace default — `<effective workspace choice>`
- None
- Every Ready workspace connection

If a selected connection becomes unavailable, the preference remains stored
and is marked unavailable. New-session creation fails clearly until the person
chooses a Ready connection or explicitly chooses None; it must never silently
choose the host or a different billable provider.

### Per-session selection

The new-session picker shows None plus every Ready workspace connection. Its
initial value is the effective personal/workspace default. The explicit choice
is persisted on the session and wins over both defaults.

Forks retain their existing host rule. Automations retain their explicit,
separately secured MicroVM-only policy; making an interactive provider Ready
does not widen automation access.

### Connection-card states

Every card uses the same small state machine:

| State | Meaning | Primary action |
| --- | --- | --- |
| Not configured | No usable workspace connection | Connect / Enable |
| Checking | Credentials or host capability are being tested | View progress |
| Preparing | Base/project environment work is running | View logs |
| Ready | Qualification passed and the connection is selectable | Test again |
| Needs attention | Credential, networking, quota or runtime check failed | Fix issue |
| Disabled | Configuration retained but new use is refused | Enable |
| Updating | Runner/template signature changed and rebuild is underway | View progress |

Raw provider IDs, sandbox IDs, snapshot names and API payloads live under a
Diagnostics disclosure. The main card uses product language and a concise,
actionable failure.

## Workspace connection data

Introduce a normalized server-owned connection record instead of treating raw
provider blocks as the product model:

```ts
interface SandboxConnection {
  id: string; // stable, opaque
  provider: "docker" | "daytona" | "modal" | "microvm";
  enabled: boolean;
  credentialRef?: string; // Daytona/Modal; never returned to clients
  settings: {
    region?: string;
    cpu?: number;
    memoryMb?: number;
    snapshot?: string;
  };
  qualification?: {
    status: "checking" | "ready" | "failed";
    adapterSignature: string;
    checkedAt?: string;
    failureCode?: string;
    failureSummary?: string;
  };
}
```

The exact persistence file may remain the sandbox config initially, but APIs
and consumers use this normalized shape. Provider secrets do not.

### Credential storage

- Daytona API keys and Modal token pairs are workspace secrets in the existing
  server-side keychain/secret abstraction.
- Configuration stores only an opaque credential reference.
- Connect/update endpoints accept a secret once and never echo it.
- Status, logs, audit events, errors and browser responses never contain the
  secret or a reversible fragment.
- Credential access is limited to provider SDK construction and the narrowly
  scoped qualification/launch operations.
- Interactive sessions receive model and clone credentials through the existing
  projection rules; provider account credentials never enter a sandbox.
- Disabling a connection revokes future provider use but does not delete live
  sandboxes without a separately confirmed action.

### Authorization

- Readiness and selectable-provider status may be read by authenticated
  workspace members.
- Connect, update, disable, rebuild and destructive cleanup routes require the
  same verified workspace-admin gate as other instance settings.
- Client-claimed user names never grant configuration authority.
- Personal preference writes continue to use the verified request identity.

## HTTP surface and module ownership

Move the sandbox status/default endpoints out of `routes/models.ts` into a
focused `src/server/routes/sandboxes.ts`, registered in `routes/index.ts`.
That module owns the HTTP surface; provider work remains in `src/server/sandbox/`.

Planned routes:

| Route | Purpose |
| --- | --- |
| `GET /api/sandbox/status` | Certified providers, Ready connections, defaults and effective choice |
| `GET /api/sandbox/connections` | Workspace connection cards and safe diagnostics |
| `POST /api/sandbox/connections/:provider/connect` | Store workspace credentials/config and start qualification |
| `PATCH /api/sandbox/connections/:provider` | Enabled state and non-secret defaults |
| `POST /api/sandbox/connections/:provider/test` | Re-run account/host qualification |
| `POST /api/sandbox/connections/:provider/repair` | Rebuild local runtime or provider environment |
| `DELETE /api/sandbox/connections/:provider` | Confirmed disconnect; credential and future-use removal |
| `GET /api/sandbox/environments` | Per-repo/provider environment readiness |
| `POST /api/sandbox/environments/:repo/:provider/rebuild` | Explicit project-template rebuild |
| `PUT /api/sandbox/defaults` | Existing workspace/personal selection semantics |

Long qualification and environment operations return an operation ID. State is
persisted and broadcast over the existing UI WebSocket so a page reload or
server restart does not turn progress into an unknown spinner.

## Caddy and remote callback ingress

### Boundary

Keep three separate loopback origins:

| Listener | Public purpose | Authentication |
| --- | --- | --- |
| `127.0.0.1:3848` | GitHub, Linear, Plain, Stripe and automation webhooks | Route-specific signatures/secrets |
| `127.0.0.1:3860` | Sandbox `run-ws`, `rpc-ws`, ingress health only | Per-launch run-host bearer token + rate limit |
| `127.0.0.1:3850` | Main Open Session UI/API | Team/session authentication; not exposed merely for sandboxes |

Caddy may use the existing webhook hostname for all public machine ingress:

```caddy
ingress.example.com {
    handle /opensession/run-ws/* {
        reverse_proxy 127.0.0.1:3860
    }

    handle /opensession/rpc-ws {
        reverse_proxy 127.0.0.1:3860
    }

    handle /ingress-health {
        reverse_proxy 127.0.0.1:3860
    }

    handle {
        reverse_proxy 127.0.0.1:3848
    }
}
```

Caddy performs TLS termination and WebSocket proxying only. Webhook signature
checks stay in the webhook listener. Run-host token checks stay in
`run-ws.ts`. The main application is not a fallback upstream.

### Permanent versus dynamic Caddy state

- Permanent machine ingress is declarative and survives Caddy/Open Session
  restarts. It belongs in an installer-managed Caddy fragment or an explicitly
  user-managed Caddyfile.
- Dynamic per-session Portal routes continue using the Caddy Admin API and the
  process-owned fail-closed route registry.
- The setup command never replaces an arbitrary Caddy configuration. It backs
  up any file it owns, writes atomically, runs `caddy validate`, reloads rather
  than restarts Caddy, verifies the new route and rolls its own change back on
  failure.
- If Open Session does not own the Caddy config, Settings presents a generated
  snippet and a **Test again** action rather than mutating it.

### No Open Session restart during connect

The isolated loopback ingress must be available before a provider is connected.
Start it unconditionally on production boot at loopback, or give it a dynamic
lifecycle manager that can bind on demand. Loopback exposure is harmless: its
surface is already three routes, the run token registry is empty when unused,
and every other path is a bodyless 404.

Changing the public callback URL or adding a workspace connection must not
require restarting Open Session. Port/host changes may remain an advanced
restart-requiring operation.

### Discovery and preflight

The wizard attempts these sources in order:

1. Existing sandbox `publicBaseUrl`.
2. A configured public webhook origin.
3. A single unambiguous Caddy host already proxying to 3848.
4. A public Open Session base URL, only if the operator explicitly approves
   adding the narrow machine paths there.

It proposes the inferred origin; it does not silently publish DNS or change a
security group.

Qualification proves more than `/ingress-health`: a disposable sandbox dials a
short-lived test `run-ws` registration and completes the authenticated
WebSocket handshake. This catches WebSocket proxy, bearer-header, provider
egress and account-tier failures that an HTTP health check cannot.

When no callback is reachable, the card offers:

- Install/fix the generated Caddy route.
- Enter an existing public HTTPS origin under Advanced.
- Use Local MicroVM, Docker or None.
- Configure private provider networking under Advanced.

Reversed transport becomes a separate RFC only if telemetry shows that more
than 20% of otherwise valid Daytona/Modal connections fail solely because no
callback can be made reachable.

## Provider setup flows

### Daytona

The admin enters an API key and optional region/resource overrides. Open
Session then:

1. Stores the key as a workspace secret.
2. Authenticates and reads organization/resource limits.
3. Selects safe defaults when no override was supplied.
4. Verifies the public callback with an authenticated disposable dial-back.
5. Creates the smallest viable disposable sandbox.
6. Checks argv/stderr exec semantics, upload, encrypted preview/port access,
   lifecycle calls and snapshot permission.
7. Restores a minimal qualification snapshot into a distinct sandbox.
8. Destroys both sandboxes and audits that no tagged leftovers remain.
9. Records Ready against the current adapter signature.

The existing full repo snapshot may take minutes to publish; that is project
environment preparation, not part of the blocking credential form. Setup may
show **Connected · Preparing environments** while that background work runs.

### Modal

The admin enters a token ID and token secret plus optional app/environment,
region and resources. Open Session:

1. Stores the pair as one workspace credential.
2. Authenticates and checks app/environment access.
3. Verifies the public callback with an authenticated disposable dial-back.
4. Creates a minimal disposable sandbox with encrypted ports.
5. Checks exec, upload, tunnel discovery and filesystem-image permission.
6. Restores a minimal qualification image into a distinct sandbox.
7. Terminates both and verifies no tagged leftovers remain.
8. Records Ready against the current adapter signature.

### Docker

The UI generates one host command:

```sh
opensession sandbox enable docker
```

The command:

1. Checks Docker and installs or explains the missing host prerequisite.
2. Pulls a signed, version-matched, multi-architecture runner image.
3. Installs a persistent metadata-service firewall unit.
4. Writes a workspace connection without exposing raw config editing.
5. Runs the disposable Docker verifier.
6. Reports Ready to the running server without requiring a restart.

To make a prebuilt image universal, remove Docker's host-checkout path-parity
requirement from the default path. Use a stable in-image runner location and a
volume/brain-inside workspace. Before making that path the easy default, bring
attached repos, sibling sessions, diff, files, PRs and Portals to parity with
bind workspaces. Bind mode may remain Advanced for existing installations.

### Local MicroVM

The UI generates one privileged host command:

```sh
opensession sandbox enable microvm
```

The command:

1. Checks Linux, `/dev/kvm`, CPU virtualization, Firecracker, cgroups, required
   devices, disk capacity and reflink/COW support.
2. Installs the jailer helper, networking and systemd assets idempotently.
3. Downloads a checksum/signature-verified golden matching the Open Session
   release and host architecture. Building locally remains a documented
   fallback for unsupported hosts and development releases.
4. Registers the store and local private callback automatically.
5. Boots a disposable VM and verifies runner version, private networking,
   agent execution, terminal, Portal, pause/wake, template restore and teardown.
6. Cleans every qualification clone and records Ready.

Publishing signed goldens is part of this plan: the release pipeline builds
them from source, records the runner/bootstrap signature and publishes checksums
and provenance. A normal operator must not run `refresh-sandbox-golden.sh`.

MicroVM does not need public Caddy ingress; it uses the existing private/local
callback path. Its card still shows the same connection/readiness vocabulary.

## Project environment preparation

Connection qualification proves the account/runtime. A project environment is
provider- and repo-specific and may take longer.

### Trigger

Prepare an environment when:

- A connection becomes Ready and the workspace has active repos.
- A member selects that provider/repo in New session.
- A relevant default-branch push invalidates the current template.
- An admin explicitly chooses Rebuild.

The first prompt may be accepted and visibly queued behind preparation; the
user should not need to return and submit it again.

### Build

1. Clone the default branch using a short-lived existing GitHub credential.
2. Run `.agents/setup` once with retained logs.
3. Run provider-independent readiness checks.
4. Scrub clone authority, model credentials, provider credentials and temporary
   setup material.
5. Seal the filesystem with the existing nonce/signature proof.
6. Publish the provider-native Daytona snapshot, Modal Image or MicroVM COW
   template.
7. Restore a distinct sandbox/VM and validate the seal before marking Ready.
8. Destroy build/validation compute and retain only the bounded artifact.

### Identity and invalidation

The template key includes:

- Provider and connection ID.
- Repo ID and default branch.
- Runner/bootstrap signature.
- `.agents/setup` content hash.
- Dependency/toolchain lockfile hashes.
- Architecture and relevant resource/create shape.

Default-branch commits that do not change those inputs may reuse the template;
session adoption fetches the current branch before creating the session branch.
Template TTL remains bounded. A new build does not replace the last known-good
template until its independent restore validation passes.

### Repair

A failed build shows the concise failure plus retained setup tail. **Diagnose
and fix environment** starts a normal trusted session that can inspect the repo,
propose `.agents/setup` changes, exercise them in a disposable environment and
open a PR. It never edits another repository automatically from Settings.

## Reliability and operating behavior

- Retry transient creation/start errors once on the same connection with a
  bounded backoff. Permission, credential, quota and setup errors do not retry
  blindly.
- Record connection health separately from project environment health.
- Re-check cheap account health periodically and on an actionable failure; do
  not create paid qualification sandboxes on a timer.
- Adapter-signature changes make qualification stale and schedule a recheck.
  They do not silently invalidate running sessions.
- Runner/setup/create-shape changes rebuild templates in the background while
  retaining the last known-good artifact.
- Provider prewarm caps and TTL remain workspace-wide cost controls.
- Orphan sweeps may delete only Open Session-tagged resources owned by the
  connection and absent from persisted state. Every destructive sweep is
  audited without secret content.
- Disabling a connection immediately removes it from new defaults/pickers and
  stops new prewarms. Existing sessions remain inspectable and can be explicitly
  resumed or destroyed according to a clearly stated policy.
- Provider errors are normalized to stable failure codes for UI/action logic,
  while the original safe diagnostic is retained server-side.
- Settings links to the provider's own usage/quota dashboard. Open Session may
  show resource estimates, but does not claim authoritative billing totals.

## Migration

Existing installations must not lose provider configuration or live sandboxes.

1. Read the current `provider`, `sessionDefault`, provider blocks and environment
   credential fallbacks.
2. On the first admin visit or explicit migration command, build normalized
   connection records and show what will move.
3. Store raw Daytona/Modal credentials in the workspace secret store first.
4. Atomically write credential references and normalized connection state while
   preserving every unrelated sandbox setting.
5. Re-read and authenticate through the new reference before removing the raw
   credential from the old block.
6. Keep an owner-readable backup with explicit retention and deletion guidance;
   never log its contents.
7. Map the existing configured and certified provider to Ready only after the
   short qualification passes. Until then, show **Needs check**, not a false
   failure and not an invented Ready state.
8. Preserve `sessionDefault` and existing personal UI preferences exactly.
9. Existing sessions retain their physical provider/id and continue reattaching
   independently of the new connection record.

Environment-variable credentials remain an Advanced operator override. The UI
may report that credentials are externally managed but cannot reveal or replace
them until the operator deliberately converts to stored workspace credentials.

## Implementation phases

### Phase 0 — contracts and state

- Add normalized connection types, stable failure codes and adapter signature.
- Add the workspace secret reference boundary.
- Implement legacy-config projection and atomic migration tests.
- Extract sandbox routes from `routes/models.ts`.
- Preserve current defaults and create-path behavior.

Exit: the new safe status API can represent current installations without
changing a file or launching compute.

### Phase 1 — workspace and personal UI

- Add the Workspace → Sandboxes navigation section and `SandboxesPanel`.
- Move the workspace default out of Models into the new panel.
- Keep the personal selection row in Preferences, driven by Ready connections.
- Add connection cards, state transitions, safe diagnostics and confirmation
  flows.
- Verify desktop/phone, keyboard, loading, empty, error and disabled states.

Exit: configuration and selection ownership are understandable before any
provider mutation is enabled.

### Phase 2 — persistent Caddy ingress

- Make the narrow loopback public-ingress listener available without a restart.
- Add Caddy-origin discovery and connectivity diagnostics.
- Add an idempotent installer-managed fragment workflow with validate, reload,
  verification and rollback.
- Preserve the manual/generated-snippet path for externally managed Caddy.
- Add authenticated disposable `run-ws` qualification probes.

Exit: an installation with existing public webhook Caddy can enable sandbox
dial-back without exposing 3850 or restarting Open Session.

### Phase 3 — Daytona and Modal connect

- Implement secret ingestion, provider-safe settings and admin routes.
- Implement the bounded disposable qualification matrices above.
- Persist/rebroadcast operations across reload/restart.
- Normalize quota, credential, network and snapshot failures.
- Prove provider cleanup after success and every injected failure point.

Exit: paste credentials → Ready works without terminal, JSON, provider-side
snapshot setup or Open Session restart.

### Phase 4 — Docker and MicroVM enable commands

- Ship the `opensession sandbox enable|disable|test <provider>` CLI surface.
- Publish the universal signed Docker runner image.
- Complete Docker volume-workspace feature parity required for the easy path.
- Publish signed MicroVM goldens and install the jailed runtime/networking.
- Connect CLI operation progress back to the running UI.

Exit: each local provider needs one generated privileged command and no manual
config/image lifecycle.

### Phase 5 — project environments

- Add persisted per-repo/provider build state and operations.
- Trigger, deduplicate and rate-limit background builds.
- Reuse the existing post-setup seals and provider artifacts.
- Add last-known-good promotion, invalidation and repair flows.
- Queue a first prompt behind preparation with visible progress.

Exit: setup and snapshots are background product behavior, not instructions an
operator follows.

### Phase 6 — reliability and rollout

- Add health refresh, same-provider retry and provider dashboard links.
- Add orphan/failure-injection tests and upgrade compatibility checks.
- Instrument connect funnel, qualification failures, readiness time, template
  time, launch/wake time, cleanup and override use without secret content.
- Dogfood every Ready provider through ordinary sessions.
- Keep the workspace default None until the existing scorecard and a human
  decision approve a change.

Exit: acceptance below passes and support can diagnose failures from the UI and
audit log without asking for secrets.

## Verification

### Unit and route tests

- Connection parsing, migration, credential-reference redaction and atomic
  preservation of unrelated config.
- Admin-only writes and verified-identity personal preferences.
- Default precedence, disabled/stale connection behavior and explicit None.
- Qualification state persistence and restart recovery.
- Stable provider error classification.
- No provider credential in serialized responses, logs or audit fixtures.

### Caddy and ingress tests

- Generated Caddy config validates before reload.
- Existing webhook routes continue reaching 3848.
- Only exact sandbox paths reach 3860; unrelated paths never reach 3850.
- WebSocket upgrade works through real Caddy.
- Missing/wrong/expired run tokens fail before upgrade.
- Rate limiting trusts only proxy-appended client IP data.
- A failed config/reload restores the owned prior fragment.
- Re-running installation is byte-stable/idempotent.

### Provider qualification tests

- Live disposable Daytona and Modal qualification using workspace test accounts.
- Permission, quota, invalid credential, callback and snapshot failures injected
  independently with zero leftovers.
- Qualification snapshot/Image restored into a distinct sandbox.
- Credential rotation followed by requalification.

### Local provider tests

- Clean supported Linux host enablement for Docker and MicroVM.
- Unsupported `/dev/kvm`, filesystem and architecture failures are actionable.
- Signed artifact verification refuses a mismatch.
- Re-running enable is idempotent; disable preserves recoverable state unless a
  destructive cleanup was separately confirmed.
- Full Docker and MicroVM behavioral matrices remain green.

### Frontend acceptance

- Workspace admin and ordinary member permissions.
- Desktop and phone layout.
- Keyboard navigation and native selector behavior.
- Loading, checking, preparing, ready, stale, failed and disabled states.
- Credential fields clear after submission and never repopulate from the API.
- Personal and per-session override including None.

Run `bun run typecheck`, focused tests and the full `bun test` suite before
each shipped backend slice. Backend slices are committed and pushed before one
deliberate service restart; Caddy changes additionally pass a real route smoke.

## Instrumentation and rollout gates

Record content-free events for:

- Connection wizard opened/completed/abandoned.
- Qualification stage, duration and stable failure code.
- Whether callback origin was inferred, manually entered or unavailable.
- Project environment build/restore duration and outcome.
- Session create-to-ready and wake latency by provider.
- Same-provider retry outcome.
- Orphan cleanup and leaked-resource audit result.
- Workspace, personal and per-session environment choice.

Never record credentials, provider response bodies, repository contents,
prompts, callback tokens or complete private URLs.

Reversed transport is not part of this goal. Propose it separately only after
the callback-only failure rate crosses the fixed 20% threshold with a meaningful
sample, or a provider removes the required outbound behavior.

## Definition of done

### Daytona or Modal

On an already public-Caddy-enabled self-hosted instance, a workspace admin:

1. Opens Workspace → Sandboxes.
2. Pastes the workspace provider credential.
3. Clicks Connect.
4. Sees the qualification stages and then Ready.
5. Selects it as workspace default if desired.

They do not use a terminal, edit JSON, restart Open Session, create provider
snapshots manually or visit the provider dashboard to configure Open Session.
The entire disposable qualification leaves zero resources behind.

### Docker or MicroVM

A workspace admin runs the single command generated by Settings, returns to the
page and sees Ready. They do not edit a Dockerfile, sandbox config, Firecracker
unit or golden-image script. Routine Open Session upgrades reconcile compatible
runner artifacts automatically.

### Workspace members

- They inherit the workspace default.
- They can personally choose Workspace default, None or any Ready workspace
  provider.
- They can override that selection for one session.
- They cannot see, add or mutate provider credentials/configuration.
- If a choice is unavailable, creation fails clearly until they choose a Ready
  provider or explicitly choose None; it never changes the execution boundary
  or charges another provider silently.

### Operational bar

- Existing webhook traffic remains healthy while sandbox control shares Caddy.
- Main port 3850 is not newly exposed to the public internet.
- Prepared remote sessions reach usable runner state at p50 ≤10 seconds and
  p95 ≤20 seconds, measured separately from first project setup.
- MicroVM wake remains ≤5 seconds at p95 on supported hosts.
- Connection qualification succeeds without manual correction for at least 95%
  of attempts that begin with valid credentials, sufficient provider quota and
  an existing public Caddy origin.
- Every success/failure test proves cleanup; no untracked provider resource is
  left after the bounded sweep window.
- The existing sandbox scorecard still governs any proposal to replace None as
  the shipped default.

## Explicit non-goals

- An Open Session-hosted control plane, relay, compute fleet or cloud product.
- Open Session-owned provider credentials, billing or cross-provider invoices.
- Personal provider connections or personal provider credentials.
- Automatic placement or cross-provider failover.
- Reversed runner transport in this goal.
- Making remote sandbox ingress expose the main UI/API listener.
- Replacing webhook signatures with sandbox run tokens, or vice versa.
- Certifying E2B, Box or Lambda MicroVM without their complete live evidence.
- Automatically merging an agent-generated `.agents/setup` change.
- Flipping the shipped workspace default away from None.

## Suggested goal objective

> Implement `docs/sandbox-connections-plan.md` end to end: workspace-only BYOC
> sandbox connections for Daytona, Modal, Docker and Local MicroVM; persistent
> Caddy ingress using the existing separated webhook/run listeners; one-flow
> qualification and project preparation; personal and per-session selection
> overrides with None retained; migrations, security boundaries, live-provider
> verification, full tests, documentation, commits, deploy and health checks.
