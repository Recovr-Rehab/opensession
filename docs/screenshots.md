# Screenshots

All shot from a demo instance (`OPENSESSION_DEV=1 OPENSESSION_DEMO=1`), so
everything in frame is synthetic: fictional teammates, a fictional `acme-todo`
repo, a fictional PR #128.

## A session, mid-run

The transcript streams as the agent works — plan, tool calls, a command that
failed, and the recovery. The composer queues your next prompt behind the
running turn.

![](screenshots/session-running.png)

## When the agent needs you

A question pauses the run and surfaces as a card: pick an option or write your
own answer, and the turn continues.

![](screenshots/session-needs-input.png)

## The work it produced

Every session carries its branch, its git status and its PR — merge state,
checks and changed files, without leaving the session.

![](screenshots/session-pr.png)

## Changes

The working-tree diff next to the transcript that produced it.

![](screenshots/session-changes.png)

## Reviewing the pull request

The full review surface: conversation, commits, checks and a split-view diff,
with line comments batched into one review.

![](screenshots/pr-review.png)

## Home

Open pull requests across your repos, with the workspace sidebar's lanes —
needs input, in progress, ready to merge, backlog.

![](screenshots/home.png)

## Starting work

Pick a repo, a branch mode, a model and an effort level, then describe the job.

![](screenshots/new-session.png)

## Automations

Scheduled and webhook-triggered agent runs, each with its own history.

![](screenshots/automations.png)

## Notes and docs

Collaborative notes alongside a read-only view of the repo's docs.

![](screenshots/notes.png)

## On a phone

The same UI, installed as a PWA — read a running session and steer it from
anywhere.

<img src="screenshots/mobile.png" width="320" alt="">
