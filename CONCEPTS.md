# Concepts

Open Session is a server that runs coding agents on your own machines. Almost
everything you do with it is one of six nouns: a **repository** you registered,
a **workspace** that groups work on a piece of it, a **session** where an agent
actually thinks, and the three ways a session gets started without you typing —
**automations**, **goals**, and **actions**.

This page is the core model. It is deliberately short on configuration; the
linked docs go deeper on each part.

## The core model

| Concept | What it is | Relationship |
| --- | --- | --- |
| **Repository** | a git checkout you registered with the server | 1 instance has many repos |
| **Workspace** | a container grouping the chats about one piece of work | 1 repo has many workspaces |
| **Session** (chat) | one conversation with an agent, with its own transcript | 1 workspace has many sessions |
| **Turn** | one prompt → one agent response, with its tool calls | 1 session has many turns |

That is the hierarchy you navigate. The URL follows it exactly:
`/workspace/<workspaceId>/chat/<sessionId>`.

Alongside it sits a second, independent axis — *where* a session's work happens:

| Concept | What it is |
| --- | --- |
| **Worktree** | the isolated git working directory a code session edits in |
| **Sandbox** | an optional container the session runs inside instead of on the host |
| **Node** | another machine (a Mac, a Windows box) attached for platform-locked work |

And a third — *what starts a session when you are not there*:

| Concept | Trigger | Memory across runs |
| --- | --- | --- |
| **Automation** | a cron schedule or an external event | none — every run is a fresh session |
| **Goal** | its own self-set wake time | yes — one session resumed over days |
| **Action** | a human filling in a form | none — one session per run |
| **Workflow** | a script fanning out many agents | none — agents report into the script |

## Repositories

A repository is a git checkout on the host that you have told Open Session
about. Registering it is what makes it selectable when creating a session.

Each repo entry carries the things the server needs to work on it
autonomously: its default branch, its `owner/name` on GitHub (for pull
requests), how to install dependencies in a fresh worktree, and how to boot its
dev server for previews. Repos live in `~/.opensession/config.json` — see
[docs/instance-configuration.md](docs/instance-configuration.md).

A repo can also commit its own lifecycle scripts (`.opensession/setup.sh`,
`.opensession/start.sh`) so every worktree of it provisions and boots itself
without instance config. That convention is what lets an agent open its own
change in a real browser — see
[docs/repo-lifecycle.md](docs/repo-lifecycle.md).

One repo can be marked a **shared checkout**, meaning its sessions work
directly in the main clone rather than in worktrees. Open Session's own
repository is configured that way so sessions improving it are editing the
thing that is running. It has sharp edges; read
[docs/worktrees.md](docs/worktrees.md#the-shared-checkout-exception) before
turning it on for anything else.

## Workspaces

A workspace groups the chats about one piece of work. Every session belongs to
exactly one workspace, and a workspace is what you actually see as a row in the
sidebar — the chats inside it are its children.

The important difference from a plain folder: **a workspace can own a
worktree**. When it does, it holds a repo, a branch, a worktree directory, and
any attached repos, and new chats created in it inherit that worktree by
default. So a workspace is usually "this branch, and every conversation I had
while building it": the first chat that made the change, the follow-up that
fixed review comments, the one that debugged CI. They share a checkout and add
up to one pull request.

A workspace with no worktree is fine too — that is what an ask-style workspace
or a freshly created one looks like before any code session materializes it.

Workspaces can also be created *for* you, keyed to something external: a pull
request, a support ticket, a video. That linkage is a generic `externalRefs`
entry, which is how feed items (below) resolve to a stable workspace instead of
spawning a new one every time.

## Sessions

A session — a **chat**, when you are talking about it inside its workspace — is
one conversation with an agent. It has a transcript, a model, a working
directory, a queue of pending prompts, and a state you can see from the sidebar
(running, waiting on you, idle).

Sessions are the unit everything else produces. An automation run is a session.
A goal wake is a session. An action run is a session. That is deliberate:
whatever started it, you can open it, read the whole transcript, steer it
mid-flight, and fork it into a normal conversation.

### Modes

A session's mode decides what it can touch:

- **`ask`** — read-only. No worktree of its own; it shares a per-repo checkout
  pinned to the default branch. Cannot write files. Use it for questions,
  investigation, and code reading.
- **`code`** — its own worktree on its own branch, with write tools. It can
  commit and open a pull request. This is the default, and the one that costs
  disk.
- **`scratch`** — no repo at all, just a working directory. Used by chats about
  external items (a video, a ticket) where there is nothing to check out.

### Multi-repo sessions

A session has one primary repo, and can **attach** more. Each attached repo
gets its own isolated worktree, branched to match the session's primary branch,
so a change spanning two repos lines up and produces two pull requests that
match. Diffs, file mentions, and the PR panel all become repo-aware once a
session spans more than one.

### Turns, queues and steering

You prompt; the agent takes a turn. While a turn is running, anything you send
is either delivered as a steer or queued behind it and delivered as the next
turn — nothing is dropped. Sessions can also ask *you* something mid-turn and
park until answered, which is what puts them in the "needs input" lane.

Sessions can spawn other sessions. An orchestrator session delegates focused
work to worker sessions (their own context, possibly a different model), reads
their reports, and keeps the final call. Spawn depth is capped so this cannot
run away.

## Where a session runs

**Worktrees** are the default. Every code session gets its own git worktree —
a separate working directory sharing one `.git` — so two sessions on the same
repo never see each other's edits and never fight over the index. Creating one
installs dependencies up front so the agent does not spend its first two
minutes on `bun install`. This is also where your disk goes:
[docs/worktrees.md](docs/worktrees.md).

**Sandboxes** are optional isolation. Instead of running on the host, a session
can run inside a container — Docker locally, with adapters for hosted
providers. Use them when you do not want agent-run commands touching the host
at all: [docs/self-hosting-sandboxes.md](docs/self-hosting-sandboxes.md).

**Nodes** are other machines you attach with `opensession connect`. They exist
for work that physically cannot happen on the server: an iOS build needs macOS
with Xcode, a Windows build needs MSVC. A session on the server reaches out to
a node to run commands there. See [docs/nodes.md](docs/nodes.md).

## Automations

An automation is a prompt plus a trigger. When it fires, it creates a **fresh
session** and runs the prompt in it.

The trigger is a cron schedule, a one-off time, or an external event: a message
in a watched Slack channel, an incoming support ticket, a failure signal from
your logs. The run shows up in the session list like any other, with its full
transcript.

The defining property is that automations are **amnesiac**. Every run starts
clean. That is what makes them safe to point at untrusted input — a support
ticket's text is data the agent reads, never configuration for the run — and it
is why they are scoped tightly:

- each automation names the MCP servers its runs may see, and gets only those;
- runs get a minimal environment with none of your tokens;
- customer-facing and identity-mutating tools are denied outright;
- `mode` applies here too — an `ask` automation cannot write; a `code`
  automation gets a worktree and can open a pull request, never merge one.

Automations are data, not code: create one from the UI or by talking to the
agent. Reusable ones can be packaged as **recipes** — a JSON file in
`recipes/automations/` installable with `opensession automations add <id>`.

## Goals

A goal is the opposite trade from an automation: **one session, pursued over
days or weeks**.

Where an automation fires a fresh amnesiac session on a tick, a goal drives a
single session that is resumed on every wake — so context carries, and the
agent remembers what it already tried. It paces itself (each wake schedules its
own next one, with a floor so a buggy run cannot hot-loop), pauses for human
sign-off when it needs a decision, and stops when its success condition is met.

The mission is just a prompt. Goals are for open-ended, long-horizon work —
"get this metric under X", "keep this migration moving" — where the value is in
continuity rather than in a clean slate.

A goal has a mode like a session: `ask` for research and measurement, `code`
for a persistent worktree it can keep opening pull requests from.

## Actions

An action is a form in front of a script. You register a script that already
lives in a repo, describe its inputs as form fields, and anyone can run it
without a terminal.

A run is not a bespoke output panel — it spins up a real session on a fast,
cheap model that executes the command and reports the output. So it lands in
the session list with a transcript, and if the output is surprising you fork it
into a full session and dig in.

## Workflows

A workflow is a model-authored script that fans out agent runs deterministically
— `agent()`, `parallel()`, `pipeline()`, `phase()` — and executes in a
contained worker.

The point is control flow that should not be model-driven: loops, conditionals,
verify-every-finding fan-outs. A workflow agent is a focused read-analyze-report
worker; heavier, steerable work stays on a spawned session. Limits (concurrent
agents, lifetime agent count, per-agent timeout) are enforced by the runner.

## Projects (feeds)

A **project** is an external source of things to work on, rendered as its own
band in the sidebar: your videos, your tickets, your issues. It is defined as
data — which connected MCP server backs it, which tool lists its items, how
that tool's fields map onto title/preview/timestamp — so adding one is
configuration, not code.

Picking an item opens the **workspace** for it, creating one on first touch and
reusing it forever after. So a project is a doorway into the same core model:
items are just workspaces you did not have to name.

> **Naming note.** "Project" was the old name for what is now a *workspace*, and
> the HTTP surface still says `/api/projects` for compatibility with running
> clients. In the UI and in this document, project means the feed sense above.

## Integrations

An integration connects an external system: Slack, Linear, Plain, GitHub,
Stripe. Each owns its webhook routes and a background loop, and each is off
until you enable it.

Integrations are how work reaches the server without the UI. A Slack thread
becomes a session you can reply into from Slack; a pull request review becomes
a session that fixes the comments; a support ticket triggers a triage
automation. The session is always the same object underneath — you can open any
of them in the web UI mid-flight.

## Tools: MCP servers and skills

**MCP servers** are how sessions get capability beyond files and shell. Any
Model Context Protocol server you add becomes tools your agents can call. Two
properties matter for the model above:

- servers carry **their own credentials** — agent subprocesses get a minimal
  environment without your tokens;
- a server can be scoped to specific people (`allowedUsers`), and automation
  runs pass no user at all, so a restricted server is invisible to them.
  Fail-closed by design.

**Skills** are prompt-level extensions — a directory with a `SKILL.md` that the
engine loads on demand, invocable as a `/`-command in the composer. They come
from your user config, from the repo's own checkout, or from the engine itself.

See [docs/extending.md](docs/extending.md) for both, plus integrations and
providers.

## Putting it together

A typical loop, in the vocabulary above:

1. You register **repo** `myapp` once.
2. You start a **session** on it in `code` mode. That creates a **workspace**
   and cuts a **worktree** on a new branch.
3. The agent takes **turns** — reading, editing, running the test suite in the
   worktree, opening a pull request.
4. Review comments arrive. The GitHub **integration** opens another **session**
   in the same workspace, on the same worktree, and it pushes fixes.
5. Meanwhile a nightly **automation** runs a fresh, amnesiac session that sweeps
   for a class of problem across the repo and files what it finds.
6. And a **goal** you set two weeks ago wakes itself every morning, remembers
   everything it has already tried, and moves one long migration forward.

## Where to go next

- [docs/worktrees.md](docs/worktrees.md) — how sessions map to git worktrees,
  and where the disk goes
- [docs/repo-lifecycle.md](docs/repo-lifecycle.md) — the `.opensession/`
  scripts a repo commits so its worktrees provision and boot themselves
- [docs/instance-configuration.md](docs/instance-configuration.md) — repos,
  identity, branding, integrations, seeds
- [docs/extending.md](docs/extending.md) — MCP servers, recipes, integrations,
  providers
- [docs/nodes.md](docs/nodes.md) — attaching another machine
- [docs/self-hosting-sandboxes.md](docs/self-hosting-sandboxes.md) — isolated
  execution
- [docs/setup/](docs/setup/README.md) — installing, and the trust model
