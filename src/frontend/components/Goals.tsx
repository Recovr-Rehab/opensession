import { repoLabel } from "../lib/repo-label";
import { BASE_PATH } from "../lib/base";
import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  fetchGoals,
  fetchGoal,
  createGoalApi,
  updateGoalApi,
  deleteGoalApi,
  runGoalApi,
  resumeGoalApi,
  pauseGoalApi,
  fetchModels,
  fetchRepos,
  relativeTime,
  type ModelOption,
  type RepoInfo,
} from "../lib/api";
import { getCurrentUser } from "./UserPicker";
import { docTitle, DEFAULT_DOC_TITLE } from "../lib/brand";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { SOURCE_CHIP } from "../lib/source-chip-classes";
import { Input, Select, Textarea } from "../ui/input";
import { PageDescription, PageHeader, PageTitle } from "../ui/page-header";
import { EmptyState, InlineAlert, LoadingState } from "../ui/state";
import { WorkingPill } from "../ui/status";

/* The old .automation-form family, as utilities (see Automations.tsx — this
   page shares its list/drawer/form shapes). The descendant variants keep the
   two rules that reached in from the form to its fields: 16px on phones, so
   iOS doesn't zoom a focused field, and paragraph leading in a textarea. */
const FORM_FIELDS =
  "[&_textarea]:leading-normal phone:[&_input]:text-[16px] phone:[&_select]:text-[16px] phone:[&_textarea]:text-[16px]";
/** .automation-form.automation-form-inline — the drawer body is the surface. */
const FORM_INLINE = `flex flex-col gap-3.5 ${FORM_FIELDS}`;
/** .automation-form */
const FORM_CARD = `${FORM_INLINE} mb-4.5 rounded-panel border border-line-strong bg-panel p-4.5`;
/** .automation-form label */
const FIELD_LABEL = "flex flex-1 flex-col gap-1.5 text-label font-medium text-dim";
/** .automation-form-title */
const FORM_TITLE = "text-body font-semibold";
/** .automation-form-actions */
const FORM_ACTIONS = "flex justify-end gap-2.5";
/** .automation-form-row */
const FORM_ROW = "flex gap-3.5 phone:flex-col";
/** .automations-drawer-section-label */
const SECTION_LABEL = "mb-1.5 text-label font-semibold text-faint";
/** .automation-session-link */
const LINK = "cursor-pointer text-link no-underline hover:underline";

type GoalStatus = "active" | "paused" | "done" | "failed";

interface Goal {
  id: string;
  name: string;
  mission: string;
  status: GoalStatus;
  mode: "ask" | "code";
  repo?: string;
  bksSessionId?: string;
  nextWakeAt: string;
  minWakeMinutes: number;
  maxWakes?: number;
  wakeCount: number;
  lastRunAt?: string;
  lastRunStatus?: "running" | "ok" | "error";
  lastRunError?: string;
  phase?: string;
  pauseReason?: string;
  doneReason?: string;
  model?: string;
  fallbackModel?: string;
  mcpServers?: string[];
  createdBy: string;
  isRunning?: boolean;
}

interface Props {
  onOpenSession: (sessionId: string) => void;
  /** Selected goal id (or name) — from the route. */
  selectedId?: string;
  /** Change the selection ("" closes the detail drawer). Routed by App. */
  onSelect: (id: string) => void;
}

const STATUS_COLOR: Record<GoalStatus, string> = {
  active: "#1f9d55",
  paused: "#b7791f",
  done: "#3182ce",
  failed: "#e03131",
};

export function Goals({ onOpenSession, selectedId, onSelect }: Props) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchModels()
      .then((m) => setDefaultModel(m.default))
      .catch(() => {});
  }, []);

  const load = useCallback(async () => {
    try {
      setGoals(await fetchGoals());
      setLoading(false);
    } catch {}
  }, []);

  useEffect(() => {
    document.title = docTitle("Goals");
    load();
    const id = setInterval(load, 10000);
    return () => {
      clearInterval(id);
      document.title = DEFAULT_DOC_TITLE;
    };
  }, [load]);

  // The routed selection — matched by id, or by name for deep-links.
  const sel = useMemo(
    () =>
      selectedId
        ? goals.find((g) => g.id === selectedId || g.name === selectedId) || null
        : null,
    [goals, selectedId],
  );

  // Leaving the selection also leaves edit mode.
  useEffect(() => setEditMode(false), [sel?.id]);

  // Escape backs out one layer: inline edit → read view → closed.
  useEffect(() => {
    if (!sel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (editMode) setEditMode(false);
      else onSelect("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [!!sel, editMode, onSelect]);

  async function act(fn: () => Promise<unknown>, refreshDelay = 400) {
    try {
      await fn();
      setTimeout(load, refreshDelay);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function handleDelete(g: Goal) {
    if (!confirm(`Delete goal "${g.name}" and its ledger? The session it created is left as-is.`))
      return;
    if (sel?.id === g.id) onSelect("");
    await act(() => deleteGoalApi(g.id), 100);
  }

  return (
    <div className="relative flex min-h-0 min-w-0 flex-1">
    {/* Drawer open: the list compresses to a narrow rail, and on phones it
        steps aside entirely — Back returns to it. */}
    <div
      className={cn(
        "min-w-0 overflow-y-auto",
        sel
          ? "flex-[0_0_340px] border-r border-line px-3.5 pt-4 pb-10 max-[900px]:hidden"
          : "flex-1 px-6 pt-7 pb-15 max-[560px]:px-4 max-[560px]:pt-5 max-[560px]:pb-12",
      )}
    >
    <div className={cn("mx-auto", !sel && "max-w-[860px]")}>
      <PageHeader
        className={`max-[560px]:mb-5 max-[560px]:flex-col max-[560px]:items-start max-[560px]:gap-3.5 ${
          sel ? "mb-3.5 items-center" : ""
        }`}
      >
        <div>
          <PageTitle className={sel ? "text-item-title" : undefined}>Goals</PageTitle>
          <PageDescription className={sel ? "hidden" : undefined}>
            Long-running, self-pacing missions. One managed session that remembers its own
            progress, paces itself, and stops when done.
          </PageDescription>
        </div>
        <Button
					variant="primary"
					size="lg"
					className="px-[18px] text-control-label font-medium"
					onClick={() => setShowForm(true)}
				>
					+ New goal
				</Button>
      </PageHeader>

      {error && (
        <InlineAlert onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}

      {showForm && (
        <GoalForm
          initial={null}
          onClose={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            load();
          }}
        />
      )}

      {loading ? (
        <LoadingState>Loading…</LoadingState>
      ) : goals.length === 0 && !showForm ? (
        <EmptyState title="No goals yet.">
          A goal pursues one mission over days or weeks. It wakes itself, reads its ledger,
          ships work via PRs, measures, and iterates until the objective is met.
        </EmptyState>
      ) : (
        <div className="flex flex-col border-t border-line">
          {goals.map((g) => {
            const running = g.isRunning || g.lastRunStatus === "running";
            return (
              <button
                key={g.id}
                className={cn(
                  "flex w-full min-w-0 items-center gap-3 border-b border-line px-2.5 py-2.75 text-left text-body text-fg",
                  "max-[560px]:gap-2.5 max-[560px]:px-1 max-[560px]:py-3",
                  sel?.id === g.id ? "bg-active" : "hover:bg-hover",
                )}
                onClick={() => onSelect(g.id)}
              >
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: STATUS_COLOR[g.status] }}
                  title={g.pauseReason || g.doneReason || g.status}
                />
                <span
                  className={cn(
                    "flex min-w-0 flex-1 flex-col gap-0.75 max-[560px]:-order-1",
                    g.status !== "active" && "opacity-55",
                  )}
                >
                  <span className="truncate text-body font-semibold">{g.name}</span>
                  <span className="truncate text-meta text-faint">
                    {g.status}
                    {g.phase ? ` · ${g.phase}` : ""}
                    {` · wake #${g.wakeCount}${g.maxWakes ? ` / ${g.maxWakes}` : ""}`}
                  </span>
                </span>
                {running ? (
                  <WorkingPill />
                ) : g.lastRunStatus === "ok" ? (
                  <span
                    className="text-green"
                    title={`Last wake ok${g.lastRunAt ? ` · ${relativeTime(g.lastRunAt)}` : ""}`}
                  >
                    ✓
                  </span>
                ) : g.lastRunStatus === "error" ? (
                  <span className="text-red" title={g.lastRunError || "Last wake failed"}>
                    ✗
                  </span>
                ) : null}
                <span
                  className={cn(
                    "w-21 shrink-0 text-right text-meta text-faint",
                    sel ? "hidden" : "max-[560px]:hidden",
                  )}
                >
                  {g.status === "active" && g.nextWakeAt
                    ? `next ${formatNext(g.nextWakeAt)}`
                    : g.status}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
    </div>

      {sel && (
        <aside className="flex min-h-0 min-w-0 flex-auto flex-col border-l border-line bg-panel max-[900px]:border-l-0">
          <div className="flex shrink-0 items-center gap-2.5 border-b border-line px-4 py-3">
            {/* Phones get Back instead of Close: there the drawer is the page. */}
            <button
              className="-my-1 -ml-0.5 hidden shrink-0 items-center gap-1.75 px-1.5 py-1 text-body font-medium text-fg max-[900px]:inline-flex"
              onClick={() => onSelect("")}
              title="Back to goals"
            >
              <svg width="19" height="19" viewBox="0 0 16 16" fill="currentColor" className="text-dim" aria-hidden>
                <path d="M9.78 12.78a.75.75 0 0 1-1.06 0L4.47 8.53a.75.75 0 0 1 0-1.06l4.25-4.25a.749.749 0 1 1 1.06 1.06L6.06 8l3.72 3.72a.75.75 0 0 1 0 1.06Z" />
              </svg>
              Goals
            </button>
            <span className="min-w-0 truncate text-label font-semibold">
              {editMode ? `Edit ${sel.name}` : sel.name}
            </span>
            {!editMode && (
              <div className="ml-auto flex shrink-0 gap-1.5">
                {sel.status === "active" && (
                  <Button
                    size="sm"
                    className="border-line-strong bg-transparent"
                    onClick={() => act(() => runGoalApi(sel.id))}
                    disabled={sel.isRunning}
                  >
                    Wake now
                  </Button>
                )}
                {sel.status === "active" ? (
                  <Button size="sm" className="border-line-strong bg-transparent" onClick={() => act(() => pauseGoalApi(sel.id))}>
                    Pause
                  </Button>
                ) : (
                  <Button size="sm" className="border-line-strong bg-transparent" onClick={() => act(() => resumeGoalApi(sel.id))}>
                    Resume
                  </Button>
                )}
                <Button size="sm" className="border-line-strong bg-transparent" onClick={() => setEditMode(true)}>
                  Edit
                </Button>
                <Button size="sm" variant="danger" onClick={() => handleDelete(sel)}>
                  Delete
                </Button>
              </div>
            )}
            <button
              className="flex size-7 shrink-0 items-center justify-center rounded-md text-dim hover:bg-hover hover:text-fg max-[900px]:hidden"
              onClick={() => onSelect("")}
              title="Close"
            >
              <svg width="19" height="19" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.749.749 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.749.749 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
              </svg>
            </button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pt-4.5 pb-10">
            {editMode ? (
              <GoalForm
                key={sel.id}
                inline
                initial={sel}
                onClose={() => setEditMode(false)}
                onSaved={() => {
                  setEditMode(false);
                  load();
                }}
              />
            ) : (
              <>
                <div className="flex items-center gap-2.5">
                  <span
                    className={SOURCE_CHIP}
                    style={{ background: STATUS_COLOR[sel.status], color: "#fff" }}
                  >
                    {sel.status}
                  </span>
                  {(sel.isRunning || sel.lastRunStatus === "running") && (
                    <WorkingPill />
                  )}
                  {sel.status === "active" && sel.nextWakeAt && (
                    <span className="text-faint text-label ml-auto shrink-0" title={sel.nextWakeAt}>
                      next wake {formatNext(sel.nextWakeAt)}
                    </span>
                  )}
                </div>
                {sel.status === "paused" && sel.pauseReason && (
                  <div className="text-dim text-supporting leading-snug">
                    Paused: {sel.pauseReason}
                  </div>
                )}
                {(sel.status === "done" || sel.status === "failed") && sel.doneReason && (
                  <div className="text-dim text-supporting leading-snug">
                    {sel.status === "done" ? "Done" : "Failed"}: {sel.doneReason}
                  </div>
                )}

                <div>
                  <div className={SECTION_LABEL}>Mission</div>
                  <div className="bg-surface border border-line rounded-panel px-3.5 py-3 text-[13px] leading-relaxed text-dim whitespace-pre-wrap">
                    {sel.mission}
                  </div>
                </div>

                <div>
                  <div className={SECTION_LABEL}>Configuration</div>
                  <div className="grid grid-cols-[max-content_1fr] items-baseline gap-x-5 gap-y-2 text-[13px]">
                    <DetailKey>Mode</DetailKey>
                    <span className="text-dim">
                      {sel.mode === "ask"
                        ? "Ask · read-only research and measurement"
                        : `Code · persistent worktree${sel.repo ? ` in ${repoLabel(sel.repo)}` : ""}, can open PRs`}
                    </span>

                    {sel.phase && (
                      <>
                        <DetailKey>Phase</DetailKey>
                        <span className="text-dim min-w-0">{sel.phase}</span>
                      </>
                    )}

                    <DetailKey>Model</DetailKey>
                    <span className="text-dim">
                      {sel.model || `${defaultModel || "default"} (default)`}
                      {sel.fallbackModel && sel.fallbackModel !== "none" && (
                        <span
                          className="text-faint"
                          title="Used only when every account for the primary model has hit its usage limit"
                        >
                          {" "}· falls back to {sel.fallbackModel}
                        </span>
                      )}
                    </span>

                    <DetailKey>Cadence</DetailKey>
                    <span className="text-dim">
                      at least {sel.minWakeMinutes}m between wakes
                      {sel.maxWakes ? ` · capped at ${sel.maxWakes} wakes` : ""}
                    </span>

                    <DetailKey>MCPs</DetailKey>
                    <span className="text-dim min-w-0">
                      {sel.mcpServers?.length ? sel.mcpServers.join(", ") : "all connectors"}
                    </span>

                    {sel.bksSessionId && (
                      <>
                        <DetailKey>Session</DetailKey>
                        <span className="min-w-0">
                          <a
                            className={LINK}
                            onClick={(e) => {
                              e.preventDefault();
                              onOpenSession(sel.bksSessionId!);
                            }}
                            href={`${BASE_PATH}/session/${sel.bksSessionId}`}
                          >
                            open the goal's session
                          </a>
                        </span>
                      </>
                    )}

                    <DetailKey>Created</DetailKey>
                    <span className="text-dim">by {sel.createdBy}</span>
                  </div>
                </div>

                <div>
                  <div className={SECTION_LABEL}>Activity</div>
                  <div className="text-dim text-supporting mb-2">
                    wake #{sel.wakeCount}
                    {sel.maxWakes ? ` of ${sel.maxWakes}` : ""}
                    {sel.lastRunAt && (
                      <>
                        {" · last wake "}
                        {relativeTime(sel.lastRunAt)}
                        {sel.lastRunStatus === "ok" && <span className="text-green"> ✓</span>}
                        {sel.lastRunStatus === "error" && (
                          <span className="text-red" title={sel.lastRunError}> ✗</span>
                        )}
                      </>
                    )}
                  </div>
                  <GoalLedger id={sel.id} />
                </div>
              </>
            )}
          </div>
        </aside>
      )}
    </div>
  );
}

/** Left column of the drawer's Configuration grid. */
function DetailKey({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-faint text-label leading-[1.7] whitespace-nowrap">{children}</span>
  );
}

/** Lazily fetch + show a goal's full mission + ledger. */
function GoalLedger({ id }: { id: string }) {
  const [ledger, setLedger] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetchGoal(id)
      .then((g) => {
        if (alive) setLedger(g.ledger || "(ledger is empty)");
      })
      .catch(() => alive && setLedger("(failed to load ledger)"));
    return () => {
      alive = false;
    };
  }, [id]);
  return (
    <pre
      style={{
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
        maxHeight: 360,
        overflow: "auto",
        margin: 0,
        padding: "10px 12px",
        background: "var(--bg-raised)",
        color: "var(--text)",
        border: "1px solid var(--border)",
        borderRadius: 8,
        fontFamily: "var(--mono)",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {ledger === null ? "Loading ledger…" : ledger}
    </pre>
  );
}

function formatNext(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 60_000) return "in <1m";
  if (diff < 3_600_000) return `in ${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `in ${Math.round(diff / 3_600_000)}h`;
  return `in ${Math.round(diff / 86_400_000)}d`;
}

/** " (Claude)" / " (OpenAI Codex)" by the model's ACCOUNT POOL — the engine
 *  provider ("opencode"/"pi") says nothing about whose subscription pays, and
 *  keying off it labeled every engine entry "(Claude)". Pool-less models get
 *  no suffix. */
function accountPoolSuffix(m: ModelOption): string {
  if (m.accountProvider === "codex") return " (OpenAI Codex)";
  if (m.accountProvider === "claude") return " (Claude)";
  return "";
}

function GoalForm({
  initial,
  inline,
  onClose,
  onSaved,
}: {
  initial: Goal | null;
  /** Hosted in the detail drawer: drop the card chrome + redundant title. */
  inline?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [mission, setMission] = useState(initial?.mission || "");
  const [mode, setMode] = useState<"ask" | "code">(initial?.mode || "ask");
  const [repo, setRepo] = useState(initial?.repo || "");
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [model, setModel] = useState(initial?.model || "");
  const [fallbackModel, setFallbackModel] = useState(initial?.fallbackModel || "");
  const [mcpServers, setMcpServers] = useState((initial?.mcpServers || []).join(", "));
  const [minWakeMinutes, setMinWakeMinutes] = useState(String(initial?.minWakeMinutes ?? 30));
  const [maxWakes, setMaxWakes] = useState(initial?.maxWakes ? String(initial.maxWakes) : "");
  const [models, setModels] = useState<ModelOption[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchModels(), fetchRepos()])
      .then(([m, repoItems]) => {
        setModels(m.models);
        setDefaultModel(m.default);
        setRepos(repoItems);
        setRepo((current) =>
          current ||
          repoItems.find((item) => item.default)?.id ||
          repoItems[0]?.id ||
          "",
        );
      })
      .catch(() => {});
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const servers = mcpServers
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const payload = {
      name,
      mission,
      mode,
      repo: repo.trim() || undefined,
      model: model || undefined,
      fallbackModel: fallbackModel || undefined,
      mcpServers: servers.length ? servers : undefined,
      minWakeMinutes: Number(minWakeMinutes) || undefined,
      maxWakes: maxWakes.trim() ? Number(maxWakes) : undefined,
    };
    try {
      if (initial) {
        await updateGoalApi(initial.id, payload);
      } else {
        await createGoalApi({ ...payload, createdBy: getCurrentUser() });
      }
      onSaved();
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <div className={inline ? FORM_INLINE : FORM_CARD}>
      {!inline && (
        <div className={FORM_TITLE}>
          {initial ? `Edit "${initial.name}"` : "New goal"}
        </div>
      )}

      <label className={FIELD_LABEL}>
        Name
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Rank #1: screen recording software"
        />
      </label>

      <label className={FIELD_LABEL}>
        Mission
        <Textarea
          value={mission}
          onChange={(e) => setMission(e.target.value)}
          rows={12}
          placeholder="The full mission brief: objective, strategy, operating loop, hard rules. It's restated to the agent every wake."
        />
      </label>

      <div className={FORM_ROW}>
        <label className={FIELD_LABEL}>
          Mode
          <Select value={mode} onChange={(e) => setMode(e.target.value as "ask" | "code")}>
            <option value="ask">Ask · read-only research and measurement</option>
            <option value="code">Code · persistent worktree, can open PRs</option>
          </Select>
        </label>

        <label className={FIELD_LABEL}>
          Repo (code mode)
          <Select value={repo} onChange={(e) => setRepo(e.target.value)}>
            {repos.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label || repoLabel(item.id)}
              </option>
            ))}
          </Select>
        </label>

        <label className={FIELD_LABEL}>
          Model
          <Select value={model} onChange={(e) => setModel(e.target.value)}>
            <option value="">Default{defaultModel ? ` · ${defaultModel}` : ""}</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {accountPoolSuffix(m)}
              </option>
            ))}
          </Select>
        </label>

        <label className={FIELD_LABEL}>
          Fallback (all accounts hit limits)
          <Select value={fallbackModel} onChange={(e) => setFallbackModel(e.target.value)}>
            <option value="">None · fail instead</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
                {accountPoolSuffix(m)}
              </option>
            ))}
          </Select>
        </label>
      </div>

      <div className={FORM_ROW}>
        <label className={FIELD_LABEL}>
          MCP servers (comma-separated; blank = all)
          <Input
            value={mcpServers}
            onChange={(e) => setMcpServers(e.target.value)}
            placeholder="ahrefs, slack"
            className="mono-input"
          />
        </label>

        <label className={FIELD_LABEL}>
          Min minutes between wakes
          <Input
            type="number"
            value={minWakeMinutes}
            onChange={(e) => setMinWakeMinutes(e.target.value)}
            placeholder="30"
          />
        </label>

        <label className={FIELD_LABEL}>
          Max wakes (safety cap; blank = none)
          <Input
            type="number"
            value={maxWakes}
            onChange={(e) => setMaxWakes(e.target.value)}
            placeholder="–"
          />
        </label>
      </div>

      {error && <InlineAlert>{error}</InlineAlert>}

      <div className={FORM_ACTIONS}>
        <Button size="md" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="primary"
          className="px-[22px] py-2"
          onClick={handleSave}
          disabled={saving || !name.trim() || !mission.trim()}
        >
          {saving ? "Saving…" : initial ? "Save changes" : "Create goal"}
        </Button>
      </div>
    </div>
  );
}
