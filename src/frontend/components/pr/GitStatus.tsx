import type React from "react";
import { useIsPhone } from "../../hooks/useIsPhone";
import { AGENT_NAME } from "../../lib/brand";
import {
  type GitDotTone,
  type GitTask,
  gitTasks,
  useGitTaskRunner,
} from "../../lib/pr-git-tasks";
import { deriveStatus } from "../../lib/pr-status-derive";
import {
  GIT_ACTION,
  GIT_DOT,
  GIT_DOT_BG,
  GIT_LABEL,
  GIT_NOTE,
  GIT_ROW,
} from "../../lib/pr-tone-classes";
import type { GitStatusInfo, PrDetails } from "../../lib/types";
import { Button } from "../../ui/button";

/**
 * Branch divergence for the review canvas: only the work that needs doing,
 * with each action sitting next to the sentence that explains it.
 *
 * The canvas used to carry a full "Git status" card here, which restated the
 * PR verdict and its Merge button a third time on one screen — the session
 * header's PrStatusBar carries the verdict plus the primary action whether the
 * workspace panel is open or closed, and the panel's own Git status section
 * says it again. What the canvas can usefully add is the local/remote
 * divergence, so that is all it shows, and only while something is outstanding.
 *
 * Phone is the exception: the session header drops the PR status bar at that
 * width, so the verdict and Merge would have nowhere else to live and the
 * strip takes them back.
 */
export function GitDivergenceStrip({
  git,
  pr,
  sessionId,
  repo,
  send,
  onRefresh,
  onMerge,
  merging,
  confirmMerge,
}: {
  git: GitStatusInfo | null;
  pr: PrDetails | null;
  sessionId: string;
  repo?: string;
  send?: (msg: any) => void;
  onRefresh: () => Promise<void> | void;
  onMerge?: () => void;
  merging?: boolean;
  confirmMerge?: boolean;
}) {
  const runner = useGitTaskRunner({ sessionId, repo, send, onRefresh });
  const isPhone = useIsPhone();
  const base = pr?.baseRefName || git?.baseBranch || "main";
  const tasks = gitTasks(git, pr, base).filter(runner.runnable);
  const verdict =
    isPhone && pr && pr.state === "OPEN" && !pr.isDraft && onMerge
      ? deriveStatus(pr)
      : null;
  if (!verdict && tasks.length === 0 && !runner.prompted && !runner.error)
    return null;

  return (
    <section className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 px-6 pb-4 max-[720px]:px-3">
      {verdict && (
        <span className="inline-flex items-center gap-2 text-xs text-dim">
          <span className={`${GIT_DOT} ${GIT_DOT_BG[verdict.tone]}`} aria-hidden />
          {verdict.qualifier || verdict.label}
          <Button
            size="xs"
            onClick={onMerge}
            disabled={merging}
            title="Squash and merge this pull request"
          >
            {merging ? "Merging…" : confirmMerge ? "Confirm merge" : "Merge"}
          </Button>
        </span>
      )}
      {tasks.map((task) => (
        <span key={task.key} className="inline-flex items-center gap-2 text-xs text-dim">
          <span className={`${GIT_DOT} ${GIT_DOT_BG[task.tone]}`} aria-hidden />
          {task.label}
          <Button
            size="xs"
            onClick={() => runner.run(task)}
            disabled={task.run === "push" && runner.pushing}
          >
            {task.run === "push" && runner.pushing ? "Pushing…" : task.action}
          </Button>
        </span>
      ))}
      {runner.prompted && (
        <span className="text-xs text-faint">Asked {AGENT_NAME} to {runner.prompted} ✓</span>
      )}
      {runner.error && <span className="text-xs text-red">{runner.error}</span>}
    </section>
  );
}

/**
 * Local/remote discrepancy rows for the Status card: each gets a line with one
 * action on the right. Push is a direct server-side `git push`; the judgment
 * calls (create the PR, resolve conflicts, update from base, commit stray
 * changes) prompt the session — the agent does the work, not a bare button.
 */
export function GitStatusRows({
  git,
  pr,
  sessionId,
  repo,
  send,
  onRefresh,
  onMerge,
  merging,
  confirmMerge,
}: {
  git: GitStatusInfo | null;
  pr: PrDetails | null;
  sessionId: string;
  repo?: string;
  send?: (msg: any) => void;
  onRefresh: () => Promise<void> | void;
  onMerge?: () => void;
  merging?: boolean;
  confirmMerge?: boolean;
}) {
  const runner = useGitTaskRunner({ sessionId, repo, send, onRefresh });
  const { prompted, error } = runner;

  const base = pr?.baseRefName || git?.baseBranch || "main";
  const tasks = gitTasks(git, pr, base);
  const task = (key: GitTask["key"]) => tasks.find((t) => t.key === key);

  const rows: Array<{
    key: string;
    label: string;
    tone: GitDotTone;
    action?: React.ReactNode;
  }> = [];

  if (pr) {
    const status = deriveStatus(pr);
    const conflicts = task("conflicts");
    const resolveAction =
      conflicts && runner.runnable(conflicts) ? (
        <button className={GIT_ACTION} onClick={() => runner.run(conflicts)}>
          {conflicts.action}
        </button>
      ) : undefined;
    rows.push({
      key: "pr-status",
      label: status.qualifier || status.label,
      tone: status.tone,
      action:
        resolveAction ||
        (pr.state === "OPEN" && !pr.isDraft && onMerge ? (
          <button
            className={GIT_ACTION}
            onClick={onMerge}
            disabled={merging}
            title="Squash and merge this pull request"
          >
            {merging ? "Merging…" : confirmMerge ? "Confirm merge" : "Merge"}
          </button>
        ) : undefined),
    });
  }

  // Base-sync (rebase) status — lead with it so the panel answers "am I behind
  // main?" at a glance. Shown for any real feature branch (not the base branch
  // itself, not a merged PR): a reassuring green "up to date" when in sync, and
  // a prominent yellow "N behind" with a one-click Update (rebase) when not.
  if (git && git.branch && git.branch !== base && pr?.state !== "MERGED") {
    const behind = task("behind");
    rows.push({
      key: "base-sync",
      label: behind ? behind.label : `Up to date with ${base}`,
      tone: behind ? behind.tone : "green",
      action:
        behind && runner.runnable(behind) ? (
          <button className={GIT_ACTION} onClick={() => runner.run(behind)}>
            {behind.action}
          </button>
        ) : undefined,
    });
  }

  if (!pr) {
    rows.push({
      key: "no-pr",
      label: "No pull request",
      tone: "muted",
      action: send && (
        <button
          className={GIT_ACTION}
          onClick={() =>
            runner.promptSession(
              "create a PR",
              "Commit any remaining work, push the branch, and open a PR for it.",
            )
          }
        >
          Create PR
        </button>
      ),
    });
  }
  for (const key of ["ahead", "dirty"] as const) {
    const t = task(key);
    if (!t || !runner.runnable(t)) continue;
    rows.push({
      key,
      label: t.label,
      tone: t.tone,
      action: (
        <button
          className={GIT_ACTION}
          onClick={() => runner.run(t)}
          disabled={t.run === "push" && runner.pushing}
        >
          {t.run === "push" && runner.pushing ? "Pushing…" : t.action}
        </button>
      ),
    });
  }
  if (rows.length === 0) return null;

  return (
    <>
      {rows.map((row) => (
        <div
          key={row.key}
          className={GIT_ROW}
        >
          <span className={`${GIT_DOT} ${GIT_DOT_BG[row.tone]}`} aria-hidden />
          <span className={GIT_LABEL}>{row.label}</span>
          {row.action}
        </div>
      ))}
      {prompted && <div className={`${GIT_NOTE} text-faint`}>Asked {AGENT_NAME} to {prompted} ✓</div>}
      {error && <div className={`${GIT_NOTE} text-red`}>{error}</div>}
    </>
  );
}
