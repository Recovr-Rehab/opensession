# Traces

Publish Open Session runs to [traces.com](https://traces.com) **as the person
who ran them**. A shared `trk_` API key cannot do that: Traces attributes API
key uploads to the key creator or to a linked bot Agent. Open Session therefore
stores a per-user Traces device session from GitHub login and calls
`traces share` with that token.

Open Session always runs Pi in-process. It does not write `~/.pi/agent/sessions`
or `~/.grok/sessions`, so installing the Traces CLI adapters on the server is
not enough. Publishing reads Pi JSONL under `~/.opensession/pi/sessions/<id>/`.

## Setup

1. Install the [Traces CLI](https://traces.com/docs/getting-started/installation)
   on the Open Session host, on the service user's `PATH`.
2. Create/join the team org on traces.com. Invite people with the same GitHub
   accounts they use to sign into Open Session.
3. Settings → Integrations → Traces: set `TRACES_NAMESPACE_SLUG` to the org
   slug (for example `recovr`) if login would otherwise land in a personal
   namespace. Enable the integration, save, restart.
4. Each person, signed into Open Session as themselves, reopens the dialog and
   clicks **Connect Traces**. They authorize GitHub on traces.com. The GitHub
   login must match.

Tokens live in `~/.opensession/traces-auth.json` (mode 0600) keyed by GitHub
login. They are never returned by the API.

## What gets published

After a successful interactive Pi turn (`prompt`, `slack`, `linear`, `goal`,
`create`, `workflow`), Open Session shares the latest Pi JSONL as that session's
`createdByLogin`. The share is private. The traces.com URL is stored on the
session as `externalRefs` kind `traces-trace`.

Skipped: automations, GitHub bot runs, sessions with no linked Traces account.

## Env / config

| Var / key | Notes |
| --- | --- |
| `ENABLE_TRACES_AGENT` | literal `true` to load the module |
| `TRACES_NAMESPACE_SLUG` | org slug to publish into; optional if the connected session's active namespace is already the team org |
| `TRACES_BIN` | optional path to the `traces` binary |
| `TRACES_API_BASE` | default `https://actions.traces.com` |
| `integrations.traces.enabled` | used when the env flag is unset |
| `integrations.traces.namespaceSlug` | same as `TRACES_NAMESPACE_SLUG` |
| `integrations.traces.apiBase` | REST origin |

Do not set `TRACES_API_KEY` for this integration. A namespace key would upload
every session as one identity.

## Identity

Join key is GitHub login:

- Open Session: `createdByLogin` (GitHub App user sign-in)
- Traces: personal namespace slug, else `displayName` on `GET /v1/session`

If those do not match, connect is rejected. On a single-user install with no
GitHub gate and exactly one connected Traces account, that account is used.
