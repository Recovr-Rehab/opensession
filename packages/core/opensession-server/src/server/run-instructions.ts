// Engine-neutral run instructions — the policy/context text EVERY engine
// delivers with a session run, whatever the transport: the pi runner
// appends it via an instructions file (Pi's system-prompt append
// channel), the pi runner via systemPromptOverride. Run-policy text that
// every engine must carry belongs here, not in an engine-specific prompt.
//
// Extracted from pi-runner.ts (where it was born as
// buildPiInstructions) once the pi engine started sharing it.

import { realpathSync } from "fs";
import { join } from "path";
import { configuredServer, githubBotLogins, personaName, productName } from "./config";
import { renderInternalMcpCapabilities } from "./mcp-capabilities";
import { githubLoginFor, type GitIdentity } from "./shared/user-mappings";

const UI_BASE =
  process.env.OPENSESSION_UI_BASE ||
  configuredServer().publicBaseUrl;

/** Private-key-backed PR-checks reader (see the GitHub checks section below
 *  and the ask-mode bash allowlist in pi-runner.ts). */
export const GH_CHECKS_CLI_PATH = join(import.meta.dir, "..", "..", "..", "..", "..", "scripts", "gh-checks.ts");

/** Session context: ask guardrails, repos note, capability notes (UI mermaid
 *  rendering), managing-the-agent notes, and instance-local additions,
 *  joined into one system-prompt append. */
export function buildRunInstructions(input: {
  isAsk: boolean;
  /** Repo-less scratch session (feed-item workspaces — the feeds design). */
  isScratch?: boolean;
  /** No repo behind this run's cwd: a scratch dir, or a repo-less ask
   *  session. Decides which Ask-mode briefing the run gets. */
  isRepoLess?: boolean;
  reposNote?: string;
  /** Reviewer to request on PRs this run opens (GitHub login, `org/team`
   *  slug, or comma-separated list) — see RunAgentOpts.prReviewer. */
  prReviewer?: string;
  /** The session's real working directory — set ONLY for shared-pool runs,
   *  where pi's own environment block reports the pool server's neutral
   *  cwd (SHARED_CWD, "Is a git repository: false") rather than the session's
   *  `?directory=`. Without this correction models hedge against the wrong cwd
   *  and prefix every bash call with a redundant `cd <worktree> &&`. */
  cwd?: string;
  /** Session-scoped scratch dir (session-scratch.ts) — named in the run so
   *  temporary files land in a directory whose lifecycle follows the session
   *  instead of accumulating in shared /tmp. */
  scratchDir?: string;
  inProcessMcp?: Record<string, unknown>;
  osSessionId?: string;
  /** Requester attribution for PRs: the turn's raw user label and the resolved
   *  git identity (same table as commit attribution). PRs open under the bot
   *  GitHub account, so the body line + assignee are how the human shows up. */
  user?: string;
  author?: GitIdentity | null;
  /** Backing git host of the session's primary repo; undefined = GitHub.
   *  "codestorage" swaps the PR-flow instructions for push-the-branch ones
   *  (code.storage has no PRs — a pushed branch is the change request). */
  repoHost?: "github" | "codestorage";
  /** Set when this run carries the owner's own GitHub token (github-auth.ts):
   *  PRs are authored by them directly, so skip the bot-attribution assignee. */
  githubUserLogin?: string | null;
  /** This run's bash commands are screened by the org-floor command policy
   *  (command-policy.ts) — tell the agent so a refusal reads as policy, not
   *  as a broken tool. */
  commandPolicyGated?: boolean;
  /** Untracked instance-local instructions (readLocalInstructions) — appended
   *  verbatim so operator-private guidance never has to live in the tracked
   *  AGENTS.md. */
  localInstructions?: string;
  /** The Dial: tells a dial-preset run about its oracle subagent. Only set for
   *  dial runs — other sessions never learn the oracle agents exist. */
  dialOracle?: {
    agent: string;
    presetLabel: string;
    mainLabel: string;
    oracleLabel: string;
    /** Pi exposes the advisor as a custom tool rather than an Pi task agent. */
    tool?: boolean;
  };
  /** The Orchestrator: tells an orchestrator-preset run about its worker
   *  subagents. Only set for orchestrator runs — mirrors dialOracle. */
  orchestrator?: {
    presetLabel: string;
    mainLabel: string;
    workers: Array<{ agent: string; label: string; modelLabel: string }>;
    /** Pi delegates through the sessions MCP instead of Pi task agents. */
    tool?: "task" | "sessions";
  };
}): string {
  const parts: string[] = [];
  parts.push(
    "## Data handling\nNever upload files or data to public file-sharing hosts. Use only " +
      "organization-controlled channels; if none work, report the failure."
  );
  parts.push(
    "## GitHub checks\nRead PR checks with " +
      `\`bun ${GH_CHECKS_CLI_PATH} <pr-number> --repo <owner/repo>\`; the regular GitHub ` +
      "token cannot access the Checks API."
  );
  // Observed 2026-07-10 (bks-019f4b70): twice in one session the model ended
  // its turn on a plan sentence ("I'll rebase X, then …") with zero tool
  // calls, both times on the first turn after a mid-run interrupt — the user
  // had to reply "WHY DID YOU STOP" to resume. Engine + runner were healthy
  // (clean end_turn); this is a model-side announce-then-stop, so we push
  // back at the instruction layer.
  parts.push(
    "## Finish your turns\nComplete promised actions before ending. After the final tool " +
      "call, briefly report the outcome and relevant links."
  );
  // Unconditional: a detached child that inherits the bash tool's
  // stdout/stderr pipe keeps the call's output stream open after the shell
  // exits, so the tool call never resolves — os-019fd67b (2026-08-06) hung
  // 2h52m on `setsid -f google-chrome` until the turn deadline. The stall
  // guard now cuts such turns off, but the redirect avoids the hang entirely.
  parts.push(
    "## Background processes\nDetach background process stdio to the session scratch " +
      "directory so shell calls can finish."
  );
  parts.push(
    "## Browser processes\nUse repository browser tooling or a bounded foreground wrapper " +
      "that always stops the browser. Never reuse another session's browser profile or port."
  );
  // Session-scoped scratch (session-scratch.ts): the path is per-session and
  // deleted with the session, so temp files stop accumulating in shared /tmp.
  if (input.scratchDir) {
    parts.push(
      `## Session scratch directory\nPut temporary files in \`${input.scratchDir}\`. ` +
        "It is deleted with the session; keep durable work in assets, the worktree, or a PR."
    );
  }
  // Capability note, not a mandate: the UI renders ```mermaid fences as
  // diagrams (MarkdownBody.tsx), but a model that doesn't know that will
  // never emit one — and one told too forcefully draws flowcharts for
  // everything.
  parts.push(
    "## Session UI\nUse GitHub-flavored Markdown. Mermaid fences render as diagrams. " +
      "Write PRs as `repo#123`, and never shorten session IDs or URLs."
  );
  // Shared-pool runs only: pi builds its environment block from the
  // server process cwd, which for a pool member is the neutral SHARED_CWD —
  // so the model is told it sits in a non-repo scratch dir while bash actually
  // runs in the session's `?directory=`. Left uncorrected it defends against
  // the phantom cwd by prefixing `cd <worktree> &&` onto every single command.
  if (input.cwd) {
    // Canonicalized for the TEXT only — the run's `?directory=` keeps the
    // stored string, which engine-session identity is keyed on (worktree.ts's
    // canonicalPath carries the same warning). A session persisted before a
    // checkout rename stores the pre-rename path, and naming it here makes the
    // model narrate `cd …/<old-checkout-name> &&` back in every command — while
    // `pwd` reports the post-rename path, since getcwd() resolves symlinks.
    // Importing canonicalPath here would cycle back through worktree/preview,
    // so this is the same two lines locally.
    let cwd = input.cwd;
    try {
      cwd = realpathSync(cwd);
    } catch {}
    parts.push(
      `## Working directory\nYour Bash tool, file tools, and relative paths all run in ` +
        `\`${cwd}\` — you are already there.\n` +
        `The engine's own environment block reports a different "primary working directory" ` +
        `(a neutral scratch path ending in \`/shared-cwd\`, "Is a git repository: false"): ` +
        `that is the shared engine server's cwd, not this session's, and it does not apply ` +
        `to your tool calls. Trust this line instead — run \`pwd\` if you want to confirm. ` +
        `Don't prefix commands with \`cd ${cwd} &&\`; it's redundant noise on every ` +
        `call. Only \`cd\` when you genuinely need a different directory (another repo's ` +
        `worktree, a subdirectory a tool requires).`
    );
  }
  if (input.isScratch) {
    parts.push(
      `You are ${personaName()} in Scratch mode: your working directory is a plain ` +
        "scratch space, NOT a git repository or code checkout. There is no repo, branch, " +
        "or PR flow here — never try to commit, push, or open PRs from this directory. " +
        "You CAN write files, download media, and run shell tools (ffmpeg, curl, etc.) " +
        "freely in this directory, and you should lean on the available MCP tools when " +
        "the task concerns the external object this workspace is linked to: fetch its " +
        "details through those tools rather than guessing."
    );
  }
  if (input.isAsk && input.isRepoLess) {
    parts.push(
      `You are ${personaName()} in Ask mode with no repository: there is no checkout to ` +
        "read, and your working directory is an empty scratch dir, NOT a code repo. Do not " +
        "go looking for one, and never assume a repo the user has not named. This is " +
        "READ-ONLY: never write files, commit, or run state-changing shell commands (the " +
        "permission config enforces this). Answer from what the user tells you and from " +
        "your MCP tools, which are the point of this mode — use them according to their " +
        "descriptions. Session assets are the one place you can leave something behind: " +
        "write a report, diagram, or visualization there when it beats prose. If the task " +
        "turns out to need a repo, say so and suggest opening a session on it."
    );
  } else if (input.isAsk) {
    parts.push(
      `You are ${personaName()} in Ask mode: answer questions about the current checkout. ` +
        "This is READ-ONLY with respect to the checkout and shell: never modify, create, or " +
        "delete repository files, never commit, and never run state-changing shell commands " +
        "(the permission config enforces this). This does not prohibit intentional changes " +
        "through available product-scoped MCP tools such as todos, session " +
        "assets, or messages; use those tools according to their descriptions when the user " +
        "asks. Explore the checkout with read-only shell and git commands, then answer clearly " +
        "and concisely."
    );
  }
  // Amp-style oracle guidance (decision rules with triggers AND anti-triggers,
  // per Amp's leaked prompts): the oracle only pays off if the main model
  // knows when to reach for it — and when not to.
  if (input.dialOracle) {
    const d = input.dialOracle;
    const availability = d.tool
      ? `available as the \`${d.agent}\` tool`
      : `available as the \`${d.agent}\` subagent via the task tool`;
    parts.push(
      `## The Dial — your oracle\nThis session runs on the "${d.presetLabel}" preset: you ` +
        `(${d.mainLabel}) are paired with an oracle — ${d.oracleLabel}, ${availability}. ` +
        "The oracle is a senior engineering " +
        "advisor to think with, not an executor.\n" +
        "Consult it when planning a hard or open-ended task, to review your own significant " +
        "work after implementing it, for architecture decisions with real tradeoffs, and to " +
        "debug problems that resist your first attempts. Don't use it for file searches, " +
        "routine edits, or anything you can settle by reading the code yourself.\n" +
        "Prompt it with a precise problem description and the relevant file paths and " +
        "constraints — it sees the same checkout but none of your conversation. Its output " +
        "is advisory: weigh it, then decide. Briefly tell the user when you consult the " +
        'oracle and why ("Consulting the oracle on the migration plan").'
    );
  }
  // The Dial reversed (Cursor's agent-swarm economics): the frontier main
  // model leads and delegates execution down to cheap workers. Same
  // decision-rule style as the oracle block — triggers AND anti-triggers —
  // because delegation only pays off when the model knows what NOT to hand off.
  if (input.orchestrator) {
    const o = input.orchestrator;
    const workerLines = o.workers
      .map((w) => `- \`${w.agent}\` (${w.modelLabel}): ${w.label.toLowerCase()} for delegated subtasks.`)
      .join("\n");
    const delegation =
      o.tool === "sessions"
        ? "through the opensession-sessions spawn_task MCP tool"
        : "via the task tool";
    parts.push(
      `## The Orchestrator — your workers\nThis session runs on the "${o.presetLabel}" preset: ` +
      `you (${o.mainLabel}) are the lead, paired with worker subagents you delegate ` +
        `execution to ${delegation}:\n` +
        `${workerLines}\n` +
        "You do the thinking, workers do the typing. Keep for yourself: understanding the " +
        "problem, design decisions, anything with real tradeoffs, tricky debugging, and the " +
        "final review and integration of everything workers produce. Delegate: well-scoped " +
        "implementation subtasks (a function, a module, a migration step, a test file), broad " +
        "mechanical sweeps, and independent pieces that can run in parallel. Don't delegate " +
        "work whose spec you can't state crisply — if describing the subtask takes longer " +
        "than doing it, do it yourself.\n" +
        "Brief workers self-contained: exact files, constraints, acceptance criteria, and " +
        "what to report back — they see the same checkout but none of your conversation. " +
        "Verify their output (read the diff, run the tests) before building on it, and take " +
        "a subtask over yourself when a worker misses the bar twice. Briefly tell the user " +
        'when you fan work out ("Delegating the migration + tests to workers").'
    );
  }
  const inprocEarly = (input.inProcessMcp || {}) as Record<string, unknown>;
  const internalMcpCapabilities = renderInternalMcpCapabilities(inprocEarly, productName());
  if (internalMcpCapabilities) parts.push(internalMcpCapabilities);
  if (inprocEarly["opensession-assets"]) {
    parts.push(
      "## Session assets\nUse opensession-assets for uncommitted reports, diagrams, or " +
        "demos that belong in the Assets tab. Mention saved paths in your final response."
    );
  }
  if (input.reposNote) parts.push(input.reposNote);
  if (!input.isAsk && !input.isScratch && input.osSessionId && input.repoHost === "codestorage") {
    parts.push(
      "## Shipping changes on Code Storage\nThis session's repo is hosted on Code Storage, " +
        "not GitHub: there is no gh CLI and no pull requests — a pushed branch IS the change " +
        "request. Commit and push your branch with `git push -u origin <branch>`; reviewers " +
        "see the branch's diff against the default branch in the session's Changes tab and " +
        "merge it from there. Never merge your branch into the default branch yourself, and " +
        "never try `gh pr create` — it has nothing to talk to here."
    );
  } else if (!input.isAsk && !input.isScratch && input.osSessionId) {
    const link = `${UI_BASE}/session/${input.osSessionId}`;
    const requester = input.author?.name || null;
    const login = githubLoginFor(input.user || input.author?.name);
    const footer = requester
      ? `Started by ${requester} in [this ${personaName()} session](${link})`
      : `Created by [this ${personaName()} session](${link})`;
    parts.push(
      "## PR attribution\nEnd each PR body with:\n\n" +
        `${footer}\n` +
        (input.githubUserLogin
          ? `PRs use @${input.githubUserLogin}'s account; do not add an assignee.`
          : requester && login
            ? `When possible, assign @${login}.`
            : "")
    );
    if (input.prReviewer) {
      parts.push(
        `## PR reviewer\nRequest \`${input.prReviewer}\` on every PR. If that fails, ` +
          "mention it in the final response."
      );
    }
    const botLogin = githubBotLogins()[0];
    const attachTokenNote = botLogin
      ? `Set \`TOKEN=$(gh auth token --user ${botLogin})\`; GitHub App user tokens fail here.`
      : "Set `TOKEN=$(gh auth token)` using a PAT that can read the repo.";
    parts.push(
      "## PR media\nFor inline PR media, upload a GitHub user attachment with this " +
        "repository-scoped request, then use the returned URL:\n\n" +
        "```sh\n" +
        'curl -fsS "https://uploads.github.com/user-attachments/assets?name=<file>&content_type=<mime>&repository_id=$(gh api repos/<owner>/<repo> --jq .id)" -X POST -H "Authorization: Bearer $TOKEN" -H "Accept: application/json" --data-binary "@<file>"\n' +
        "```\n" +
        attachTokenNote
    );
  }
  const inproc = (input.inProcessMcp || {}) as Record<string, unknown>;
  // Gated on the sessions server specifically (not any in-process server):
  // automation runs now carry opensession-papercuts alone and must not be told
  // they have session-control tools they don't.
  if (inproc["opensession-sessions"] || inproc["michael-sessions"]) {
    parts.push(
      `## Managing ${personaName()}\nUse opensession-sessions to create or steer visible ` +
        `${productName()} sessions. A request for a new session means \`create_session\`, not ` +
        "an in-process worker. Use `wait_for` instead of polling for checks or time."
    );
  }
  // Dynamic workflows (workflow-runner.ts). The runtime has been wired into
  // every interactive run since the first release, but nothing ever told the
  // model it existed: discovery was one tool description competing with a
  // hundred others, which is why the feature stayed rare. This block is the
  // WHEN; the run_workflow tool description is the HOW.
  if (inproc["opensession-workflows"]) {
    parts.push(
      "## Dynamic workflows\nUse opensession-workflows for the same operation across many " +
        "independent items. Skip it for one-off or conversational work."
    );
  }
  // Legacy michael-ask key: journaled runner-host runs resumed across the
  // opensession-* rename carry prebuilt proxy specs under the old id.
  if (inproc["opensession-ask"] || inproc["michael-ask"]) {
    parts.push(
      "## Asking the human\nUse opensession-ask only for a blocking decision. Offer 2-4 " +
        "concrete options."
    );
  }
  if (!input.isAsk && inproc["opensession-walkthrough"]) {
    parts.push(
      "## Walkthroughs\nPublish visual proof for user-visible changes: screenshots for a " +
        "static change, or a short recording for an interaction. Check desktop and phone for " +
        "web UI, use native resolution, and include a brief explanation."
    );
  }
  parts.push(
    "## Showing media\nShow selected results inline with `OPENSESSION_IMAGE: /abs/path.png` " +
      "or `OPENSESSION_VIDEO: /abs/path.mp4`. Do not expose every intermediate capture."
  );
  if (inproc["opensession-turn"]) {
    parts.push(
      "## Silent endings\nFor an unattended run with nothing to report, call `finish_silently`."
    );
  }
  if (inproc["opensession-report"]) {
    parts.push(
      "## Reports\nPublish a recurring readable result with opensession-report."
    );
  }
  if (inproc["opensession-papercuts"]) {
    parts.push(
      "## Papercuts\nLog environment or tooling friction with opensession-papercuts, not " +
        "ordinary task difficulty or planned work."
    );
  }
  if (input.commandPolicyGated) {
    parts.push(
      "## Command policy\nUnattended runs block destructive shell commands. Report a " +
        "blocked command and its purpose instead of bypassing the policy."
    );
  }
  // Instance-local operator instructions last: they're the deployment's own
  // additions and may refine anything above.
  if (input.localInstructions?.trim()) parts.push(input.localInstructions.trim());
  return parts.join("\n\n");
}
