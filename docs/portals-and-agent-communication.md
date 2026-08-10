# Portals and agent-to-agent communication

Open Session has both capabilities as product primitives, not just as names
for cloud sandboxes.

## Portals

A Portal is an authenticated HTTPS route from the Open Session host to a
service running in a session workspace. A repo publishes services by writing
`.ports.conf`:

```sh
WEBAPP_PORT=3300
INSTANT_PORT=5968
WEBAPP_WORKFLOW_PORT=7233
```

Every listening entry appears under **Dev services** with its own link. This
works for host worktrees, Docker, private Firecracker veth addresses, and
provider-hosted HTTPS endpoints. Local and provider URLs are wrapped by the
same Caddy route: Caddy forward-authenticates the browser against Open Session
before proxying the request, so possession of an otherwise obscure service URL
does not bypass the app's sign-in boundary. The browser never receives a
MicroVM's private address.

The Preview button is the primary webapp Portal; the service menu is the
multi-port surface. `.agents/start.sh` receives `WEBAPP_PORT`, `PREVIEW_URL`
and `OPENSESSION_BOOT_MODE`, while `.tunnels.env` exposes the generated Portal
URLs back inside the workspace.

Current boundary: Portals inherit the instance's authenticated team boundary;
there is no per-session ACL narrower than that team boundary yet.

## Agent-to-agent communication

Interactive agents receive the `opensession-sessions` tools. Together they
cover the full worker lifecycle:

| Capability | Tool |
| --- | --- |
| Discover and inspect sessions | `list_sessions`, `get_session` |
| Start a peer or worker | `create_session`, `spawn_task` |
| Send or steer work | `send_to_session` |
| Answer a blocked worker | `answer_session_question` |
| Poll and stop delegated work | `task_status`, `cancel_task`, `cancel_session` |
| Transfer an artifact | `send_file_to_session` |

`send_to_session` steers a live run when possible and otherwise queues a new
turn, so a message is not lost at a run boundary. Spawned workers are linked to
their parent in the UI and instructed to report back; their report includes a
server-computed evidence block. The parent remains responsible for the final
decision.

`send_file_to_session` is binary-safe and works when the sending workspace
exists only inside a sandbox. It copies one relative workspace or Assets file
(maximum 4 MiB) into the recipient's Assets inbox, rejects absolute/traversal
paths, and notifies the recipient with the exact asset path. It does not expose
arbitrary host paths or copy provider credentials.

Security boundary: these cross-session controls exist only for trusted
interactive runs. Automation-owned sessions get the scoped task suite when
explicitly allowed, never the general session-control plane.
