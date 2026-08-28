# Featurebase (support tickets and feedback)

The Featurebase integration (`packages/core/opensession-server/src/agents/featurebase/`)
adds two sidebar feed projects:

- **Featurebase tickets** — open support tickets, with a Ticket workspace pane
  for the conversation, internal notes, and human-gated customer replies.
- **Featurebase feedback** — feedback posts, with a Post workspace pane for the
  body, comments, and human-gated internal comments.

New tickets and posts can fire automations. The automation itself cannot reply
to the customer or change ticket/post state.

## Env vars

| Var | Required for | Notes |
| --- | --- | --- |
| `FEATUREBASE_API_KEY` | API calls | required by the integration registry |
| `FEATUREBASE_WEBHOOK_SECRET` | webhook intake | **fail-closed**: unset or empty means every Featurebase webhook returns 401. Secret starts with `whsec_` |
| `FEATUREBASE_ADMIN_ID` | human replies and notes | Featurebase admin id used as the author on `/api/featurebase` writes |
| `FEATUREBASE_ORG_URL` | optional deep links | public portal origin, e.g. `https://support.recovr.com` |
| `FEATUREBASE_MENTION_HANDLE` | optional | `@handle` in internal notes that is delivered into a live linked session |
| `FEATUREBASE_API_BASE` | optional | REST base; default `https://do.featurebase.app` |

The usual path is Settings → Integrations → Featurebase: paste the API key,
webhook secret, portal URL, and admin id, enable the switch, save, and restart.
Reopen the dialog and use **Check connection** to confirm tickets/posts load and
to copy your admin id.

You can also put the same values in `~/.opensession.env`:

```sh
FEATUREBASE_API_KEY=...
FEATUREBASE_WEBHOOK_SECRET=whsec_...
FEATUREBASE_ADMIN_ID=6614fb278783f574b3c21e87
FEATUREBASE_ORG_URL=https://support.recovr.com
ENABLE_FEATUREBASE_AGENT=true
```

Only the literal value `true` enables an integration through an env flag. If
`ENABLE_FEATUREBASE_AGENT` is unset, use `integrations.featurebase.enabled: true`
in `~/.opensession/config.json`. The env flag wins when present. See
[integrations-misc.md](integrations-misc.md#boot-guards).

Config keys under `integrations.featurebase`:

| Key | Notes |
| --- | --- |
| `enabled` | enables the agent when `ENABLE_FEATUREBASE_AGENT` is unset; default `false` |
| `adminId` | same as `FEATUREBASE_ADMIN_ID` when the env var is unset |
| `orgUrl` | public Featurebase origin for deep links |
| `mentionHandle` | handle in internal notes that is delivered into a live linked session |
| `apiBase` | REST base; default `https://do.featurebase.app` |
| `apiVersion` | `Featurebase-Version` header; default `2026-01-01.nova` |

## MCP

Open Session does not bundle a Featurebase MCP server. Add Featurebase **Reader**
as `featurebase-reader` (or `featurebase`) in `mcp-config.json`. Keep **Writer**
on a separate server with `allowedUsers`, and never allowlist Writer on an
automation that reads ticket or post text. See
[Featurebase's MCP docs](https://help.featurebase.app/articles/6144007-featurebase-mcp-server).

Example Reader entry:

```json
{
  "mcpServers": {
    "featurebase-reader": {
      "type": "http",
      "url": "https://mcp.featurebase.app/mcp"
    }
  }
}
```

Use the URL Featurebase shows under Settings → MCP for your workspace. A stdio
server with `FEATUREBASE_API_KEY` in its `env` block also works.

## Setup checklist

1. Create a Featurebase API key and a webhook signing secret.
2. Set `FEATUREBASE_ADMIN_ID` to the admin that should own Open Session replies.
3. Configure `integrations.featurebase` and enable the agent.
4. Add the Reader MCP server.
5. Create the "Featurebase ticket triage" and/or "Featurebase post triage"
   automations from the gallery.
6. Expose Public ingress, create a Featurebase webhook for
   `POST /featurebase/webhook`, and subscribe it to the events below.
7. Restart Open Session, then run `opensession doctor` and send a test ticket.

## Webhook intake

Point the Featurebase webhook at `POST /featurebase/webhook` on
[Public ingress](install.md#public-ingress). Send Featurebase's
`X-Webhook-Signature` and `X-Webhook-Timestamp` headers. Open Session verifies
HMAC-SHA256 of `{timestamp}.{raw body}` and rejects timestamps older than five
minutes. Bodies over 1 MiB return 413.

Subscribe to:

- `ticket.created` → fire `featurebase:ticket_created`
- `ticket.updated` → archive linked sessions when the status type is completed or canceled
- `post.created` → fire `featurebase:post_created`
- `post.updated` → archive linked sessions when the post is completed or canceled
- `conversation.user.created` → fire `featurebase:conversation_created`
- `conversation.admin.noted` → deliver `@mentionHandle` notes into a live linked ticket session
- `conversation.admin.closed` → archive linked ticket sessions

## The triage automations

Create them from the Automations gallery. Scope each one:

- Tickets: `eventKey: "featurebase:ticket_created"`, MCP allowlist
  `featurebase-reader` plus whatever investigation servers you use.
- Posts: `eventKey: "featurebase:post_created"`, ask mode, Reader + Linear.
- **Denied writes** still strip customer-facing reply tool names. Do not put a
  Writer connector on these runs.
- The run's deliverable is the session report (suggested reply / classification),
  not a Featurebase write. Customer replies stay on the Ticket pane's human composer.

## Security

Ticket and post text is untrusted. Automations get Reader tools only. Human
replies go through `/api/featurebase/...`, which is not exposed as an agent
tool. See [security-model.md](../security-model.md).
