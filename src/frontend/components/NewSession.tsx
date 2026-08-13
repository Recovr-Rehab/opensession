import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import { fetchWorktrees, fetchModels, fetchFileMentions, fetchSkillMentions, fetchConnections, fetchSandboxStatus, requestSandboxPrewarm, suggestBranch, fetchProviderAccounts, fetchRepos, type ProviderAccountOption, type ModelOption, type SandboxStatusInfo } from "../lib/api";
import { getCurrentUser, useAuthStatus } from "./UserPicker";
import { splitAttachments, imageFilesFromPaste, type FileAttachment } from "../lib/images";
import { loadDraft, saveDraft, clearDraft } from "../lib/drafts";
import { getDefaultModelPref } from "../lib/default-model-pref";
import { getSendKeyPref, onSendKeyChanged } from "../lib/send-key-pref";
import { insideOpenFence, isSendCombo, MOD_ENTER_GLYPH } from "../lib/send-key";
import { isApple } from "../lib/platform";
import { ImageThumbs } from "./ImageThumbs";
import { FileChips } from "./FileChips";
import { useFileMentions } from "./useFileMentions";
import { peopleMentionMatches } from "../lib/people";
import {
  IconPaperclip,
  IconChevronDown,
  IconChevronRight,
  IconCheck,
  IconConnections,
  IconDotsHorizontal,
  IconEye,
  IconReturn,
  IconBox,
  IconFile,
  IconFolderPlus,
  IconStack,
} from "./icons";
import type { WSServerMessage } from "../lib/types";
import { VoiceInput } from "./VoiceInput";
import { useIsPhone } from "../hooks/useIsPhone";
import { PaletteSelect } from "./PaletteSelect";
import { RepoTile } from "./RepoTile";
import { ModelEffortSelect } from "./ModelEffortSelect";
import { Menu } from "../ui/menu";
import { IconTile, displayName } from "./BrandTile";
import { AddRepoDialog } from "./AddRepoDialog";
import { Tooltip } from "../ui/tooltip";
import { Modal, useEnterOnMount } from "../ui/modal";
import { tintedSurfaceParts } from "../lib/tinted-surface";
import { cn } from "../ui/cn";
import {
	paletteIconBtn,
	paletteIconBtnOn,
	palettePill,
} from "../lib/palette-classes";

interface Props {
  /** Close the palette (Esc, backdrop click, or after a create without "Create more"). */
  onBack: () => void;
  send: (msg: any) => void;
  addHandler: (handler: (msg: WSServerMessage) => void) => () => void;
  connected: boolean;
  /** Prefill the prompt (e.g. from the Home "New session" box). */
  prefillPrompt?: string;
  forceMode?: "ask" | "code" | "scratch";
  /** When starting a session inside a workspace, the session joins that workspace… */
  workspaceId?: string;
  /** …and defaults to the workspace's shared repo + worktree (a sibling's branch). */
  forceRepo?: string;
  forceBranch?: string;
  /** Lets App render the pending session shell before the created session appears
      in the polled session list. */
  onCreateStarted?: (draft: {
    prompt: string;
    mode: "ask" | "code" | "scratch";
    repo: string;
    branch: string | null;
    workspaceId?: string;
    model?: string;
    images?: string[];
    /** Start the session without following it — leave the current view alone. */
    background?: boolean;
  }) => void;
}

interface Worktree {
  branch: string;
  path: string;
}

interface RepoOption {
  id: string;
  label: string;
  default?: boolean;
}

const LAST_REPO_KEY = "opensession-new-session-repo";
const ADD_REPO_VALUE = "__add_repo__";
const SCRATCH_REPO_VALUE = "__scratch__";

/* ── Palette chrome ───────────────────────────────────────────────────────
   Every class is written out in full: Tailwind scans source TEXT, so a name
   assembled from a variable compiles to nothing. Variants that differ in
   colour or corner carry a COMPLETE string rather than stacking a second
   colour utility onto a shared base — two competing colour utilities on one
   element don't compose, the compiled sheet's order picks the winner.

   The icon button and the model pill are shared with the composer toolbar, so
   they live in lib/palette-classes.ts rather than being restated here. */

/** The hairline is a cutoff for content passing under the header, so it stays
 *  transparent until the prompt has actually scrolled beneath it. The border
 *  itself is always present: switching the colour keeps the height steady,
 *  where toggling `border-b` would jog the layout by a pixel.
 *
 *  Padding is asymmetric for the same reason the footer's is: the top is the
 *  card's own edge, the bottom only a hairline. The pickers are 32px boxes
 *  that fill on hover, so 16px above them matches the 16px beside them. */
const HEADER = "flex items-center justify-between gap-2 border-b border-transparent px-4 pt-4 pb-[11px]";
/** Merged onto HEADER/FOOTER by `cn()`, which drops the transparent colour. */
const EDGE_DIVIDER = "border-line";
/** Header pickers. `relative` is load-bearing — PaletteSelect's phone branch
 *  stacks an invisible native <select> over the trigger. */
const TRIGGER =
	"relative inline-flex max-w-[46%] cursor-pointer items-center gap-1.5 rounded-control px-2 py-[5px] text-label font-medium text-dim transition-colors hover:bg-hover hover:text-fg disabled:cursor-default disabled:opacity-55";
/** The repo picker doubles as the palette's title: bigger, solid, heavier. */
const TRIGGER_STRONG =
	"relative inline-flex max-w-[46%] cursor-pointer items-center gap-1.5 rounded-control px-2 py-[5px] text-item-title font-semibold text-fg transition-colors hover:bg-hover disabled:cursor-default disabled:opacity-55";
const CHEVRON = "-ml-0.5 shrink-0 text-faint";

/** One scroll surface for the prompt and its attachments. Keeping the image in
 *  this flow means it travels with the text instead of pinning over it.
 *
 *  `pt-1` rather than `pt-3`: the header already carries 11px below its row, so
 *  a 12px reserve here put 28px between the repo picker and the placeholder
 *  while the prompt sat flush against the footer. Now that the hairline only
 *  appears once the prompt scrolls, the header and the prompt read as one
 *  block, and that gap read as a hole in it. */
const BODY =
	"relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-4 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
const TEXTAREA =
	"block min-h-[132px] w-full resize-none overflow-hidden border-none bg-transparent font-sans text-[15px] leading-[1.55] text-fg outline-none placeholder:text-faint disabled:opacity-60";
const ERROR = "mx-4 mb-2 rounded-md bg-red-soft px-2.5 py-[7px] text-supporting text-red";

/* Single-line footer: the model pill is the only flexible item — it gives way
   (its label ellipsizes) while the icon buttons and Create keep their size.
   Phones let the row wrap instead of crushing every pill to one letter.

   The bottom pad is deeper than the top one because it is measured against a
   different thing: the top is a hairline, the bottom is the card's own edge,
   rounded at ~30px. Create is a 36px plate inside a 40px row, so 14px here
   leaves it the same 16px clearance the side padding gives it. */
const FOOTER =
	"flex items-center justify-between gap-x-2 gap-y-2 border-t border-transparent px-4 pt-[9px] pb-3.5 phone:flex-wrap max-[560px]:gap-x-1.5 max-[560px]:px-3";
const FOOTER_LEFT = "flex min-w-0 items-center gap-1.5 max-[560px]:gap-1";
const FOOTER_RIGHT = "flex min-w-0 items-center gap-1.5 max-[560px]:gap-1 phone:ml-auto";
const FOOTER_ICON_BTN = cn(paletteIconBtn, "shrink-0 max-[560px]:w-9");
/** Ask mode's toggle. Off, it is one of the footer's quiet icon tools. On, it
 *  wears the same green marker the session composer's toolbar shows for the
 *  same mode, so one mode reads identically in both places — and it names
 *  itself, because the mode governs the whole session and an unlabelled glyph
 *  would leave read-only running silently.
 *
 *  A complete string rather than a variant stacked on FOOTER_ICON_BTN: the two
 *  states differ in width, height and colour, and `max-[560px]:w-9` from the
 *  icon button would crush the labelled chip on phones. 32px tall, the size
 *  the icon buttons' hover wash paints, so the row keeps one rhythm. */
const ASK_BTN_ON =
	"inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-control px-2.5 text-[12px] font-medium transition-colors bg-[color-mix(in_srgb,var(--green)_18%,transparent)] text-green hover:bg-[color-mix(in_srgb,var(--green)_26%,transparent)] disabled:cursor-default disabled:opacity-50";
/** Ask mode paints the whole card, not just its toggle — the same thing the
 *  session composer does for ask and for note mode, because the mode governs
 *  everything you are about to type rather than one control in the corner.
 *
 *  Two pseudo-elements rather than one background on the card: the palette is
 *  glass over a dimmed page, so the tint has to sit ON the blur and fade in and
 *  out with it intact. `::before` is the flat tint and the edge; `::after` is
 *  the hatch, masked so it dissolves before it reaches the toolbar. The
 *  composer gets that dissolve for free by painting its flat tint over the
 *  stripes, which a translucent tint cannot do. At this card's size the hatch
 *  would otherwise run edge to edge and read as a barber pole rather than as
 *  texture. Children are lifted above both layers, and the shell's own
 *  `overflow-hidden` clips them to the rounded corner. */
const ASK_SURFACE =
	"isolate " +
	"before:pointer-events-none before:absolute before:inset-0 before:z-0 before:rounded-[inherit] before:[corner-shape:inherit] before:border before:border-[var(--palette-ask-border)] before:bg-[var(--palette-ask-bg)] before:opacity-0 before:transition-opacity before:duration-150 before:ease-[cubic-bezier(0.32,0.72,0,1)] " +
	"after:pointer-events-none after:absolute after:inset-0 after:z-0 after:rounded-[inherit] after:[corner-shape:inherit] after:[background-image:var(--palette-ask-hatch)] after:[mask-image:linear-gradient(to_bottom,#000_0,transparent_62%)] after:[-webkit-mask-image:linear-gradient(to_bottom,#000_0,transparent_62%)] after:opacity-0 after:transition-opacity after:duration-150 after:ease-[cubic-bezier(0.32,0.72,0,1)] " +
	"[&>*]:relative [&>*]:z-[1]";
/** The one flexible footer item. `[&_[data-effort]]` reaches the effort suffix
 *  inside ModelEffortSelect: on ultra-narrow screens it cedes its space to the
 *  model name, which would otherwise truncate to a single letter. */
const MODEL_PILL = cn(
	palettePill,
	"shrink min-w-0 max-[560px]:px-[9px] max-[374px]:[&_[data-effort]]:hidden",
);

/* What a create does with the view behind the palette: "open" follows the new
   session, "background" leaves you where you were, and "more" keeps the palette
   up for the next task. The order is the dropdown's, so the cycle shortcut and
   the menu step the same way. */
const CREATE_ACTIONS = ["open", "background", "more"] as const;
type CreateAction = (typeof CREATE_ACTIONS)[number];
/** ⌘⌥↓ / ⌘⌥↑ (Ctrl+Alt elsewhere). Vertical rather than horizontal because
 *  Chrome and Safari own ⌘⌥← / ⌘⌥→ for tab switching. */
const CYCLE_SHORTCUT = isApple ? ["⌘", "⌥", "↓"] : ["Ctrl", "Alt", "↓"];

/** Each label is written out per target rather than suffixed with " locally",
 *  which would read as "Create in background locally". */
const CREATE_LABELS: Record<CreateAction, { cloud: string; local: string }> = {
	open: { cloud: "Create", local: "Create locally" },
	background: { cloud: "Create in background", local: "Create locally in background" },
	more: { cloud: "Create more", local: "Create more locally" },
};

/* Split button: primary Create action + a caret that opens a mode dropdown.
   The two halves' corners are scoped to mutually exclusive media queries, so
   no two radius utilities ever race: phones drop the caret and round the main
   button out to a full pill.

   Desktop rounds on `rounded-control`, the corner every other button in the
   chrome shares (the Button primitive, the header CTAs). It used to be
   `rounded-md` — one step down, 9.45px against 13.5px — which on a 36px-tall
   plate read visibly square next to its neighbours. */
const CREATE_SPLIT = "relative inline-flex shrink-0 items-stretch";
const CREATE_MAIN =
	"inline-flex cursor-pointer items-center gap-[7px] border-none bg-accent px-3.5 py-[7px] text-label font-semibold text-on-accent transition-[background-color,opacity] enabled:hover:bg-accent-hover disabled:cursor-default disabled:opacity-40 desktop:rounded-l-control phone:rounded-[999px] max-[560px]:px-3";
const CREATE_CARET =
	"inline-flex cursor-pointer items-center gap-[7px] rounded-r-control border-none bg-accent p-[7px] text-label font-semibold text-on-accent shadow-[inset_1px_0_0_rgba(0,0,0,0.14)] transition-[background-color,opacity] enabled:hover:bg-accent-hover phone:hidden";
const CREATE_KBD = "opacity-70";
const CREATE_MENU =
	"absolute bottom-[calc(100%+6px)] right-0 z-20 min-w-[208px] rounded-control bg-popup-glass [backdrop-filter:var(--popup-blur)] [--smooth-ring-color:var(--popup-ring)] p-[5px] smooth-shadow-ring-md";
const CREATE_MENU_ITEM =
	"flex w-full cursor-pointer items-start gap-[9px] rounded-md border-none bg-transparent px-[9px] py-[7px] text-left text-fg transition-colors hover:bg-hover";

function lastSelectedRepo(): string | null {
  try {
    return localStorage.getItem(LAST_REPO_KEY) || null;
  } catch {
    return null;
  }
}

function rememberSelectedRepo(repo: string) {
  try {
    localStorage.setItem(LAST_REPO_KEY, repo);
  } catch {}
}

// The repo the sidebar is currently filtered to (persisted by Sidebar.tsx under
// this key). When set to a real repo, a new session should default to it so
// creating from a repo-filtered view lands on that repo.
function filteredRepo(): string | null {
  try {
    const v = JSON.parse(localStorage.getItem("opensession-sidebar-filter") || "{}");
    return typeof v.repo === "string" ? v.repo : null;
  } catch {
    return null;
  }
}

/** Deep-link prefill: <base>/new?mode=ask|code&prompt=…&branch=…&repo= */
function readPrefill() {
  const params = new URLSearchParams(location.search);
  // An explicit ?repo= wins (legacy ?project= still honored); otherwise keep
  // the user's last picker choice across closes/reloads, then use the sidebar
  // filter. The configured default is applied once `/repos` resolves.
  const repoParam = params.get("repo") ?? params.get("project");
  const repo = repoParam || lastSelectedRepo() || filteredRepo() || "";
  return {
    mode: params.get("mode") === "ask" ? ("ask" as const) : ("code" as const),
    prompt: params.get("prompt") || "",
    branch: params.get("branch") || "",
    repo,
  };
}

/** Fallback branch name from the prompt when Haiku's auto-suggest hasn't landed. */
function slugifyBranch(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .slice(0, 6)
    .join("-");
  return slug || "new-session";
}

export function NewSession({ onBack, send, addHandler, connected, prefillPrompt, forceMode, workspaceId, forceRepo, forceBranch, onCreateStarted }: Props) {
  const auth = useAuthStatus();
  const desktopShell =
    (window as { os1?: { desktop?: boolean } }).os1?.desktop === true ||
    navigator.userAgent.includes("Electron/");
  const [prefill] = useState(readPrefill);
  const [mode, setMode] = useState<"ask" | "code" | "scratch">(forceMode || prefill.mode);
  // The desktop app's local bridge merges local and hosted sessions. Hosted is
  // deliberately the default; local execution is still experimental and must
  // be selected explicitly for each palette lifetime.
  const [createTarget, setCreateTarget] = useState<"cloud" | "local">(
    auth?.local || desktopShell ? "cloud" : "local",
  );
  useEffect(() => {
    if (auth?.local || desktopShell) setCreateTarget("cloud");
  }, [auth?.local, desktopShell]);
  const cloudTarget = auth?.local === true && createTarget === "cloud";
  // In a workspace, default to its shared repo; else the prefill/filter repo.
  const [repo, setRepo] = useState(forceRepo || prefill.repo);
  const [repos, setRepos] = useState<RepoOption[]>([]);
  const [configuredDefaultRepo, setConfiguredDefaultRepo] = useState("");
  const [addRepoOpen, setAddRepoOpen] = useState(false);
  const locallyAddedRepos = useRef(new Map<string, { id: string; label: string }>());
  const localReposLoaded = useRef(false);
  useEffect(() => {
    let live = true;
    fetchRepos(cloudTarget).then((items) => {
      if (!live) return;
      const options: RepoOption[] = items.map((item) => ({
        id: item.id,
        label: item.label || item.id,
        default: item.default,
      }));
      if (!cloudTarget) {
        for (const added of locallyAddedRepos.current.values()) {
          if (!options.some((item) => item.id === added.id)) options.push(added);
        }
      }
      localReposLoaded.current = true;
      setRepos(options);
      setConfiguredDefaultRepo(
        options.find((item) => item.default)?.id || options[0]?.id || "",
      );
    }).catch(() => {
      if (!live) return;
      localReposLoaded.current = true;
      setRepos(cloudTarget ? [] : [...locallyAddedRepos.current.values()]);
    });
    return () => {
      live = false;
    };
  }, [cloudTarget]);
  useEffect(() => {
    setRepo((current) => {
      if (forceRepo && repos.some((item) => item.id === forceRepo)) return forceRepo;
      if (repos.some((item) => item.id === current)) return current;
      return configuredDefaultRepo;
    });
  }, [configuredDefaultRepo, forceRepo, repos]);
  const [worktrees, setWorktrees] = useState<Worktree[]>([]);
  // In a workspace, default to a sibling's branch so the new session reuses its
  // worktree; the user can still switch to "New branch" to fork a fresh one.
  const [selectedWorktree, setSelectedWorktree] = useState(forceBranch || "__new__");
  const [newBranch, setNewBranch] = useState(prefill.branch);
  // An explicit prefill (Home hand-off, deep link) wins; otherwise restore the
  // stored draft so closing the palette / navigating away doesn't lose a
  // half-written task. Mirrored back below; cleared on session_created.
  const [prompt, setPrompt] = useState(
    prefillPrompt || prefill.prompt || loadDraft("new-session").text,
  );
  // Whether the user has hand-edited the branch field. Once true we stop
  // auto-suggesting so we never clobber what they typed. A prefilled branch
  // (deep link) counts as already-owned.
  const [branchEdited, setBranchEdited] = useState(!!prefill.branch);
  const [suggestingBranch, setSuggestingBranch] = useState(false);
  const [images, setImages] = useState<string[]>(() => loadDraft("new-session").images);
  const [files, setFiles] = useState<FileAttachment[]>(() => loadDraft("new-session").files);
  const [creating, setCreating] = useState(false);
  // Which edges of the prompt have content beyond them, and so earn a hairline.
  const [edges, setEdges] = useState({ top: false, bottom: false });
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [model, setModel] = useState(""); // "" = default
  // Footer controls from the palette design. effort is persisted on the new
  // session and enforced per run (Claude effort / Codex modelReasoningEffort).
  const [effort, setEffort] = useState("high");
  // Pinned provider account for the new session ("" = auto pool pick).
  // Soft pin: the runner prefers it and falls back on exhaustion. Only
  // meaningful for Anthropic/OpenAI subscription-backed models.
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<ProviderAccountOption[]>([]);
  useEffect(() => {
    fetchProviderAccounts(cloudTarget).then(setAccounts).catch(() => {});
  }, [cloudTarget]);
  const effectiveNewModel = model || defaultModel;
  const accountProvider = models.find((item) => item.id === effectiveNewModel)?.accountProvider;
  // A pin belongs to one provider pool. Drop it when the selected model moves
  // to another family so an opaque id is never reinterpreted.
  useEffect(() => {
    const account = accounts.find((item) => item.id === accountId);
    if (accountId && account?.provider !== accountProvider) setAccountId("");
  }, [accountProvider, accountId, accounts]);
  // What a create does with the view behind the palette. Chosen from the
  // Create split-button's dropdown; the primary button reflects the choice.
  const [createAction, setCreateAction] = useState<CreateAction>("open");
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const createSplitRef = useRef<HTMLDivElement>(null);
  const isPhone = useIsPhone();
  // "Send messages with" (Settings → Preferences). The session composer honors it,
  // so this field has to as well — otherwise Enter silently does nothing here
  // while the Create button advertises ↩.
  const [sendKey, setSendKey] = useState(getSendKeyPref);
  useEffect(() => onSendKeyChanged(() => setSendKey(getSendKeyPref())), []);

  // Sandbox provider picker: the complete model engine + workspace run in the
  // selected environment; native Codex is the sole host-only family.
  // "" = This machine (host, no sandbox); otherwise an explicit provider id
  // sent as the create's `sandbox` string. Options come from
  // /api/sandbox/status (fetched once when the palette opens) — only
  // configured providers are offered, and the whole control hides when the
  // server has no sandbox config or the kill switch is on.
  const [sandboxProvider, setSandboxProvider] = useState("");
  const [sandboxStatus, setSandboxStatus] = useState<SandboxStatusInfo | null>(null);
  const sandboxSelectionTouched = useRef(false);
  useEffect(() => {
    fetchSandboxStatus(getCurrentUser())
      .then((status) => {
        setSandboxStatus(status);
		// This machine remains the clear default. Sandbox configuration belongs
		// behind the explicit Sandbox choice, never in an invisible default.
		if (!sandboxSelectionTouched.current) setSandboxProvider("");
      })
      .catch(() => {});
  }, []);
  const sandboxChoices = sandboxStatus?.connections?.length
    ? sandboxStatus.connections
        .filter((connection) => connection.state === "ready")
        .map((connection) => ({ id: connection.provider, note: undefined as string | undefined }))
    : (sandboxStatus?.providers || []).filter((p) => p.configured && p.certified);
  const selectedSandboxAvailable =
    !sandboxProvider || sandboxChoices.some((choice) => choice.id === sandboxProvider);
  const visibleSandboxChoices =
    sandboxProvider && !selectedSandboxAvailable
      ? [
          {
            id: sandboxProvider,
					note: "Unavailable. Choose This machine or a ready Sandbox before creating.",
          },
          ...sandboxChoices,
        ]
      : sandboxChoices;
  const showSandboxPicker = !!sandboxStatus;
  const sandboxLabel = (id: string) =>
		id === "" ? "This machine" : id === "docker" ? "Docker" : id === "daytona" ? "Daytona" : id === "e2b" ? "E2B" : id === "box" ? "Box" : id === "modal" ? "Modal" : id === "microvm" ? "Local MicroVM" : id === "lambda-microvm" ? "AWS Lambda MicroVM" : id;

  // Provider-independent family check, driven by the same server list the
  // create path enforces.
  const effectiveModelId = model || defaultModel;
  const effectiveModelProvider =
    models.find((m) => m.id === effectiveModelId)?.provider ?? "claude";
  const modelFamily = (sandboxStatus?.modelFamilies || []).find(
    (f) => f.match.provider === effectiveModelProvider,
  );
  // Engine switcher (advanced): flips the selected model between execution
  // engines while keeping the same underlying model when both serve it
  // (opencode/anthropic/claude-opus-5 ⇄ pi/anthropic/claude-opus-5). Only
  // rendered when a second engine is actually configured (pi models present
  // in /api/models); legacy native ids dispatch on opencode, so they count
  // as that engine here. The model menu still lists every engine's models —
  // this is a quick toggle, not a filter.
  const engineChoices = models.some((m) => m.provider === "pi")
    ? (["opencode", "pi"] as const)
    : null;
  const currentEngine = effectiveModelProvider === "pi" ? "pi" : "opencode";
  const engineLabel = (e: string) => (e === "pi" ? "Pi" : "OpenCode");
  const switchEngine = (target: "opencode" | "pi") => {
    if (target === currentEngine) return;
    const tail = effectiveModelId.split("/").pop();
    const candidates = models.filter((m) => m.provider === target);
    const match =
      candidates.find((m) => m.id.split("/").pop() === tail) ||
      (target === "opencode" && candidates.some((m) => m.id === defaultModel)
        ? candidates.find((m) => m.id === defaultModel)
        : undefined) ||
      candidates[0];
    if (match) setModel(match.id);
  };

  const sandboxModelWarning = (() => {
    if (sandboxProvider && !selectedSandboxAvailable) {
		return `${sandboxLabel(sandboxProvider)} is unavailable. Choose This machine or a ready Sandbox.`;
    }
	    if (!sandboxProvider || !modelFamily) return null;
    if (modelFamily.sandboxable) return null;
    return (
		`${modelFamily.label} models can't run in a Sandbox` +
      (modelFamily.hint ? ` · ${modelFamily.hint}` : "") +
      "."
    );
  })();

  // Brain-inside remote/MicroVM sessions all adopt a full-runner prewarm.
  // Strictly fire-and-forget: failure must never surface or block typing.
  const isRemoteSandbox = sandboxProvider === "daytona" || sandboxProvider === "e2b" || sandboxProvider === "box" || sandboxProvider === "modal" || sandboxProvider === "lambda-microvm";
  const shouldPrewarm = isRemoteSandbox || sandboxProvider === "microvm";
  const [sandboxWarmed, setSandboxWarmed] = useState(false);
  const lastPrewarmAtRef = useRef(0);
  useEffect(() => {
    // Provider/repo switch: allow an immediate re-fire for the new key.
    lastPrewarmAtRef.current = 0;
    setSandboxWarmed(false);
  }, [sandboxProvider, repo]);
  useEffect(() => {
    if (!shouldPrewarm || !prompt.trim() || creating) return;
    if (Date.now() - lastPrewarmAtRef.current < 60_000) return;
    lastPrewarmAtRef.current = Date.now();
    requestSandboxPrewarm(sandboxProvider, repo, getCurrentUser())
      .then((r) => setSandboxWarmed(r.state === "ready"))
      .catch(() => {});
  }, [prompt, shouldPrewarm, sandboxProvider, repo, creating]);

  // MCP servers: empty by default (minimal context), users can opt in for
  // specific ones. The list comes from mcp-config.json via the connections
  // API so it never drifts from what's actually installed.
  const [selectedMcpServers, setSelectedMcpServers] = useState<string[]>([]);
  const [availableMcpServers, setAvailableMcpServers] = useState<string[]>([]);
  useEffect(() => {
    fetchConnections()
      .then((c) => setAvailableMcpServers((c.mcpServers || []).map((s) => s.name)))
      .catch(() => {});
  }, []);
  function toggleMcpServer(name: string, on: boolean) {
    setSelectedMcpServers((prev) =>
      on ? [...prev, name] : prev.filter((m) => m !== name),
    );
  }

  // "@"-mention file autocomplete against the selected repo's repo (no
  // session exists yet, so search by repo).
  const promptRef = useRef<HTMLTextAreaElement>(null);
  // Hidden <input type="file"> driven by the "Add file" button — the mobile
  // path, since there's no clipboard paste there.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mentions = useFileMentions({
    value: prompt,
    onChange: setPrompt,
    textareaRef: promptRef,
    mentionFetch: async (q) => [
      ...peopleMentionMatches(q),
      ...(await fetchFileMentions(q, undefined, repo)),
    ],
    skillsFetch: (q) => fetchSkillMentions(q, undefined, repo),
  });

  // (The prompt is focused on open by Modal.Content's initialFocus — a mount
  // effect here would run a frame before the dialog's popup exists.)

  // Auto-grow the prompt so a long draft isn't crammed into the resting height.
  // CSS min-height/max-height clamp the field, so it rests tall, grows with the
  // text, and only starts scrolling once it hits the cap.
  useEffect(() => {
    const el = promptRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [prompt]);

  // Keep the draft store in sync so a dismissed palette can restore the work.
  useEffect(() => {
    saveDraft("new-session", { text: prompt, images, files });
  }, [prompt, images, files]);

  // Close the Create dropdown on an outside click.
  useEffect(() => {
    if (!createMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (createSplitRef.current && !createSplitRef.current.contains(e.target as Node)) {
        setCreateMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [createMenuOpen]);

  // Step through the Create options without leaving the prompt: the primary
  // button's label is the feedback, and an open dropdown moves its check. Only
  // the action group cycles — hosted vs local is a separate axis of the same
  // menu. This rides on the dialog rather than on window because Base UI's
  // popup stops keydown propagation before it leaves the card, which is also
  // why it can use a chord the rest of the app is free to bind elsewhere.
  function cycleCreateAction(e: React.KeyboardEvent) {
    if (creating) return;
    if (!(e.metaKey || e.ctrlKey) || !e.altKey || e.shiftKey) return;
    const step = e.code === "ArrowDown" ? 1 : e.code === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = CREATE_ACTIONS.indexOf(createAction);
    setCreateAction(
      CREATE_ACTIONS[(at + step + CREATE_ACTIONS.length) % CREATE_ACTIONS.length],
    );
  }

  useEffect(() => {
    fetchModels(cloudTarget)
      .then((m) => {
        setModels(m.models);
        setDefaultModel(m.default);
        setModel((current) => {
          if (current) {
            return m.models.some((item) => item.id === current) ? current : "";
          }
          // Untouched picker: preselect the user's own default-model pref
          // (Settings → Preferences) when it's set and still selectable; "" (no
          // preference) keeps the workspace default.
          const pref = getDefaultModelPref();
          return pref && m.models.some((item) => item.id === pref) ? pref : "";
        });
      })
      .catch(() => {});
  }, [cloudTarget]);

  // Worktrees are per-repo; refetch and reset the selection when it changes.
  // Inside a workspace, snap back to the shared sibling branch, not "New branch".
  useEffect(() => {
    setSelectedWorktree(forceBranch || "__new__");
    if (!repo) {
      setWorktrees([]);
      return;
    }
    fetchWorktrees(repo)
      .then(setWorktrees)
      .catch(() => setWorktrees([]));
  }, [repo, forceBranch]);

  // Auto-suggest a branch name from the prompt (debounced Haiku call), but only
  // while the field is "ours" — once the user types in it (branchEdited) we back
  // off. The latest-request guard drops a stale response if the user starts
  // editing the branch while a suggestion is in flight.
  const branchEditedRef = useRef(branchEdited);
  branchEditedRef.current = branchEdited;
  const suggestSeqRef = useRef(0);
  useEffect(() => {
    if (mode !== "code" || selectedWorktree !== "__new__" || branchEdited) return;
    if (prompt.trim().length < 10) return;
    const seq = ++suggestSeqRef.current;
    const t = setTimeout(async () => {
      setSuggestingBranch(true);
      const branch = await suggestBranch(prompt.trim());
      setSuggestingBranch(false);
      // Drop if superseded by a newer prompt or the user grabbed the field.
      if (seq !== suggestSeqRef.current || branchEditedRef.current) return;
      if (branch) setNewBranch(branch);
    }, 700);
    return () => clearTimeout(t);
  }, [prompt, mode, selectedWorktree, branchEdited]);

  // Registered from mount and gated on a ref set synchronously in handleCreate:
  // session_created is announced before the worktree even boots, so it can
  // arrive before a `creating`-gated effect would have registered this handler
  // — the palette would miss it (stuck on "creating", draft never cleared).
  const creatingRef = useRef(false);
  // A successful create replaces the surface behind this dialog. Returning
  // focus to the now-removed opener makes Base UI advance to the new session's
  // "+" button, so Enter immediately creates another session. Cancelling still
  // restores focus normally.
  const createdRef = useRef(false);
  useEffect(() => {
    return addHandler((msg) => {
      if (!creatingRef.current) return;
      if (msg.type === "error") {
        creatingRef.current = false;
        setError(msg.message);
        setCreating(false);
      } else if (msg.type === "session_created") {
        creatingRef.current = false;
        // The prompt was consumed — drop the stored draft either way.
        clearDraft("new-session");
        // "Create more" stays in the palette and resets for the next task (App
        // still navigates into the created session behind the overlay). The
        // other two close it: "Create" lets App drop us into the new session,
        // "Create in background" leaves the view we came from in place.
        if (createAction === "more") {
          setCreating(false);
          setPrompt("");
          setImages([]);
          setFiles([]);
          setNewBranch("");
          setBranchEdited(false);
          setError(null);
          promptRef.current?.focus();
        } else {
          // Only an "open" create replaces the surface behind the palette, so
          // only it declines to restore focus. In the background it is the
          // opener you pressed that you are returning to.
          createdRef.current = createAction === "open";
          onBack();
        }
      }
    });
  }, [addHandler, createAction]);

  async function addAttachments(picked: FileList | File[]) {
    const { images: imgs, files: fls, rejected } = await splitAttachments(picked);
    if (imgs.length) setImages((prev) => [...prev, ...imgs]);
    if (fls.length) setFiles((prev) => [...prev, ...fls]);
    if (rejected.length) alert(`Couldn't attach:\n${rejected.join("\n")}`);
  }

  function handlePaste(e: React.ClipboardEvent) {
    const imgs = imageFilesFromPaste(e);
    if (imgs.length) {
      e.preventDefault();
      void addAttachments(imgs);
    }
  }

  function handleCreate() {
    if (!canCreate) return;
    const branch =
      selectedWorktree === "__new__"
        ? newBranch.trim() || slugifyBranch(prompt)
        : selectedWorktree;

    setError(null);
    // With "Create more" off, App tears down the palette when the
    // session_created event arrives (and drops us into the new session).
    setCreating(true);
    creatingRef.current = true;
    // Workspace linkage: scoped to an existing workspace (the tab/sidebar +),
    // the session joins it — sharing its worktree when reusing the sibling branch,
    // stacking a fresh worktree off it for a new branch. Unscoped, the default
    // is a brand-new Workspace + first Session created together.
    const worktreeMode =
      mode === "ask" ? "ask" : mode === "code" && selectedWorktree === "__new__" ? "stack" : "share";
    onCreateStarted?.({
      prompt: prompt.trim(),
      mode,
      repo,
      branch: mode === "code" ? branch : null,
      ...(workspaceId ? { workspaceId } : {}),
      ...(model ? { model } : {}),
      ...(images.length ? { images } : {}),
      // App navigates into a created session by default; this asks it not to.
      ...(createAction === "background" ? { background: true } : {}),
    });
    send({
      type: "create_session",
      ...(auth?.local && createTarget === "cloud" ? { cloud: true } : {}),
      mode,
      repo,
      ...(workspaceId
        ? { workspaceId: workspaceId, worktreeMode }
        : { createWorkspace: {} }),
      branch: mode === "code" ? branch : "",
      prompt: prompt.trim(),
      user: getCurrentUser(),
      ...(model ? { model } : {}),
      effort,
      ...(accountProvider && accountId ? { accountId } : {}),
      // Once defaults have loaded, Host is an explicit override ("local") —
      // omitting the field would make the server re-apply the user's default.
		...(sandboxStatus ? { sandbox: sandboxProvider || "local" } : {}),
      ...(selectedMcpServers.length ? { mcpServers: selectedMcpServers } : {}),
      ...(images.length ? { images } : {}),
      ...(files.length
        ? {
            files: files.map((f) =>
              f.path ? { name: f.name, path: f.path } : { name: f.name, dataUrl: f.dataUrl },
            ),
          }
        : {}),
    });
  }

  const canCreate =
    !creating &&
    connected &&
		(!!repo || mode === "scratch") &&
    // Unsupported model × environment combo: the server would reject the
    // create with the same message (resolveRequestedSandbox) — block here so
    // the wall is discovered before submit, not after.
    !sandboxModelWarning &&
    (prompt.trim() || images.length > 0 || files.length > 0) &&
    (mode === "ask" || mode === "scratch" || selectedWorktree !== "");

  // "Create from…" picks the base a code session branches off. Ask is not an
  // option here: it is a mode, not a base — it cuts no worktree at all — so it
  // lives with the footer's other tools and this picker steps aside for it.
  const createFromLabel = selectedWorktree === "__new__" ? "New branch" : selectedWorktree;
  const createFromOptions = [
    {
      value: "__new__",
      label: workspaceId && forceBranch
        ? `New stacked branch (off ${forceBranch})`
        : "New branch",
    },
    ...worktrees.map((wt) => ({ value: wt.branch, label: wt.branch })),
  ];

  // The prompt grows naturally; once the palette reaches its viewport cap the
  // BODY becomes the single scroller, carrying attachments with the text. Each
  // edge's hairline marks content continuing beyond the visible area.
  function updatePromptFade(el: HTMLDivElement) {
    // Each hairline earns its place only while content sits beyond that edge:
    // a short prompt that fits gets a clean, undivided card.
    const hidden = el.scrollHeight - el.clientHeight;
    const next = {
      top: el.scrollTop > 1,
      bottom: hidden > 1 && hidden - el.scrollTop > 1,
    };
    setEdges((prev) => (prev.top === next.top && prev.bottom === next.bottom ? prev : next));
  }

  // Both effects below key on the scroller NODE rather than on a render pass.
  // Base UI mounts the popup's children in a later commit than the one that
  // opens the dialog, so an effect keyed on `prompt` (or on `open`) has already
  // run and bailed on a null ref by the time the textarea exists. That left a
  // prefilled or restored prompt clipped at its 132px minimum and unscrollable.
  const [promptBody, setPromptBody] = useState<HTMLDivElement | null>(null);
  const attachPromptBody = React.useCallback(
    (node: HTMLDivElement | null) => {
      mentions.inputWrapRef.current = node;
      setPromptBody(node);
    },
    [mentions.inputWrapRef],
  );

  useLayoutEffect(() => {
    const textarea = promptRef.current;
    if (!textarea || !promptBody) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
    updatePromptFade(promptBody);
  }, [promptBody, prompt, images.length, files.length]);

  useEffect(() => {
    if (!promptBody) return;
    const observer = new ResizeObserver(() => updatePromptFade(promptBody));
    observer.observe(promptBody);
    return () => observer.disconnect();
  }, [promptBody]);

  // One frame closed so the palette animates in; App mounts us already-open.
  const open = useEnterOnMount();

  // Ask mode's surface: the session composer's own ask numbers, so one mode is
  // one strength wherever you meet it. Only the base differs — mixed into
  // `transparent` rather than an opaque colour, because the palette is glass
  // and an opaque tint would paint the blur out. The parts are handed to the
  // two pseudo-element layers as custom properties.
  const askSurface = tintedSurfaceParts("var(--green)", 7, 6, 30, "transparent");
  const askSurfaceStyle = {
    "--palette-ask-bg": askSurface.flat,
    "--palette-ask-hatch": askSurface.hatch,
    "--palette-ask-border": askSurface.border,
  } as React.CSSProperties;

  return (
    <Modal.Root
      open={open}
      // Escape and outside presses both land here. App's global Esc-closes-a-
      // palette shortcut can't double-fire: Base UI stops the keydown before it
      // reaches window, so this is the only close (which matters — closePalette
      // also pops a /new deep link off history).
      onOpenChange={(next) => {
        if (!next) onBack();
      }}
      // Focus is trapped, but the page is neither inerted nor scroll-locked: the
      // "@"-mention popup portals to <body>, and inerting would leave it dead.
      modal="trap-focus"
      // Mid-create the palette isn't dismissable. An open mention popup also
      // owns the next click — it lives outside the dialog, so pressing it would
      // otherwise read as an outside press and close the whole palette.
      disablePointerDismissal={creating || mentions.open}
    >
      <Modal.Content
        variant="palette"
        className={cn(
          "max-h-[calc(89dvh-1rem)] max-[560px]:max-h-[calc(93dvh-1rem)]",
          ASK_SURFACE,
          mode === "ask" && "before:opacity-100 after:opacity-100",
        )}
        style={askSurfaceStyle}
        aria-label="New session"
        onKeyDown={cycleCreateAction}
        // The prompt, not the repo picker Base UI would otherwise land on as the
        // first tabbable.
        initialFocus={promptRef}
        finalFocus={() => !createdRef.current}
      >
        {/* Header: repo (left) · create-from (right). The repo picker is
            always visible — on phones the create-from picker hides until the
            options toggle in the footer opens it. */}
        <div className={cn(HEADER, edges.top && EDGE_DIVIDER)}>
          <PaletteSelect
            className={TRIGGER_STRONG}
            title="Repository"
            value={mode === "scratch" ? SCRATCH_REPO_VALUE : repo}
            options={[
              ...repos.map((p) => ({
                value: p.id,
                label: p.label,
                icon: <RepoTile name={p.id} />,
              })),
              {
                value: SCRATCH_REPO_VALUE,
                label: "Scratch · no repo",
                icon: <IconFile size={20} />,
              },
              ...(auth?.local && createTarget === "local"
                ? [
                    {
                      value: ADD_REPO_VALUE,
                      label: "Add repo…",
                      icon: <IconFolderPlus size={20} />,
                    },
                  ]
                : []),
            ]}
            onChange={(nextRepo) => {
              if (nextRepo === SCRATCH_REPO_VALUE) {
                setMode("scratch");
                return;
              }
              if (nextRepo === ADD_REPO_VALUE) {
                setAddRepoOpen(true);
                return;
              }
              if (mode === "scratch") setMode("code");
              setRepo(nextRepo);
              rememberSelectedRepo(nextRepo);
            }}
            disabled={creating}
            ariaLabel="Repository"
            isPhone={isPhone}
          >
            {mode === "scratch" ? (
              <IconFile className="shrink-0" size={20} />
            ) : (
              <RepoTile name={repo} />
            )}
            <span className="truncate">
              {mode === "scratch"
                ? "Scratch · no repo"
                : repos.find((p) => p.id === repo)?.label || repo || "No repositories"}
            </span>
            <IconChevronDown className={CHEVRON} size={22} />
          </PaletteSelect>

          {mode === "code" && (
          <PaletteSelect
            className={TRIGGER}
            title="What to create from"
            value={selectedWorktree}
            options={createFromOptions}
            onChange={setSelectedWorktree}
            disabled={creating}
            ariaLabel="Create from"
            isPhone={isPhone}
            align="end"
          >
            <svg width="19" height="19" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="4" cy="4" r="1.7" stroke="currentColor" strokeWidth="1.3" />
              <circle cx="4" cy="12" r="1.7" stroke="currentColor" strokeWidth="1.3" />
              <circle cx="12" cy="5.5" r="1.7" stroke="currentColor" strokeWidth="1.3" />
              <path d="M4 5.7v4.6M4 8h4a4 4 0 004-4" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            <span className="truncate">{createFromLabel}</span>
            <IconChevronDown className={CHEVRON} size={22} />
          </PaletteSelect>
          )}
        </div>

        {auth?.local && (
          <AddRepoDialog
            open={addRepoOpen}
            onOpenChange={setAddRepoOpen}
            onAdded={(added) => {
              const next = { id: added.id, label: added.id };
              locallyAddedRepos.current.set(added.id, next);
              setRepos((current) => [
                ...(localReposLoaded.current ? current : []).filter((item) => item.id !== added.id),
                next,
              ]);
              setRepo(added.id);
              rememberSelectedRepo(added.id);
            }}
          />
        )}

        {/* Prompt */}
        <div
          className={BODY}
          onDrop={(e) => {
            if (e.dataTransfer?.files?.length) {
              e.preventDefault();
              void addAttachments(e.dataTransfer.files);
            }
          }}
          onDragOver={(e) => e.preventDefault()}
          onScroll={(e) => updatePromptFade(e.currentTarget)}
          ref={attachPromptBody}
        >
          {mentions.popup}
          <textarea
            ref={promptRef}
            className={TEXTAREA}
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value);
              queueMicrotask(mentions.sync);
            }}
            onKeyDown={(e) => {
              // ⌘/Ctrl+Enter creates whatever the send-key preference is.
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                handleCreate();
                return;
              }
              // The @/slash popup claims plain Enter to accept a suggestion.
              if (mentions.handleKeyDown(e)) return;
              // Otherwise the send key creates, exactly as it sends in the session
              // composer — including the unclosed-``` fence exception, so a
              // multi-line code block can still be typed into the first prompt.
              // Nothing to create yet? Let the newline land rather than eating
              // the keystroke.
              if (!isSendCombo(e, sendKey) || !canCreate) return;
              const caret = promptRef.current?.selectionStart ?? prompt.length;
              if (insideOpenFence(prompt, caret)) return;
              e.preventDefault();
              handleCreate();
            }}
            onKeyUp={mentions.sync}
            onClick={mentions.sync}
            onBlur={() => setTimeout(mentions.close, 120)}
            onPaste={handlePaste}
            // Ask sessions read and explain; they never touch the code. Asking
            // "what to work on" in that mode invites a prompt the session
            // cannot carry out.
            placeholder={
              mode === "ask" ? "What do you want to find out?" : "What do you want to work on?"
            }
            disabled={creating}
          />
          <ImageThumbs images={images} onRemove={(i) => setImages((p) => p.filter((_, idx) => idx !== i))} disabled={creating} />
          <FileChips files={files} onRemove={(i) => setFiles((p) => p.filter((_, idx) => idx !== i))} disabled={creating} />
        </div>

        {error && <div className={ERROR}>{error}</div>}
        {sandboxModelWarning && (
          <div className={ERROR} role="alert">
            {sandboxModelWarning}
          </div>
        )}

        {/* Footer toolbar */}
        <div className={cn(FOOTER, edges.bottom && EDGE_DIVIDER)}>
          <div className={FOOTER_LEFT}>
            <Tooltip label="Attach a file">
              <button
                type="button"
                className={FOOTER_ICON_BTN}
                onClick={() => fileInputRef.current?.click()}
                disabled={creating}
                aria-label="Attach a file"
              >
                <IconPaperclip size={20} />
              </button>
            </Tooltip>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files?.length) void addAttachments(e.target.files);
                e.target.value = "";
              }}
            />
            {/* Ask sits with the tools rather than in the header's base picker:
                it is a mode the session runs in, like the composer's note mode,
                not something to branch from. Scratch has no repo to read, so
                the toggle steps out there entirely. */}
            {mode !== "scratch" && !forceMode && (
              <Tooltip
                label={
                  mode === "ask"
                    ? "Ask mode on · reads the repo, changes nothing. Click to write code instead"
                    : "Ask mode · read-only on main, no branch"
                }
              >
                <button
                  type="button"
                  className={mode === "ask" ? ASK_BTN_ON : FOOTER_ICON_BTN}
                  onClick={() => setMode(mode === "ask" ? "code" : "ask")}
                  disabled={creating}
                  aria-pressed={mode === "ask"}
                  aria-label="Ask mode"
                >
                  <IconEye size={mode === "ask" ? 14 : 20} />
                  {mode === "ask" && "Ask"}
                </button>
              </Tooltip>
            )}
            {/* Rarely changed execution settings stay one level behind a single
                overflow button. Their current values remain visible in the
                submenu rows, while attachment stays one tap away. */}
            <Menu.Root>
              <Tooltip label="More options">
                <Menu.Trigger
                  type="button"
                  className={cn(
                    FOOTER_ICON_BTN,
						(sandboxProvider || currentEngine === "pi" || selectedMcpServers.length > 0) &&
                      paletteIconBtnOn,
                  )}
                  disabled={creating}
                  aria-label="More options"
                >
                  <IconDotsHorizontal size={20} />
                </Menu.Trigger>
              </Tooltip>
              <Menu.Popup
                align="start"
                sideOffset={6}
                className="min-w-[260px] max-w-[min(360px,calc(100vw-1rem))]"
              >
                {showSandboxPicker && (
                  <Menu.SubmenuRoot>
                    <Menu.SubmenuTrigger className="justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <IconBox className="shrink-0 text-dim" size={20} />
                        <span className="truncate">Sandbox</span>
                      </span>
                      <span className="flex flex-none items-center gap-1 text-dim">
                        {sandboxLabel(sandboxProvider)}
                        {sandboxWarmed && shouldPrewarm && (
                          <span className="text-faint">· ready</span>
                        )}
                        <IconChevronRight className="shrink-0 text-faint" size={17} />
                      </span>
                    </Menu.SubmenuTrigger>
                    <Menu.Popup className="max-w-[min(340px,calc(100vw-1rem))]">
                      {[{ id: "", note: undefined as string | undefined }, ...visibleSandboxChoices].map(
                        (opt) => {
                          const selected = sandboxProvider === opt.id;
                          return (
                            <Menu.Item
                              key={opt.id || "host"}
                              onClick={() => {
                                sandboxSelectionTouched.current = true;
                                setSandboxProvider(opt.id);
                              }}
                              className="items-start"
                            >
                              <IconCheck
                                size={17}
                                className={`mt-0.5 shrink-0 text-dim ${selected ? "" : "invisible"}`}
                              />
                              <span className="flex min-w-0 flex-col gap-0.5">
                                <span>
                                  {sandboxLabel(opt.id)}
                                </span>
                                {opt.note && (
                                  <span className="whitespace-normal text-[11px] font-medium leading-snug text-faint">
                                    {opt.note}
                                  </span>
                                )}
                              </span>
                            </Menu.Item>
                          );
                        },
                      )}
                    </Menu.Popup>
                  </Menu.SubmenuRoot>
                )}
                {engineChoices && (
                  <Menu.SubmenuRoot>
                    <Menu.SubmenuTrigger className="justify-between gap-3">
                      <span className="flex min-w-0 items-center gap-2">
                        <IconStack className="shrink-0 text-dim" size={20} />
                        <span className="truncate">Engine</span>
                      </span>
                      <span className="flex flex-none items-center gap-1 text-dim">
                        {engineLabel(currentEngine)}
                        <IconChevronRight className="shrink-0 text-faint" size={17} />
                      </span>
                    </Menu.SubmenuTrigger>
                    <Menu.Popup className="max-w-[min(300px,calc(100vw-1rem))]">
                      {engineChoices.map((e) => {
                        const selected = currentEngine === e;
                        return (
                          <Menu.Item key={e} onClick={() => switchEngine(e)} className="items-start">
                            <IconCheck
                              size={17}
                              className={`mt-0.5 shrink-0 text-dim ${selected ? "" : "invisible"}`}
                            />
                            <span className="flex min-w-0 flex-col gap-0.5">
                              <span>{engineLabel(e)}</span>
                              <span className="whitespace-normal text-[11px] font-medium leading-snug text-faint">
                                {e === "pi"
                                  ? "pi.dev harness, in-process · native mid-turn steering"
                                  : "Default engine · server pools, sandboxes, detached runs"}
                              </span>
                            </span>
                          </Menu.Item>
                        );
                      })}
                    </Menu.Popup>
                  </Menu.SubmenuRoot>
                )}
                <Menu.SubmenuRoot>
                  <Menu.SubmenuTrigger className="justify-between gap-3">
                    <span className="flex min-w-0 items-center gap-2">
                      <IconConnections className="shrink-0 text-dim" size={20} />
                      <span className="truncate">Connected services</span>
                    </span>
                    <span className="flex flex-none items-center gap-1 text-dim">
                      {selectedMcpServers.length ? `${selectedMcpServers.length} on` : "None"}
                      <IconChevronRight className="shrink-0 text-faint" size={17} />
                    </span>
                  </Menu.SubmenuTrigger>
                  <Menu.Popup className="max-w-[min(360px,calc(100vw-1rem))]">
                    {availableMcpServers.length === 0 && (
                      <Menu.Item disabled className="text-faint">
                        No services available
                      </Menu.Item>
                    )}
                    {availableMcpServers.map((mcp) => {
                      const checked = selectedMcpServers.includes(mcp);
                      return (
                        <Menu.CheckboxItem
                          key={mcp}
                          checked={checked}
                          closeOnClick={false}
                          onCheckedChange={(on) => toggleMcpServer(mcp, on)}
                          className={cn("justify-between gap-3", checked && "bg-hover")}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <IconTile name={mcp} size={20} />
                            <span className="min-w-0 truncate">{displayName(mcp)}</span>
                          </span>
                          {checked && <IconCheck className="shrink-0 text-dim" size={17} />}
                        </Menu.CheckboxItem>
                      );
                    })}
                  </Menu.Popup>
                </Menu.SubmenuRoot>
              </Menu.Popup>
            </Menu.Root>
          </div>

          <div className={FOOTER_RIGHT}>
            {/* Always visible — on phones too, so a non-default (dumber) model
                is never silently in effect. */}
            <ModelEffortSelect
              className={MODEL_PILL}
              title="Model and reasoning effort"
              models={models}
              defaultModel={defaultModel}
              model={model}
              onModelChange={setModel}
              effort={effort}
              onEffortChange={setEffort}
              // Account pinning is shown for models backed by a configured
              // Claude or Codex account pool.
              accounts={accountProvider && accounts.length > 0 ? accounts : undefined}
              accountId={accountId}
              onAccountChange={setAccountId}
              disabled={creating}
            />
            <VoiceInput
              className={FOOTER_ICON_BTN}
              disabled={creating}
              onText={(t) => {
                setPrompt((prev) => (prev.trim() ? `${prev.replace(/\s+$/, "")} ${t}` : t));
                promptRef.current?.focus();
              }}
            />

            <div className={CREATE_SPLIT} ref={createSplitRef}>
              <button
                className={CREATE_MAIN}
                onClick={handleCreate}
                disabled={!canCreate}
              >
                {creating
                  ? "Creating…"
                  : CREATE_LABELS[createAction][
                      (auth?.local || desktopShell) && createTarget === "local"
                        ? "local"
                        : "cloud"
                    ]}
                {/* The hint has to match the preference — a bare ↩ next to a
                    field that only creates on ⌘↩ is what made Enter look
                    broken in the first place. */}
                {sendKey === "mod-enter" ? (
                  <span className={`${CREATE_KBD} mx-0 phone:hidden text-xs`}>
                    {MOD_ENTER_GLYPH}
                  </span>
                ) : (
                  /* Snug the return glyph up to the label and nudge it off the
                     button edge. "Create more" is a desktop workflow, so the
                     hint goes away with the caret on phones. */
                  <IconReturn
                    className={`${CREATE_KBD} -mx-[3px] phone:hidden`}
                    size={20}
                  />
                )}
              </button>
              {/* The tooltip is where the cycle shortcut is taught: the caret
                  is the only thing on screen that says these options exist. */}
              <Tooltip label="Create options" shortcut={CYCLE_SHORTCUT}>
              <button
                type="button"
                className={`${CREATE_CARET} ${
                  // Keep the caret usable (to preview modes) even before a
                  // prompt is typed, and while its menu is open.
                  createMenuOpen || !canCreate
                    ? "cursor-pointer opacity-100"
                    : "disabled:cursor-default disabled:opacity-40"
                }`}
                onClick={() => setCreateMenuOpen((v) => !v)}
                disabled={creating}
                aria-haspopup="menu"
                aria-expanded={createMenuOpen}
                aria-label="Create options"
              >
                <IconChevronDown
                  className={`transition-transform ${createMenuOpen ? "rotate-180" : ""}`}
                  size={22}
                />
              </button>
              </Tooltip>
              {createMenuOpen && (
                <div className={CREATE_MENU} role="menu">
                  {auth?.local && (
                    <>
                      {[
                        { target: "cloud" as const, title: "Create", desc: "Run on the hosted instance" },
                        { target: "local" as const, title: "Create locally", desc: "Experimental - run on this Mac" },
                      ].map((opt) => (
                        <button
                          key={opt.target}
                          type="button"
                          role="menuitemradio"
                          aria-checked={createTarget === opt.target}
                          className={CREATE_MENU_ITEM}
                          onClick={() => {
                            setCreateTarget(opt.target);
                            setCreateMenuOpen(false);
                          }}
                        >
                          <IconCheck
                            className="mt-px shrink-0 text-dim"
                            size={22}
                            style={{ visibility: createTarget === opt.target ? "visible" : "hidden" }}
                          />
                          <span className="flex min-w-0 flex-col gap-px">
                            <span className="text-label font-semibold">{opt.title}</span>
                            <span className="text-meta text-dim">{opt.desc}</span>
                          </span>
                        </button>
                      ))}
                      <div className="my-1 border-t border-line" />
                    </>
                  )}
                  {[
                    { action: "open" as const, title: "Create", desc: "Open the new session" },
                    {
                      action: "background" as const,
                      title: "Create in background",
                      desc: "Stay where you are",
                    },
                    { action: "more" as const, title: "Create more", desc: "Stay here to start another" },
                  ].map((opt) => (
                    <button
                      key={opt.action}
                      type="button"
                      role="menuitemradio"
                      aria-checked={createAction === opt.action}
                      className={CREATE_MENU_ITEM}
                      onClick={() => {
                        setCreateAction(opt.action);
                        setCreateMenuOpen(false);
                      }}
                    >
                      <IconCheck
                        className="mt-px shrink-0 text-dim"
                        size={22}
                        style={{ visibility: createAction === opt.action ? "visible" : "hidden" }}
                      />
                      <span className="flex min-w-0 flex-col gap-px">
                        <span className="text-label font-semibold">{opt.title}</span>
                        <span className="text-meta text-dim">{opt.desc}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </Modal.Content>
    </Modal.Root>
  );
}
