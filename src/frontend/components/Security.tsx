import { repoLabel } from "../lib/repo-label";
import { BASE_PATH } from "../lib/base";
import React, { useEffect, useState, useCallback } from "react";
import {
  fetchSecurity,
  startScanApi,
  deleteScanApi,
  createScanProfileApi,
  updateScanProfileApi,
  deleteScanProfileApi,
  fetchAutomations,
  relativeTime,
  type SecurityScan,
  type ScanProfile,
} from "../lib/api";
import { getCurrentUser } from "./UserPicker";
import { AGENT_NAME, docTitle, DEFAULT_DOC_TITLE } from "../lib/brand";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { cn } from "../ui/cn";
import { IconPlus } from "./icons";
import { SOURCE_CHIP } from "../lib/source-chip-classes";
import { Input, Select, Textarea } from "../ui/input";
import { PageDescription, PageHeader, PageTitle } from "../ui/page-header";
import { EmptyState, InlineAlert, LoadingState } from "../ui/state";

/* The old .automation-form / .automation-card families, as utilities (see
   Automations.tsx — this page shares their shapes). The descendant variants
   keep the two rules that reached in from the form to its fields: 16px on
   phones, so iOS doesn't zoom a focused field, and paragraph leading in a
   textarea. */
const FORM_FIELDS =
  "[&_textarea]:leading-normal phone:[&_input]:text-[16px] phone:[&_select]:text-[16px] phone:[&_textarea]:text-[16px]";
/** .automation-form */
const FORM_CARD = `flex flex-col gap-3.5 rounded-panel border border-line-strong bg-panel p-4.5 ${FORM_FIELDS}`;
/** .automation-form label */
const FIELD_LABEL = "flex flex-1 flex-col gap-1.5 text-label font-medium text-dim";
/** .automation-form-title */
const FORM_TITLE = "text-body font-semibold";
/** .automation-form-actions */
const FORM_ACTIONS = "flex justify-end gap-2.5";
/** .automation-card */
const CARD = "rounded-panel border border-line bg-panel px-4 py-3.5";
/** .automation-top — one row on desktop; on phones the title takes the first
 *  line, chips flow after it and the actions drop to a row of their own. */
const CARD_TOP = "flex min-w-0 items-center gap-2.5 phone:flex-wrap phone:gap-y-2";
/** .automation-name */
const CARD_NAME =
  "truncate text-body font-semibold phone:min-w-0 phone:flex-[1_1_60%] phone:whitespace-normal phone:[overflow-wrap:anywhere]";
/** .automation-actions */
const CARD_ACTIONS = "ml-auto flex shrink-0 gap-1.5 phone:ml-0 phone:w-full";
/** .automation-prompt */
const CARD_PROMPT = "my-2.25 line-clamp-2 text-supporting leading-normal text-dim";
/** .automation-meta */
const CARD_META = "flex flex-wrap items-center gap-x-3.5 gap-y-1.5 text-meta text-faint";
/** .automation-by — the trailing "by <person>", dropped on phones. */
const CARD_BY = "ml-auto phone:hidden";
/** .automation-session-link */
const LINK = "cursor-pointer text-link no-underline hover:underline";

interface Props {
  onOpenSession: (sessionId: string) => void;
}

interface RecurringScan {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  lastRunAt?: string;
  lastRunStatus?: string;
  lastRunSessionId?: string;
}

type Tab = "scans" | "profiles";

export function Security({ onOpenSession }: Props) {
  const [scans, setScans] = useState<SecurityScan[]>([]);
  const [profiles, setProfiles] = useState<ScanProfile[]>([]);
  const [repos, setRepos] = useState<Array<{ id: string }>>([]);
  const [recurring, setRecurring] = useState<RecurringScan[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("scans");
  const [showNewScan, setShowNewScan] = useState(false);
  const [editProfile, setEditProfile] = useState<ScanProfile | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchSecurity();
      setScans(data.scans);
      setProfiles(data.profiles);
      setRepos(data.repos);
      setLoading(false);
    } catch {}
    try {
      const autos = await fetchAutomations();
      setRecurring(
        (autos as RecurringScan[]).filter((a) =>
          /deepsec|security scan/i.test(a.name),
        ),
      );
    } catch {}
  }, []);

  useEffect(() => {
    document.title = docTitle("Security");
    load();
    const id = setInterval(load, 10000);
    return () => {
      clearInterval(id);
      document.title = DEFAULT_DOC_TITLE;
    };
  }, [load]);

  async function handleDeleteScan(s: SecurityScan) {
    if (!confirm("Remove this scan record? Its sessions are left as-is.")) return;
    try {
      await deleteScanApi(s.id);
      load();
    } catch (e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="mx-auto min-h-0 w-full max-w-[860px] flex-1 overflow-y-auto px-6 pt-7 pb-15 phone:px-3.5 phone:pt-4.5 phone:pb-12">
      <PageHeader>
        <div>
          <PageTitle>Security</PageTitle>
          <PageDescription>
            deepsec scans across the registered repos. Findings land as PRs, one per confirmed issue.
          </PageDescription>
        </div>
        <Button
					variant="primary"
					size="lg"
					icon={<IconPlus size={20} />}
					className="pl-4 pr-[18px] text-control-label font-medium"
					onClick={() => setShowNewScan(true)}
				>
					New scan
				</Button>
      </PageHeader>

      <div className="flex items-center gap-1.5 mb-4">
        {(
          [
            ["scans", `Scans ${scans.length}`],
            ["profiles", `Profiles ${profiles.length}`],
          ] as Array<[Tab, string]>
        ).map(([t, label]) => (
          <Button
            key={t}
            size="sm"
            className={cn(tab === t && "bg-active text-fg")}
            onClick={() => setTab(t)}
          >
            {label}
          </Button>
        ))}
      </div>

      {error && (
        <InlineAlert className="text-[13px]" onDismiss={() => setError(null)}>
          {error}
        </InlineAlert>
      )}

      {showNewScan && (
        <NewScanModal
          repos={repos.map((r) => r.id)}
          profiles={profiles}
          onClose={() => setShowNewScan(false)}
          onStarted={(sessionId) => {
            setShowNewScan(false);
            load();
            if (sessionId) onOpenSession(sessionId);
          }}
        />
      )}

      {editProfile && (
        <ProfileModal
          initial={editProfile === "new" ? null : editProfile}
          onClose={() => setEditProfile(null)}
          onSaved={() => {
            setEditProfile(null);
            load();
          }}
        />
      )}

      {loading ? (
        <LoadingState>Loading…</LoadingState>
      ) : tab === "profiles" ? (
        <div className="flex flex-col gap-2.5">
          <div>
            <Button size="sm" onClick={() => setEditProfile("new")}>
              + Create a profile
            </Button>
          </div>
          {profiles.length === 0 ? (
            <EmptyState title="No scan profiles yet">
              Profiles customize how scans analyze your code: threat model
              focus, known false positives, severity bar.
            </EmptyState>
          ) : (
            profiles.map((p) => (
              <div key={p.id} className={CARD}>
                <div className={CARD_TOP}>
                  <span className={CARD_NAME}>{p.name}</span>
                  <div className={CARD_ACTIONS}>
                    <Button size="sm" onClick={() => setEditProfile(p)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        if (!confirm(`Delete profile "${p.name}"?`)) return;
                        try {
                          await deleteScanProfileApi(p.id);
                          load();
                        } catch (e: any) {
                          setError(e.message);
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
                <div className={CARD_PROMPT}>{p.prompt}</div>
                <div className={CARD_META}>
                  <span className={CARD_BY}>by {p.createdBy}</span>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {recurring.length > 0 && (
            <div className="bg-panel border border-line rounded-panel px-3.5 py-3">
              <div className="text-fg text-[13px] font-medium mb-1.5">Recurring</div>
              <div className="flex flex-col gap-1">
                {recurring.map((r) => (
                  <div key={r.id} className="flex items-baseline gap-2 text-supporting text-dim min-w-0">
                    <span className={r.enabled ? "text-green" : "text-faint"}>●</span>
                    <span className="text-fg truncate">{r.name}</span>
                    <span className="text-faint shrink-0">{r.schedule}</span>
                    {r.lastRunAt && (
                      <span className="shrink-0">
                        last {relativeTime(r.lastRunAt)}
                        {r.lastRunStatus === "ok" ? " ✓" : r.lastRunStatus === "error" ? " ✗" : ""}
                      </span>
                    )}
                    <a className={cn(LINK, "ml-auto shrink-0")} href={`${BASE_PATH}/automations`}>
                      manage
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {scans.length === 0 ? (
            <EmptyState title="No scans yet">
              Start a scan to search for findings across your repositories.
            </EmptyState>
          ) : (
            scans.map((s) => (
              <div key={s.id} className={CARD}>
                <div className={CARD_TOP}>
                  <StatusPill status={s.status} />
                  <span className={CARD_NAME}>
                    {s.interactive ? "Interactive scan" : "Scan"} ·{" "}
                    {s.repos.map(repoLabel).join(", ")}
                  </span>
                  {s.profileName && (
                    <span className={SOURCE_CHIP} title="Scan profile">
                      {s.profileName}
                    </span>
                  )}
                  <div className={CARD_ACTIONS}>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleDeleteScan(s)}
                    >
                      Remove
                    </Button>
                  </div>
                </div>

                {s.instructions && (
                  <div className={CARD_PROMPT}>{s.instructions}</div>
                )}

                <div className="mt-1.5 flex flex-col gap-1">
                  {s.sessions.map((ref) => (
                    <div
                      key={ref.repo + ref.sessionId}
                      className="flex items-baseline gap-2 text-label text-dim min-w-0"
                    >
                      {ref.status === "running" ? (
                        <span className="text-yellow shrink-0">●</span>
                      ) : ref.status === "ok" ? (
                        <span className="text-green shrink-0">✓</span>
                      ) : (
                        <span className="text-red shrink-0" title={ref.error}>✗</span>
                      )}
                      <span className="text-fg shrink-0">{repoLabel(ref.repo)}</span>
                      {ref.error && (
                        <span className="text-red truncate" title={ref.error}>
                          {ref.error}
                        </span>
                      )}
                      {ref.sessionId && (
                        <a
                          className={cn(LINK, "ml-auto shrink-0")}
                          href={`${BASE_PATH}/session/${ref.sessionId}`}
                          onClick={(e) => {
                            e.preventDefault();
                            onOpenSession(ref.sessionId);
                          }}
                        >
                          view session
                        </a>
                      )}
                    </div>
                  ))}
                </div>

                <div className={CARD_META}>
                  <span>started {relativeTime(s.createdAt)}</span>
                  {s.finishedAt && <span>finished {relativeTime(s.finishedAt)}</span>}
                  <span className={CARD_BY}>by {s.createdBy}</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: SecurityScan["status"] }) {
  const cls =
    status === "running"
      ? "text-yellow"
      : status === "done"
        ? "text-green"
        : status === "interactive"
          ? "text-accent"
          : "text-red";
  const label =
    status === "running"
      ? "Running"
      : status === "done"
        ? "Done"
        : status === "interactive"
          ? "Interactive"
          : "Error";
  return (
    <span className={`text-label font-medium shrink-0 ${cls}`}>
      ● {label}
    </span>
  );
}

// ── New scan modal ───────────────────────────────────────────

function NewScanModal({
  repos,
  profiles,
  onClose,
  onStarted,
}: {
  repos: string[];
  profiles: ScanProfile[];
  onClose: () => void;
  onStarted: (sessionId?: string) => void;
}) {
  const [scope, setScope] = useState<"single" | "all">("single");
  const [repo, setRepo] = useState(repos[0] || "");
  const [profileId, setProfileId] = useState("");
  const [instructions, setInstructions] = useState("");
  const [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly">("none");
  const [interactive, setInteractive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const singleRepo = scope === "single" && !!repo;
  const canRecur = singleRepo && !interactive;
  const canInteractive = singleRepo && recurrence === "none";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleStart() {
    setStarting(true);
    setError(null);
    try {
      const res = await startScanApi({
        repos: scope === "all" ? "all" : [repo],
        profileId: profileId || undefined,
        instructions: instructions.trim() || undefined,
        interactive: canInteractive && interactive,
        recurrence: canRecur ? recurrence : "none",
        createdBy: getCurrentUser(),
      });
      onStarted(res.sessionId);
    } catch (e: any) {
      setError(e.message);
      setStarting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[300] bg-black/45 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={cn(FORM_CARD, "my-auto w-full max-w-[560px] smooth-shadow-lg")}>
        <div>
          <div className={FORM_TITLE}>New scan</div>
          <div className="text-dim text-[13px] mt-0.5">
            Start a search for findings across your repositories.
          </div>
        </div>

        <div className="flex gap-1.5">
          <Button
            size="sm"
            className={cn(scope === "single" && "bg-active text-fg")}
            onClick={() => setScope("single")}
          >
            Single repo
          </Button>
          <Button
            size="sm"
            className={cn(scope === "all" && "bg-active text-fg")}
            onClick={() => {
              setScope("all");
              setInteractive(false);
              setRecurrence("none");
            }}
          >
            All repos
          </Button>
        </div>

        {scope === "single" && (
          <label className={FIELD_LABEL}>
            Select repository
            <Select value={repo} onChange={(e) => setRepo(e.target.value)}>
              {repos.map((r) => (
                <option key={r} value={r}>
                  {repoLabel(r)}
                </option>
              ))}
            </Select>
          </label>
        )}

        <label className={FIELD_LABEL}>
          Scan profile
          <Select value={profileId} onChange={(e) => setProfileId(e.target.value)}>
            <option value="">None · default threat model</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          {profiles.length === 0 && (
            <span className="mt-1 text-meta text-faint">
              No scan profiles yet. Profiles customize how scans analyze your
              code. Create one under Security → Profiles.
            </span>
          )}
        </label>

        <label className={FIELD_LABEL}>
          Instructions for this scan (optional)
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={3}
            placeholder="Focus or constrain the scan. e.g. “only the upload pipeline and its S3 handling”, “report only, no fix PRs”…"
          />
        </label>

        <label className={FIELD_LABEL}>
          Repeats
          <Select
            value={canRecur ? recurrence : "none"}
            onChange={(e) => setRecurrence(e.target.value as any)}
            disabled={!canRecur}
          >
            <option value="none">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </Select>
          {!singleRepo && (
            <span className="mt-1 text-meta text-faint">
              Recurring and interactive scans support one repository at a time.
            </span>
          )}
        </label>

        <label
          className={cn(
            "flex flex-row items-start gap-2.5 text-label font-medium text-dim",
            canInteractive ? "cursor-pointer" : "opacity-50",
          )}
        >
          <Checkbox
            className="mt-[3px]"
            checked={canInteractive && interactive}
            disabled={!canInteractive}
            onCheckedChange={setInteractive}
          />
          <span>
            Interactive mode
            <span className="block text-dim text-label font-medium mt-0.5">
              Instead of scanning end to end, {AGENT_NAME} collaborates with you in a
              session to tailor the threat model to your preferences before
              running the scan.
            </span>
          </span>
        </label>

        {error && <InlineAlert className="text-[13px]">{error}</InlineAlert>}

        <div className={FORM_ACTIONS}>
          <Button size="sm" onClick={onClose} disabled={starting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="px-[22px] py-2"
            onClick={handleStart}
            disabled={starting || (scope === "single" && !repo)}
          >
            {starting
              ? "Starting…"
              : recurrence !== "none" && canRecur
                ? "Create recurring scan"
                : interactive && canInteractive
                  ? "Start interactive session"
                  : "Start scan"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Profile modal ────────────────────────────────────────────

function ProfileModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: ScanProfile | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [prompt, setPrompt] = useState(initial?.prompt || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      if (initial) await updateScanProfileApi(initial.id, { name, prompt });
      else await createScanProfileApi({ name, prompt, createdBy: getCurrentUser() });
      onSaved();
    } catch (e: any) {
      setError(e.message);
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[300] bg-black/45 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={cn(FORM_CARD, "my-auto w-full max-w-[560px] smooth-shadow-lg")}>
        <div className={FORM_TITLE}>
          {initial ? `Edit "${initial.name}"` : "New scan profile"}
        </div>

        <label className={FIELD_LABEL}>
          Name
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Payments-focused, strict"
          />
        </label>

        <label className={FIELD_LABEL}>
          Threat model: how should scans analyze the code?
          <Textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={8}
            placeholder={
              "What to prioritize (auth, payments, uploads…), what's intentionally public, known accepted risks / false positives to skip, severity bar, PR-per-finding vs report-only…"
            }
          />
        </label>

        {error && <InlineAlert className="text-[13px]">{error}</InlineAlert>}

        <div className={FORM_ACTIONS}>
          <Button size="sm" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className="px-[22px] py-2"
            onClick={handleSave}
            disabled={saving || !name.trim() || !prompt.trim()}
          >
            {saving ? "Saving…" : initial ? "Save changes" : "Create profile"}
          </Button>
        </div>
      </div>
    </div>
  );
}
