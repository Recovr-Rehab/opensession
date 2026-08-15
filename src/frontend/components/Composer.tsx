import React, { useEffect, useMemo, useRef, useState } from "react";
import { useShortcutLabel } from "../hooks/useShortcutBindings";
import type { ModelOption, FileMention, ProviderAccountOption } from "../lib/api";
import { splitAttachments, imageFilesFromPaste, type FileAttachment } from "../lib/images";
import { loadDraft, onDraftsChanged, saveDraft } from "../lib/drafts";
import {
  composerHighlightHtml,
  composerMentionRanges,
  needsComposerHighlight,
} from "../lib/composer-highlight";
import { insertPastedSessionId } from "../lib/session-url";
import { usePeople } from "../lib/people";
import { ImageThumbs } from "./ImageThumbs";
import { FileChips } from "./FileChips";
import { QuoteContext } from "./QuoteContext";
import { ComposerContextChip } from "./ComposerContextChip";
import type { Quote } from "../lib/quotes";
import { useFileMentions } from "./useFileMentions";
import {
  IconArrowUp,
  IconReturn,
  IconPlus,
  IconPaperclip,
  IconAtSign,
  IconCrosshair,
  IconCheck,
  IconEye,
  IconNote,
  IconStopSquare,
} from "./icons";
import {
  composerBox,
  composerBoxExpanded,
  composerBoxMinimized,
  composerMenuAnchorLeft,
  composerMenuIcon,
  composerMenuItem,
  composerMenuPopup,
  composerMenuWidth,
  composerSend,
  composerSendDefault,
  composerSendMinimizedFill,
  composerSendQueue,
  composerSendSteer,
  composerSendStop,
  composerMentionSpacing,
  composerTextarea,
  composerTextareaPadding,
  composerTextareaPaddingMinimized,
  composerToolbar,
  composerToolbarMinimized,
  composerToolbarPill,
  composerToolbarSelect,
} from "../lib/composer-classes";
import { noAutofill } from "../lib/composer-autofill";
import {
  paletteIconBtn,
  paletteIconBtnRound,
  palettePill,
} from "../lib/palette-classes";
import { tintedSurface } from "../lib/tinted-surface";
import { cn } from "../ui/cn";
import { Tooltip } from "../ui/tooltip";
import { ContextMenu, MenuShortcut } from "../ui/menu";
import { Button } from "../ui/button";
import { Modal } from "../ui/modal";
import {
  insideOpenFence,
  isSendCombo,
  MOD_ENTER_GLYPH,
  sendKeyLabel,
} from "../lib/send-key";
import { getSendKeyPref, onSendKeyChanged } from "../lib/send-key-pref";
import { isApple } from "../lib/platform";
import { VoiceInput } from "./VoiceInput";
import {
  getBusySendPrefs,
  onBusySendChanged,
  setBusySendPref,
  type BusySendPref,
} from "../lib/busy-send-pref";
import { getVimModePref, onVimModeChanged } from "../lib/vim-pref";
import { useVimMode } from "../hooks/useVimMode";
import { useIsPhone } from "../hooks/useIsPhone";
import { motion, AnimatePresence } from "motion/react";
import { composerMorph, composerChipMotion } from "../ui/motion";
import { ModelEffortSelect, shortModelLabel } from "./ModelEffortSelect";
import type { SessionUsage } from "../lib/types";

interface Props {
  /**
   * Controlled draft text. Omit it (with `onChange`) to let the Composer own
   * the draft internally — the parent then receives the text via `onSend` and
   * stops re-rendering on every keystroke (the CommentableDiff draft-text
   * lesson). In uncontrolled mode the draft clears when `onSend` returns true
   * (i.e. the message was actually consumed).
   */
  value?: string;
  onChange?: (value: string) => void;
  /**
   * Uncontrolled mode only: persist the text draft under this key (lib/drafts)
   * so it survives the component unmounting — switching to another session,
   * workspace or view. Restored on mount; cleared when a send is consumed.
   * Controlled parents own their value and persist it themselves.
   */
  draftKey?: string;
  /** `steer` is set when the send should fold into the running turn right
   * away — the turn keeps running. Busy sends follow the per-user follow-up
   * preference (default queue: delivered after the run fully finishes);
   * ⌘/Ctrl+Enter or Command/Ctrl-click flips to the non-default action. */
  onSend: (
    text: string,
    opts?: { steer?: boolean },
  ) => boolean | void | Promise<boolean | void>;
  placeholder?: string;
  disabled?: boolean;
  /** Boolean, or a predicate on the current draft (for uncontrolled mode,
   * where the parent can't read the text). */
  sendDisabled?: boolean | ((text: string) => boolean);
  /** Shows on the send button tooltip when busy-queueing. */
  sendTitle?: string;
  busy?: boolean;
  onStop?: () => void;
  models: ModelOption[];
  defaultModel: string;
  /** Current model id; "" = default. */
  model: string;
  onModelChange: (model: string) => void;
  modelDisabled?: boolean;
  modelTitle?: string;
  /**
   * Reasoning-effort control (stowed as a compact pill, mirroring the new-session
   * palette). Forward-compatible: threaded through but not yet consumed
   * server-side. When omitted, the effort pill is hidden.
   */
  effort?: string;
  onEffortChange?: (effort: string) => void;
  fastMode?: boolean;
  onFastModeChange?: (fastMode: boolean) => void;
  /** Pinnable provider accounts + current pin for the model pill's account
   * submenu. Empty/omitted hides it. */
  accounts?: ProviderAccountOption[];
  accountId?: string;
  onAccountChange?: (accountId: string) => void;
  /**
   * Session goal (pinned via /goal, rides along with every prompt). When
   * `onSetGoal` is wired, a target button lets you set/clear it inline; it lights
   * up and grows a "Goal" label while a goal is pinned.
   */
  goal?: string | null;
  onSetGoal?: (goal: string | null) => void;
  /** Conversation usage shown inside the model menu. */
  usage?: SessionUsage;
  /** Extra row for the "+" menu, below the built-in ones. Same shape as
   *  `sendMenu`: render a `composerMenuItem` button and call `close()`
   *  when it's picked. */
  menuExtra?: (ctx: { close: () => void }) => React.ReactNode;
  /** Content visually attached to the composer above the draft field. */
  attached?: React.ReactNode;
  /**
   * One-shot draft injection (e.g. editing a queued message pulls its text
   * back into the composer). Applied when `seq` changes: appended to a
   * non-empty draft, otherwise it becomes the draft; the caret lands at the
   * end. `replace` is for editing an existing queued message, where appending
   * would accidentally fold a separate draft into that message. Works in both
   * controlled and uncontrolled modes.
   */
  prefill?: { seq: number; text: string; replace?: boolean } | null;
  /** Optional action rendered inside the "+" menu, e.g. "schedule message". */
  sendMenu?: (ctx: {
    text: string;
    disabled: boolean;
    onScheduled: () => void;
  }) => React.ReactNode;
  hint?: string;
  autoFocus?: boolean;
  /** Exposes the textarea so parents can focus it (e.g. keyboard shortcuts). */
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  /**
   * Attached images as `data:` URLs. When `onImagesChange` is provided, the
   * composer accepts pasted/dropped screenshots and renders thumbnails.
   */
  images?: string[];
  onImagesChange?: (images: string[]) => void;
  /**
   * Non-image attachments (staged to disk server-side). When `onFilesChange` is
   * provided, the composer accepts any dropped/picked file, not just images.
   */
  files?: FileAttachment[];
  onFilesChange?: (files: FileAttachment[]) => void;
  /** The transcript selection currently attached as ephemeral context. */
  quote?: Quote | null;
  onQuoteClear?: () => void;
  /**
   * Enables "@"-mention file autocomplete. Given the text typed after the "@",
   * returns matching files (primary repo + any attached repos). When omitted,
   * "@" is inert.
   */
  mentionFetch?: (query: string) => Promise<FileMention[]>;
  /**
   * Enables "/"-skill autocomplete when the draft starts with "/". Given the
   * text typed after the "/", returns matching skills/commands. When omitted,
   * "/" is inert.
   */
  skillsFetch?: (query: string) => Promise<FileMention[]>;
  /**
   * Note mode (Plain-style internal notes): the send posts a team note the
   * agent never sees. When `onNoteModeChange` is wired, a Note row appears in
   * the "+" menu and ⌘/Ctrl+N toggles it while the field is focused; the
   * composer tints yellow so the mode is unmistakable.
   */
  noteMode?: boolean;
  onNoteModeChange?: (on: boolean) => void;
  /**
   * Ask mode: this session can read the checkout but not change it. Tints the
   * writing surface the way note mode does — the state has no chip of its own,
   * so the surface is what says it. Note mode wins while it's on: ask mode is
   * ambient for the session's whole life, note mode is one message.
   */
  askMode?: boolean;
}

/**
 * The expanded box's resting corner, resolved from `--composer-radius` in
 * legacy.css. Motion writes `borderRadius` inline to morph between the phone's
 * resting pill and the expanded box, so the number has to exist in JS — but it
 * shouldn't be a SECOND copy of the token (the old inline `32` had drifted
 * from the stylesheet's own value, and the phone breakpoint restated a third).
 * Read through a throwaway element rather than `getPropertyValue`: an
 * unregistered custom property computes to its token stream, so we'd get the
 * literal `calc(18px * 1.35)` instead of a length. `--rf` is a `@supports`
 * switch, so the answer can't change within a page's life — resolve it once.
 */
let composerRadiusPx: number | null = null;
function composerRadius(): number {
  if (composerRadiusPx !== null) return composerRadiusPx;
  if (typeof document === "undefined") return 24;
  const probe = document.createElement("div");
  probe.style.cssText =
    "position:absolute;visibility:hidden;width:100px;height:100px;border-radius:var(--composer-radius)";
  document.body.appendChild(probe);
  const px = parseFloat(getComputedStyle(probe).borderTopLeftRadius);
  probe.remove();
  composerRadiusPx = Number.isFinite(px) && px > 0 ? px : 24;
  return composerRadiusPx;
}

/** Set / update / clear the session goal — a centered dialog on the shared
 *  Modal primitive (Base UI, squircle shell, focus-trapped, exit-animated). */
function GoalModal({
  open,
  initial,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  initial: string;
  onOpenChange: (open: boolean) => void;
  onSubmit: (goal: string | null) => void;
}) {
  const [text, setText] = useState(initial);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Reseed the field to the current goal (and select it) each time we open.
  useEffect(() => {
    if (open) {
      setText(initial);
      queueMicrotask(() => inputRef.current?.select());
    }
  }, [open, initial]);

  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content initialFocus={inputRef}>
        <Modal.Header
          title="Session goal"
          description="Pinned to the session. It rides along with every prompt you send."
        />

        <textarea
          ref={inputRef}
          className="min-h-[120px] w-full resize-y rounded-lg border border-line-strong bg-surface px-4 py-3.5 text-body leading-relaxed text-fg outline-none"
          value={text}
          rows={3}
          {...noAutofill}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Plain / ⌘/Ctrl+Enter submits; Shift+Enter newlines.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSubmit(text.trim() || null);
            }
          }}
          placeholder="e.g. Ship the onboarding redesign. Keep every reply focused on that."
        />

        <Modal.Footer>
          {initial && (
            <Button
              variant="danger"
              onClick={() => onSubmit(null)}
            >
              Clear goal
            </Button>
          )}
          <div className="flex-1" />
          <Button
            variant="primary"
            className="px-5"
            onClick={() => onSubmit(text.trim() || null)}
            disabled={text.trim() === initial.trim()}
          >
            {initial ? "Update goal" : "Set goal"}
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}

/** Confirms stopping from Escape. The stop button stays immediate because its
 *  press is already deliberate. Escape dismisses this dialog, while initial
 *  focus on Stop lets Enter confirm. */
function StopConfirmModal({
  open,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const stopRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal.Root open={open} onOpenChange={onOpenChange}>
      <Modal.Content
        initialFocus={stopRef}
        widthClassName="max-w-[32rem]"
        className="gap-5 p-7 phone:w-[calc(100vw-1.5rem)] phone:p-6"
      >
        <div className="flex flex-col">
          <Modal.Title className="m-0 text-balance text-section-title font-semibold leading-tight tracking-[-0.01em] text-fg">
            Stop this response?
          </Modal.Title>
          <Modal.Description className="m-0 mt-2 text-pretty text-base font-normal leading-relaxed text-dim">
            You can ask again or send a follow-up anytime.
          </Modal.Description>
        </div>
        <Modal.Footer className="mt-3 gap-3">
          <Modal.Close render={<Button size="lg">Keep going</Button>} />
          <Button
            ref={stopRef}
            variant="primary"
            size="lg"
            onClick={onConfirm}
          >
            Stop
          </Button>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
}

/**
 * Shared session composer (Claude/Codex-style): rounded container with an
 * auto-growing textarea and a bottom toolbar carrying compact model/effort pills,
 * a Goal target, a "+" add menu and the send button. Enter sends, Shift+Enter
 * newlines. With `mentionFetch`, typing "@" opens a file-path autocomplete.
 */
export function Composer({
  value,
  onChange,
  draftKey,
  onSend,
  placeholder,
  disabled,
  sendDisabled,
  sendTitle,
  busy,
  onStop,
  models,
  defaultModel,
  model,
  onModelChange,
  modelDisabled,
  modelTitle,
  effort,
  onEffortChange,
  fastMode,
  onFastModeChange,
  accounts,
  accountId,
  onAccountChange,
  goal,
  onSetGoal,
  usage,
  menuExtra,
  attached,
  prefill,
  sendMenu,
  hint,
  autoFocus,
  textareaRef: externalRef,
  images,
  onImagesChange,
  files,
  onFilesChange,
  quote,
  onQuoteClear,
  mentionFetch,
  skillsFetch,
  noteMode,
  onNoteModeChange,
  askMode,
}: Props) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalRef ?? internalRef;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // Uncontrolled mode (no `value` prop): the draft lives here so keystrokes
  // re-render only the Composer, not the whole parent view. With a `draftKey`
  // it seeds from — and mirrors into — the draft store, so navigating away
  // and back doesn't lose typed work.
  const [innerValue, setInnerValue] = useState(() =>
    draftKey ? loadDraft(draftKey).text : "",
  );
  const isPhone = useIsPhone();
  const noteChord = useShortcutLabel("composer-note");
  // "Send messages with" preference (Settings → Preferences): Enter or ⌘/Ctrl+Enter.
  const [sendKey, setSendKey] = useState(getSendKeyPref);
  useEffect(() => onSendKeyChanged(() => setSendKey(getSendKeyPref())), []);
  // Follow-up behavior preferences (Settings → Preferences): what each send
  // gesture — plain Enter/the send button vs ⌘/Ctrl+Enter — does while the
  // run is busy. Both configurable; defaults queue/steer.
  const [busySendPrefs, setBusySendPrefsState] = useState(getBusySendPrefs);
  useEffect(
    () => onBusySendChanged(() => setBusySendPrefsState(getBusySendPrefs())),
    [],
  );
  const [sendModifierHeld, setSendModifierHeld] = useState(false);
  useEffect(() => {
    const syncModifier = (e: KeyboardEvent) =>
      setSendModifierHeld(e.metaKey || e.ctrlKey);
    const clearModifier = () => setSendModifierHeld(false);
    window.addEventListener("keydown", syncModifier);
    window.addEventListener("keyup", syncModifier);
    window.addEventListener("blur", clearModifier);
    return () => {
      window.removeEventListener("keydown", syncModifier);
      window.removeEventListener("keyup", syncModifier);
      window.removeEventListener("blur", clearModifier);
    };
  }, []);
  // Vim mode preference (Settings → Preferences, default off).
  const [vimEnabled, setVimEnabled] = useState(getVimModePref);
  useEffect(() => onVimModeChanged(() => setVimEnabled(getVimModePref())), []);
  const isControlled = value !== undefined;
  const text = isControlled ? value : innerValue;
  const setText = isControlled ? onChange ?? (() => {}) : setInnerValue;
  useEffect(() => {
    if (!isControlled && draftKey) saveDraft(draftKey, { text: innerValue });
  }, [isControlled, draftKey, innerValue]);
  // A draft can also arrive from elsewhere: typed on the phone, or sent there
  // and cleared. Take it while the field is unfocused, so text can appear (or
  // go) under someone who is not looking, but never under their cursor.
  const pendingRemoteText = useRef<string | null>(null);
  useEffect(() => {
    if (isControlled || !draftKey) return;
    return onDraftsChanged(() => {
      const stored = loadDraft(draftKey).text;
      if (document.activeElement === textareaRef.current) {
        pendingRemoteText.current = stored;
        return;
      }
      pendingRemoteText.current = null;
      setInnerValue((current) => (current === stored ? current : stored));
    });
  }, [isControlled, draftKey, textareaRef]);
  // One-shot prefill (see the prop doc): each new seq folds the given text
  // into the draft and focuses the field for immediate editing.
  const prefillSeqRef = useRef(0);
  useEffect(() => {
    if (!prefill || prefill.seq === prefillSeqRef.current) return;
    prefillSeqRef.current = prefill.seq;
    const next = !prefill.replace && text.trim()
      ? `${text.replace(/\s+$/, "")}\n${prefill.text}`
      : prefill.text;
    setText(next);
    queueMicrotask(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = next.length;
      }
    });
  }, [prefill]);
  // Fire a send handler with the current draft; in uncontrolled mode a `true`
  // return means "consumed" — clear the draft (falsy keeps it, e.g. offline).
  function fireSend(
    handler: (
      t: string,
      opts?: { steer?: boolean },
    ) => boolean | void | Promise<boolean | void>,
    opts?: { steer?: boolean },
  ) {
    const consumed = handler(text, opts);
    if (consumed instanceof Promise) {
      void consumed.then((result) => {
        if (!isControlled && result === true) setInnerValue("");
      });
    } else if (!isControlled && consumed === true) {
      setInnerValue("");
    }
  }
  const isSendDisabled =
    typeof sendDisabled === "function" ? sendDisabled(text) : sendDisabled;
  const imgs = images || [];
  const fls = files || [];
  // Notes accept images but not arbitrary files: images remain team-visible,
  // while files are agent-readable workspace context and belong to prompts.
  const canAttachImages = !!onImagesChange;
  const canAttachFiles = !noteMode && !!onFilesChange;
  const canAttach = canAttachImages || canAttachFiles;
  // Whether the "+" has anything to show. Images keep the attachment row
  // available in note mode, while the mode row remains the way back out.
  const hasAddMenu =
    canAttach || !!onSetGoal || !!onNoteModeChange || !!menuExtra || !!sendMenu;

  // Phones get a ChatGPT-style resting state: while the field is empty and
  // unfocused, the composer collapses to a single-row pill ("+ · placeholder ·
  // mic · send"), hiding the model/effort/goal chips. Focusing the field or
  // adding any content (text or attachment) expands it to the full toolbar.
  // The open model menu also holds it expanded: the portaled popup takes focus
  // (blurring the textarea), and collapsing would unmount the pill trigger and
  // slam the menu shut mid-interaction.
  const [focused, setFocused] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const hasAttached = !!attached;
  const hasContent =
    !!text.trim() ||
    imgs.length > 0 ||
    fls.length > 0 ||
    !!quote ||
    hasAttached;
  const minimized = isPhone && !focused && !hasContent && !modelMenuOpen;
  const showSend = !busy || hasContent;
  // Whether the send button/plain send steers right now: each gesture has its
  // own configured busy action — Enter/button uses the "enter" pref, holding
  // ⌘/Ctrl switches to the "mod" pref. (With ⌘/Ctrl+Enter as the send key the
  // modifier is held on every send, so it's one gesture — the "enter"
  // follow-up pref rules and the mod pref is moot.)
  const entSteer = busySendPrefs.enter === "steer";
  const modSteer = busySendPrefs.mod === "steer";
  const modifierPicks = sendKey === "enter";
  // Notes bypass the busy queue/steer machinery entirely — they post straight
  // to the team whether or not a turn is running.
  const steerSend =
    !noteMode && !!busy && (modifierPicks && sendModifierHeld ? modSteer : entSteer);
  // Picking a busy action from the send button's menu hands the OTHER one to
  // ⌘/Ctrl+Enter, so both actions always keep a key and each row shows exactly
  // one — with both prefs on the same action there is no way to reach the other
  // from the keyboard at all. Settings → Preferences still sets the two
  // gestures independently for anyone who wants them to agree.
  const pickBusySend = (pref: BusySendPref) => {
    setBusySendPref("enter", pref);
    if (modifierPicks)
      setBusySendPref("mod", pref === "queue" ? "steer" : "queue");
  };
  // Which keys land on each busy action right now, for that menu: the send key
  // runs the "enter" pref, and — when the modifier is free to pick (i.e. the
  // send key is plain Enter) — ⌘/Ctrl+Enter runs the "mod" pref. Both land on
  // one row when the two prefs agree.
  const busySendKeys = (pref: BusySendPref) =>
    [
      busySendPrefs.enter === pref &&
        (sendKey === "enter" ? "↩" : MOD_ENTER_GLYPH),
      modifierPicks && busySendPrefs.mod === pref && MOD_ENTER_GLYPH,
    ]
      .filter(Boolean)
      .join("  ");

  // Escape asked to stop the run and is waiting on an answer. A turn that
  // finishes on its own while the question is up leaves nothing to stop, so
  // the dialog goes away with it rather than stopping the NEXT turn.
  const [stopConfirm, setStopConfirm] = useState(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    if (!busy) setStopConfirm(false);
  }, [busy]);

  // Which toolbar popover is open ("add" menu or "goal" editor). Closed on an
  // outside click or after an action.
  const [menu, setMenu] = useState<null | "add" | "goal">(null);
  useEffect(() => {
    // The goal editor is a portaled Base UI dialog — it dismisses itself
    // (backdrop / Escape) and lives outside .composer-pop-wrap, so this
    // handler would wrongly close it on any click inside it. Only the anchored
    // "add" menu needs outside-click dismissal here.
    if (menu !== "add") return;
    // Dismiss on a tap/click outside the popover. iOS doesn't reliably fire
    // `mousedown` on non-interactive elements, so listen for `touchstart` too —
    // otherwise the menu gets stuck open on mobile.
    function onDown(e: Event) {
      if (!(e.target as HTMLElement).closest(".composer-pop-wrap")) setMenu(null);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [menu]);

  // iOS focus-preserving taps: a tap's default continuation (touchend →
  // synthesized mousedown → textarea blur → keyboard dismiss → click) makes
  // toolbar taps close the keyboard and, on an empty draft, collapse the
  // composer mid-tap. Cancelling pointerdown does NOT stop that on iOS — the
  // only reliable point is touchend itself. tapProps(action) fires the action
  // on touchend and cancels the mouse synthesis; onClick stays for mouse/pen,
  // guarded by the shared timestamp against browsers that still send both.
  const touchFiredAt = useRef(0);
  function tapProps(action: () => void) {
    return {
      onTouchEnd: (e: React.TouchEvent) => {
        e.preventDefault();
        touchFiredAt.current = Date.now();
        action();
      },
      onClick: () => {
        if (Date.now() - touchFiredAt.current < 700) return;
        action();
      },
    };
  }

  // Modal editing on the draft (Settings → Preferences → Vim mode). The engine
  // consumes keys in normal/visual modes; insert mode only claims Escape.
  const vim = useVimMode({
    enabled: vimEnabled,
    textareaRef,
    value: text,
    onChange: setText,
  });

  // "@"-mention file autocomplete (shared with the New-session prompt field).
  const mentions = useFileMentions({
    value: text,
    onChange: setText,
    textareaRef,
    mentionFetch,
    skillsFetch,
  });

  async function addFiles(picked: FileList | File[]) {
    if (!canAttach) return;
    const selected = Array.from(picked);
    const noteImageTypes = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
    const allowed = (file: File) =>
      file.type.startsWith("image/") && (!noteMode || noteImageTypes.has(file.type));
    const disallowed = canAttachFiles ? [] : selected.filter((file) => !allowed(file));
    const accepted = canAttachFiles
      ? selected
      : selected.filter(allowed);
    const { images: newImgs, files: newFls, rejected } = await splitAttachments(accepted);
    // Images ride the vision channel; other files need a dedicated file channel
    // (if the parent only wired images, non-image files are simply ignored).
    if (newImgs.length) onImagesChange?.([...imgs, ...newImgs]);
    if (newFls.length && canAttachFiles) onFilesChange?.([...fls, ...newFls]);
    // Fail loudly rather than dropping oversized/failed uploads silently.
    const failures = [
      ...rejected,
      ...disallowed.map((file) =>
        noteMode
          ? `${file.name} (notes accept PNG, JPEG, GIF, or WebP images)`
          : `${file.name} (only images are supported)`,
      ),
    ];
    if (failures.length) alert(`Couldn't attach:\n${failures.join("\n")}`);
  }

  function handlePaste(e: React.ClipboardEvent) {
    // A session link goes in as the id it carries, which is the same reference
    // in a third of the room and chips the same way (lib/session-url.ts).
    if (insertPastedSessionId(e)) return;
    if (!canAttach) return;
    const pasted = imageFilesFromPaste(e);
    if (pasted.length) {
      e.preventDefault();
      void addFiles(pasted);
    }
  }

  function handleDrop(e: React.DragEvent) {
    if (!canAttach || !e.dataTransfer?.files?.length) return;
    e.preventDefault();
    void addFiles(e.dataTransfer.files);
  }

  function removeImage(i: number) {
    onImagesChange?.(imgs.filter((_, idx) => idx !== i));
  }

  function removeFile(i: number) {
    onFilesChange?.(fls.filter((_, idx) => idx !== i));
  }

  // Insert an "@" at the caret and focus the textarea, opening the mention popup.
  function startMention() {
    const el = textareaRef.current;
    const at = el ? el.selectionStart : text.length;
    const next = text.slice(0, at) + "@" + text.slice(at);
    setText(next);
    queueMicrotask(() => {
      const t = textareaRef.current;
      if (t) {
        t.focus();
        t.selectionStart = t.selectionEnd = at + 1;
      }
      mentions.sync();
    });
  }

  // Once the draft grows past the composer's max-height the textarea scrolls
  // internally; without help the clipped text ends in a hard horizontal cut at
  // the container edge. We fade the edge instead: a scroll-aware mask on the
  // input region that softens the top once you've scrolled down, and the bottom
  // while there's still text below. Only the active edges dim, so a resting
  // first line never fades. Phone-only — the tall desktop field rarely clips.
  //
  // Driven imperatively (write the mask straight onto the wrapper) rather than
  // through React state: a state-round-trip lags the scroll by a render, so the
  // mask is a frame stale during momentum scroll and reads as a flicker (or, if
  // a scroll event coalesces, never updates at all). The mask must track
  // scrollTop exactly, so we set it in the same handler that observes the scroll.
  const FADE_PX = 26;
  function updateFade(el: HTMLTextAreaElement) {
    const wrap = el.parentElement; // .composer-input-wrap (masks textarea + hl mirror as one)
    if (!wrap) return;
    const top = isPhone && el.scrollTop > 1;
    const bottom =
      isPhone && el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    const mask =
      top || bottom
        ? `linear-gradient(to bottom, ${
            top ? "transparent 0, #000 " + FADE_PX + "px" : "#000 0"
          }, ${
            bottom
              ? "#000 calc(100% - " + FADE_PX + "px), transparent 100%"
              : "#000 100%"
          })`
        : "";
    wrap.style.setProperty("-webkit-mask-image", mask);
    wrap.style.setProperty("mask-image", mask);
  }

  // Auto-grow to fit the draft. Only a NON-EMPTY draft is measured; an empty
  // one drops the inline height and takes its size straight from CSS — the
  // resting floor of the expanded field (min-height per breakpoint), or a
  // single line in the minimized phone pill (min-height: 0 + rows=1). So the
  // floor and the cap have exactly one home, the stylesheet, instead of magic
  // numbers here that had to be kept in sync with it.
  //
  // Not measuring an empty draft also takes out the only path by which the
  // resting pill can come back several lines tall after sending a long message
  // (seen on the iOS PWA, never reproduced in Chrome): a `scrollHeight` read
  // that doesn't reflect the just-cleared value gets written straight back onto
  // the element. With nothing measured there's nothing stale to write.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "";
    // min-/max-height clamp this, so tall drafts scroll internally at the cap.
    if (text) el.style.height = `${el.scrollHeight}px`;
    // Height (and thus clip state) just changed — re-evaluate the edge fades.
    updateFade(el);
  }, [text, isPhone, minimized]);

  // Live code styling: when the draft contains a backtick, a metrics-identical
  // mirror div paints `inline` / ```fence``` tints behind a transparent-text
  // textarea (native caret/selection/undo stay). Plain drafts skip the mirror
  // entirely — the stock opaque textarea has zero desync risk.
  // The same mirror carries the @-mention pills, so it also mounts for a draft
  // that only mentions somebody. The roster is reactive: it arrives from the
  // server after first paint, and without the re-render an already-typed
  // mention would only chip on the next keystroke.
  const people = usePeople();
  const hlRef = useRef<HTMLDivElement>(null);
  const hlActive = needsComposerHighlight(text, people);
  const hlHtml = useMemo(
    () => (hlActive ? composerHighlightHtml(text, people) : ""),
    [hlActive, text, people],
  );
  const mentionRanges = useMemo(
    () => composerMentionRanges(text, people),
    [text, people],
  );
  // A mention pill's padding is bought out of the space beside it, so the draft
  // pays a wider word space only while it holds one. Both the field and the
  // mirror wear it, or the painted text slides off the caret behind it. The
  // session pill buys nothing here — it takes a narrower wash instead, so an
  // ordinary sentence around a pasted link keeps the type's own spacing.
  const hasMention = mentionRanges.length > 0;
  useEffect(() => {
    // The textarea scrolls internally at max-height; keep the mirror locked to it.
    const el = textareaRef.current;
    const hl = hlRef.current;
    if (el && hl) hl.scrollTop = el.scrollTop;
  }, [hlHtml, textareaRef]);

  // Pressing a mention pill removes it. The textarea covers the mirror, so the
  // press lands on the field — but the browser has already placed the caret by
  // the time click fires, and a caret strictly INSIDE a pill can only have come
  // from pressing it (its edges still place a caret, which is the margin that
  // keeps an ordinary click near a mention from eating one). Deleting through
  // execCommand keeps the edit on the native undo stack; splicing the value in
  // React state would quietly cost you ⌘Z.
  function removeMentionAtCaret(el: HTMLTextAreaElement): boolean {
    if (el.selectionStart !== el.selectionEnd) return false;
    const caret = el.selectionStart;
    const hit = mentionRanges.find((r) => caret > r.start && caret < r.end);
    if (!hit) return false;
    // The trailing space goes with it, so removing a mention mid-sentence
    // doesn't leave a double space behind.
    const end = text[hit.end] === " " ? hit.end + 1 : hit.end;
    el.setSelectionRange(hit.start, end);
    if (!document.execCommand("delete")) {
      setText(text.slice(0, hit.start) + text.slice(end));
      queueMicrotask(() =>
        textareaRef.current?.setSelectionRange(hit.start, hit.start),
      );
    }
    return true;
  }

  // Backspace at a mention's end takes the whole name in one press, and Delete
  // at its start does the same forwards. The pill reads as one object, so it
  // has to erase like one — picking it apart a letter at a time would also
  // spend two keystrokes rendering a half-name that chips back into prose.
  //
  // Backspace one step further out, from just past the space a mention is
  // followed by, takes the space AND the name together. That is the common
  // case, because the picker leaves the caret exactly there — and taking only
  // the space would be worse than useless: the name loses the terminator that
  // makes it a mention, so the pill would vanish into plain text and the next
  // press would start eating letters.
  function deleteWholeMention(key: string, el: HTMLTextAreaElement): boolean {
    if (el.selectionStart !== el.selectionEnd) return false;
    const caret = el.selectionStart;
    const back = key === "Backspace";
    const hit = mentionRanges.find((r) =>
      back
        ? caret === r.end || (caret === r.end + 1 && text[r.end] === " ")
        : caret === r.start,
    );
    if (!hit) return false;
    const end = back ? Math.max(caret, hit.end) : hit.end;
    el.setSelectionRange(hit.start, end);
    if (!document.execCommand("delete")) {
      setText(text.slice(0, hit.start) + text.slice(end));
      queueMicrotask(() =>
        textareaRef.current?.setSelectionRange(hit.start, hit.start),
      );
    }
    return true;
  }

  // A pill that can be pressed has to look it, and the field on top owns the
  // cursor — so hover is hit-tested against the mirror's own spans and painted
  // by a data attribute on the one under the pointer.
  const hoveredMention = useRef<HTMLElement | null>(null);
  function updateMentionHover(x: number, y: number) {
    const hl = hlRef.current;
    const el = textareaRef.current;
    if (!hl || !el) return;
    let hit: HTMLElement | null = null;
    for (const span of hl.querySelectorAll<HTMLElement>(".cmp-mention")) {
      // Per fragment, not per span: a mention that wraps has two boxes.
      for (const r of span.getClientRects())
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)
          hit = span;
      if (hit) break;
    }
    if (hoveredMention.current === hit) return;
    hoveredMention.current?.removeAttribute("data-hover");
    hit?.setAttribute("data-hover", "");
    hoveredMention.current = hit;
    el.style.cursor = hit ? "pointer" : "";
  }
  // Every keystroke rewrites the mirror's innerHTML, so the hovered span is a
  // dangling node from the render before it.
  useEffect(() => {
    hoveredMention.current = null;
    if (textareaRef.current) textareaRef.current.style.cursor = "";
  }, [hlHtml, textareaRef]);

  // Dictated text lands at the end of the draft (with a joining space) and
  // focus returns to the textarea so you can touch it up and send.
  function insertDictation(t: string) {
    const next = text.trim() ? `${text.replace(/\s+$/, "")} ${t}` : t;
    setText(next);
    queueMicrotask(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.selectionStart = el.selectionEnd = next.length;
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (mentions.handleKeyDown(e)) return;
    if ((e.nativeEvent as any).isComposing) return;
    if (
      (e.key === "Backspace" || e.key === "Delete") &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      textareaRef.current &&
      deleteWholeMention(e.key, textareaRef.current)
    ) {
      e.preventDefault();
      return;
    }
    // Vim mode gets the key before the send/stop logic: in insert mode it only
    // claims Escape (drop to normal mode — a second, bare Escape in normal mode
    // falls through here to the busy-stop below), and Enter is never consumed,
    // so the send combos keep working in any mode.
    if (vim.handleKeyDown(e)) return;
    // Esc while a run is busy asks before interrupting the turn (the stop
    // button itself still stops on the press).
    if (e.key === "Escape" && busy && onStop && !disabled) {
      e.preventDefault();
      e.stopPropagation();
      // Mount after this Escape dispatch completes. Mounting Base UI's dialog
      // during the same event lets its dismissal listener consume the opener.
      queueMicrotask(() => {
        if (busyRef.current) setStopConfirm(true);
      });
      return;
    }
    // Inside an unclosed ``` fence, plain Enter inserts a newline instead of
    // sending — you can't type a multi-line code block otherwise. Closing the
    // fence (or ⌘/Ctrl+Enter, or the send button) sends as usual.
    if (
      sendKey === "enter" &&
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.metaKey &&
      !e.ctrlKey
    ) {
      const caret = textareaRef.current?.selectionStart ?? text.length;
      if (insideOpenFence(text, caret)) return; // let the newline land
    }
    // While a run is busy, ⌘/Ctrl+Enter does its own configured follow-up
    // action (Settings → Preferences, default steer: fold into the running turn
    // now, WITHOUT stopping it). Only when plain Enter is the send key —
    // otherwise ⌘/Ctrl+Enter already means "send".
    if (
      busy &&
      sendKey === "enter" &&
      e.key === "Enter" &&
      (e.metaKey || e.ctrlKey)
    ) {
      e.preventDefault();
      if (!disabled && !isSendDisabled)
        fireSend(onSend, modSteer ? { steer: true } : undefined);
      return;
    }
    if (isSendCombo(e, sendKey)) {
      e.preventDefault();
      if (!disabled && !isSendDisabled)
        fireSend(onSend, busy && entSteer ? { steer: true } : undefined);
    }
  }

  const effectiveModel = model || defaultModel;
  const noteSurface = tintedSurface("var(--yellow-tint)", 10, 6, 45);
  const surfaceStyle = {
    ...(askMode ? tintedSurface("var(--green)", 7, 4, 30) : {}),
    "--composer-note-bg": noteSurface.backgroundColor,
    "--composer-note-image": noteSurface.backgroundImage,
    "--composer-note-border": noteSurface.borderColor,
  } as React.CSSProperties;

  return (
    <div className="mx-auto w-full max-w-[calc(var(--session-col)+40px)]">
      {/* Queued/steered messages fold out from behind the composer box —
          a sibling flap tucked under its top edge, not a box-in-box. */}
      {attached}
      <motion.div
        layout
        // `layout` here is for ONE move: the phone pill morphing to and from the
        // full composer. `layoutDependency` is what keeps it to that move.
        //
        // Without it Motion re-measures on every render, and this component
        // re-renders on every keystroke, so a draft growing by a line was
        // animated like a state change: the box took a 300ms spring, which
        // Motion runs as a scaleY on the box (measured 0.84 on the first frame),
        // and the text slid ~20px up under the caret after the character had
        // already landed while the toolbar dipped 8px and floated back. Anything
        // in the box that isn't itself a projection node was squashed for those
        // 300ms: the attachment rows, the note tint, the vim key bar.
        //
        // Keyed to `minimized`, the measure is skipped entirely while you type
        // (the field just grows, as a textarea does) and taken fresh at the
        // moment the pill flips, which is the only time this box changes shape
        // rather than size. On desktop `minimized` never changes, so the box
        // never measures at all. Content that should still glide animates its
        // OWN height instead. See ComposerContextChip.
        layoutDependency={minimized}
        // Pill when collapsed, --composer-radius when expanded (see
        // composerRadius above) — the same corner the queue flap and the
        // mention popup use, so the surfaces that tuck under and hang off this
        // box share its edge. It used to be a hardcoded 32, which made the
        // composer the only surface on a session page rounder than 18.9px, and
        // the toolbar buttons it was cut to follow are no longer circles.
        // initial={false}: adopt the target radius instantly on mount —
        // otherwise Motion animates from the stylesheet value on load, a
        // visible radius morph.
        //
        // With a flap attached the two are ONE control rather than a pill
        // parked on a panel: the flap keeps the rounded top, this keeps the
        // rounded bottom, and the seam where they meet squares off.
        initial={false}
        animate={{
          borderTopLeftRadius: minimized ? 999 : hasAttached ? 0 : composerRadius(),
          borderTopRightRadius: minimized ? 999 : hasAttached ? 0 : composerRadius(),
          borderBottomLeftRadius: minimized ? 999 : composerRadius(),
          borderBottomRightRadius: minimized ? 999 : composerRadius(),
        }}
        transition={composerMorph}
        // `composer` and `composer-min` stay on the markup as hooks, not as
        // styling: the viewer's input wrap keys the phone keyboard gap off the
        // pair with `body.kb-open .viewer-input:has(.composer:not(
        // .composer-min))` (see lib/session-viewer-classes.ts), and
        // VoiceInput's recording overlay fills `.composer` as its positioned
        // ancestor.
        className={cn(
          "composer",
          minimized && "composer-min",
          composerBox,
          minimized ? composerBoxMinimized : composerBoxExpanded,
          "isolate before:pointer-events-none before:absolute before:inset-0 before:z-0 before:rounded-[inherit] before:[corner-shape:inherit] before:border before:border-[var(--composer-note-border)] before:bg-[var(--composer-note-bg)] before:[background-image:var(--composer-note-image)] before:opacity-0 before:transition-opacity before:duration-150 before:ease-[cubic-bezier(0.32,0.72,0,1)] [&>*]:relative [&>*]:z-[1]",
          noteMode && "before:opacity-100",
          disabled && "opacity-60",
        )}
        style={surfaceStyle}
        onDrop={handleDrop}
        onDragOver={(e) => canAttach && e.preventDefault()}
      >
        {/* Vim mode indicator — only surfaces outside insert mode, so plain
            typing looks identical with the pref on. Sits above the input wrap's
            scroll-fade mask. */}
        {vimEnabled && vim.mode !== "insert" && (
          <div className="pointer-events-none absolute right-3 top-2 z-[2] select-none rounded-sm border border-line bg-surface px-1.5 py-0.5 text-meta font-semibold tracking-wider text-dim">
            {vim.mode === "normal"
              ? "NORMAL"
              : vim.mode === "visual"
                ? "VISUAL"
                : "V-LINE"}
          </div>
        )}
        <AnimatePresence initial={false}>
          {/* Note mode is context attached to the next send, exactly like a
              quoted selection, so it says so in the same place and the same
              shape rather than as a marker down in the toolbar — where the ✕
              had to be small enough to fit beside the "+" and the model pill,
              which made it hard to read and hard to hit. */}
          {noteMode && (
            <ComposerContextChip
              key="note-mode"
              icon={<IconNote size={15} />}
              label="Team note"
              title="The agent won't read this. ⌘N to go back."
              tone="note"
              onRemove={() => onNoteModeChange?.(false)}
              removeLabel="Leave note mode"
              disabled={disabled}
            />
          )}
          {quote && (
            <QuoteContext
              key={quote.id}
              quote={quote}
              // Detaching the passage leaves you in the message you were
              // writing — the ✕ shouldn't cost you the caret as well.
              onRemove={() => {
                onQuoteClear?.();
                textareaRef.current?.focus({ preventScroll: true });
              }}
              disabled={disabled}
            />
          )}
        </AnimatePresence>
        <ImageThumbs images={imgs} onRemove={removeImage} disabled={disabled} />
        <FileChips files={fls} onRemove={removeFile} disabled={disabled} />
        <motion.div
          layout="position"
          transition={composerMorph}
          // Same dependency as the box above: these wrappers exist so the
          // controls glide when the pill re-orders them, and they have to skip
          // the same renders it does. A wrapper still measuring per keystroke
          // would spring the field's position against a box that isn't moving.
          layoutDependency={minimized}
          // Positioned for the code mirror below (and the scroll-fade mask the
          // auto-grow effect writes onto it).
          className={cn(
            "relative",
            minimized && "order-2 min-w-0 flex-auto",
          )}
          ref={mentions.inputWrapRef}
        >
          {mentions.popup}
          {hlActive && (
            // `composer-hl` stays as a hook: the tint spans inside this mirror
            // are written as innerHTML by lib/composer-highlight.ts, so their
            // `.cmp-code` / `.cmp-fence` rules can only be reached through it.
            <div
              ref={hlRef}
              className={cn(
                "composer-hl",
                composerTextarea,
                composerTextareaPadding,
                "pointer-events-none absolute inset-0 z-0 overflow-hidden text-fg break-words whitespace-pre-wrap select-none",
                hasMention && composerMentionSpacing,
                // A pill's wash reaches past its own box (base.css), so one at
                // either end of a line would be cut off by this box. The
                // padding pushes the clip edge out; the matching negative
                // margin takes it back out of the content origin, so every
                // glyph still lands exactly where the textarea puts it.
                //
                // The width is the third of those three and it was missing.
                // `inset-0` sizes this box from its container, and a negative
                // margin does not grow an over-constrained absolute box — so
                // the padding came out of the CONTENT, leaving the mirror 12px
                // narrower than the field (measured 672 against 684). It wraps
                // a word early at that width, which put the painted text on a
                // different line from the caret and the selection under it on
                // any draft long enough to wrap. Asking for the 12px back
                // makes the two agree glyph for glyph again.
                "-mx-[6px] w-[calc(100%+12px)] px-[6px]",
              )}
              aria-hidden="true"
              dangerouslySetInnerHTML={{ __html: hlHtml }}
            />
          )}
          <textarea
            ref={textareaRef}
            // `composer-textarea` stays as a class NAME hook: the sidebar swipe
            // guard (lib/sidebar-swipe.ts) and SessionViewer's global keys both
            // ask whether the caret is in a composer by looking for it.
            className={cn(
              "composer-textarea",
              composerTextarea,
              hasMention && composerMentionSpacing,
              minimized
                ? composerTextareaPaddingMinimized
                : composerTextareaPadding,
              // A neutral grey placeholder on a tinted surface reads cool and
              // dirty against it, and it loses contrast too: #949494 is 3.03:1
              // on the ordinary white composer but 2.43:1 on the note fill.
              // Warming the ink toward the surface fixes both (2.63:1) —
              // LIGHTENING it, the intuitive move, would have taken it to
              // 1.82:1 and made it dimmer as well as still cool.
              noteMode
                ? "placeholder:text-[color-mix(in_srgb,var(--text-faint)_84%,var(--yellow))]"
                : "placeholder:text-faint",
              // With the mirror painting the styled draft, the field's own
              // glyphs go transparent and only the caret stays visible.
              hlActive
                ? "relative z-[1] break-words text-transparent caret-[var(--text)]"
                : "text-fg",
            )}
            // In the resting pill the full prompt would clip, so show a short
            // "Ask <model>" (ChatGPT-style) that fits the single row; the
            // descriptive placeholder returns once it expands.
            placeholder={
              noteMode
                ? minimized
                  ? "Team note"
                  : "Only your team will see this"
                : minimized
                  ? `Ask ${shortModelLabel(effectiveModel, models)}`
                  : quote
                    ? "Chat with selected text"
                    : placeholder
            }
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              // Caret has moved to the new value; re-evaluate after React commits.
              queueMicrotask(mentions.sync);
            }}
            onKeyDown={handleKeyDown}
            onKeyUp={mentions.sync}
            onClick={(e) => {
              if (removeMentionAtCaret(e.currentTarget)) return;
              mentions.sync();
            }}
            onMouseMove={(e) => updateMentionHover(e.clientX, e.clientY)}
            onMouseLeave={() => updateMentionHover(-1, -1)}
            onScroll={(e) => {
              if (hlRef.current)
                hlRef.current.scrollTop = e.currentTarget.scrollTop;
              updateFade(e.currentTarget);
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              const remote = pendingRemoteText.current;
              pendingRemoteText.current = null;
              if (remote !== null && (!draftKey || loadDraft(draftKey).text === remote)) {
                setInnerValue((current) => (current === remote ? current : remote));
              }
              // Let a click on a suggestion (mousedown) win the race first.
              setTimeout(mentions.close, 120);
            }}
            onPaste={handlePaste}
            disabled={disabled}
            rows={1}
            {...noAutofill}
            autoFocus={autoFocus}
          />
        </motion.div>
        <div
          className={cn(composerToolbar, minimized && composerToolbarMinimized)}
          ref={toolbarRef}
          // Phones: a toolbar tap must not blur the textarea — the blur would
          // collapse the empty composer mid-tap (unmounting the model pill and
          // reflowing + / mic / send under the finger) and dismiss the
          // keyboard. Cancelling pointerdown covers pointer-event browsers,
          // but NOT iOS Safari — there the blur rides the touchend→mousedown
          // synthesis, which only touchend's own preventDefault stops. That's
          // what tapProps() on the individual buttons is for; this handler is
          // the non-iOS half.
          onPointerDown={(e) => {
            if (isPhone) e.preventDefault();
          }}
        >
          {/* One "+" carries everything you can add to or change about this
              session: attachments, the goal, and whatever the surface
              contributes (mode switch, scheduled send). As a row of icon chips
              these crowded the field, truncated on phones, and gave each action
              a glyph instead of a name; in a menu they each get a real label
              and stay one tap away. State stays visible where it already was —
              a set goal shows above the composer. */}
          {hasAddMenu && (
            <motion.div
              layout="position"
              transition={composerMorph}
              layoutDependency={minimized}
              // `composer-pop-wrap` stays as a hook: the outside-click handler
              // above dismisses the menu for any mousedown that isn't inside one.
              className={cn(
                "composer-pop-wrap relative inline-flex shrink-0",
                // Phones pull the model pill to the front of the toolbar, so the
                // "+" has to lead it; in the resting pill it opens the row.
                minimized ? "order-1" : "phone:order-[-2]",
              )}
            >
              <Tooltip label="Attach files and session options">
                <button
                  type="button"
                  // The "+" is a 40px target around a 22px glyph, so aligning
                  // its BOX with the composer's padding parks the visible ink
                  // 10px further in than the text above it. Pull the button (not
                  // its wrapper, which the menu anchors to) back out so the glyph
                  // sits about where the send circle does. The resting pill
                  // insets everything by 4px already, so it stays put there.
                  className={cn(
                    paletteIconBtn,
                    minimized && paletteIconBtnRound,
                    !minimized && "phone:[&_svg]:size-[22px]",
                    minimized ? "ml-0" : "-ml-1.5",
                  )}
                  {...tapProps(() => setMenu(menu === "add" ? null : "add"))}
                  disabled={disabled}
                  aria-label="Attach files and session options"
                  aria-expanded={menu === "add"}
                >
                  <IconPlus size={22} />
                </button>
              </Tooltip>
              {menu === "add" && (
                <div
                  className={cn(
                    composerMenuPopup,
                    composerMenuWidth,
                    composerMenuAnchorLeft,
                  )}
                >
                  {canAttach && (
                    <button
                      type="button"
                      className={composerMenuItem}
                      {...tapProps(() => {
                        setMenu(null);
                        fileInputRef.current?.click();
                      })}
                    >
                      <span className={composerMenuIcon}>
                        <IconPaperclip size={22} />
                      </span>
                      <span className="grow whitespace-nowrap">
                        {canAttachFiles ? "Attach files" : "Attach an image"}
                      </span>
                    </button>
                  )}
                  {canAttach && mentionFetch && (
                    <button
                      type="button"
                      className={composerMenuItem}
                      {...tapProps(() => {
                        setMenu(null);
                        startMention();
                      })}
                    >
                      <span className={composerMenuIcon}>
                        <IconAtSign size={22} />
                      </span>
                      <span className="grow whitespace-nowrap">Reference a file</span>
                      {/* Not a chord: typing @ in the field opens the same
                          picker, which is the faster way once you know it.
                          Hidden on phones, where there are no keys to press —
                          the same call the Enter hint under the field makes. */}
                      {!isPhone && <MenuShortcut>@</MenuShortcut>}
                    </button>
                  )}
                  {onSetGoal && (
                    <button
                      type="button"
                      className={composerMenuItem}
                      // Opens the goal editor: `menu` is single-valued, so this
                      // closes the add menu and opens the modal in one step.
                      {...tapProps(() => setMenu("goal"))}
                      title={goal ? `Goal: ${goal}` : undefined}
                    >
                      <span className={composerMenuIcon}>
                        <IconCrosshair size={22} />
                      </span>
                      <span className="grow whitespace-nowrap">
                        {goal ? "Edit goal" : "Set a goal"}
                      </span>
                    </button>
                  )}
                  {onNoteModeChange && (
                    <button
                      type="button"
                      className={composerMenuItem}
                      {...tapProps(() => {
                        setMenu(null);
                        onNoteModeChange(!noteMode);
                      })}
                      title={
                        noteMode
                          ? "Prompt the agent again (⌘N)"
                          : "Only your team sees it (⌘N)"
                      }
                    >
                      <span className={composerMenuIcon}>
                        <IconNote size={22} />
                      </span>
                      <span className="grow whitespace-nowrap">
                        {noteMode ? "Back to prompting" : "Write a team note"}
                      </span>
                      {!isPhone && (
                        <MenuShortcut>{isApple ? "⌘N" : "Ctrl N"}</MenuShortcut>
                      )}
                    </button>
                  )}
                  {menuExtra?.({ close: () => setMenu(null) })}
                  {sendMenu?.({
                    text,
                    disabled: !!(disabled || isSendDisabled),
                    onScheduled: () => {
                      if (!isControlled) setInnerValue("");
                      setMenu(null);
                    },
                  })}
                </div>
              )}
              {onSetGoal && (
                <GoalModal
                  open={menu === "goal"}
                  initial={goal || ""}
                  onOpenChange={(o) => setMenu(o ? "goal" : null)}
                  onSubmit={(g) => {
                    onSetGoal(g);
                    setMenu(null);
                  }}
                />
              )}
              <input
                ref={fileInputRef}
                type="file"
                {...(canAttachFiles
                  ? {}
                  : { accept: noteMode ? "image/png,image/jpeg,image/gif,image/webp" : "image/*" })}
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) void addFiles(e.target.files);
                  // Reset so picking the same file again still fires onChange.
                  e.target.value = "";
                }}
              />
            </motion.div>
          )}

          {/* Ask mode's marker. Nothing renders in the ordinary state; when ask
              mode is on it names itself next to the "+", so the tinted surface
              isn't the only thing saying so. Ask mode's only exit cuts a
              worktree, so clicking the marker opens the menu and lets you pick
              the labelled row instead. Note mode is not here: it is a chip
              above the field, with a real ✕ (see ComposerContextChip). */}
          <AnimatePresence initial={false}>
            {!minimized && askMode && (
              <motion.div
                key="mode-marker"
                layout="position"
                {...composerChipMotion}
                // Phones pull the model pill to the front of the toolbar (see
                // composerToolbarSelect), which would otherwise wedge it
                // between the "+" and this marker. Same order as the "+" wrap
                // keeps the pair together — equal order falls back to DOM
                // order, and the "+" is rendered first.
                className="composer-pop-wrap relative inline-flex shrink-0 phone:order-[-2]"
              >
                <Tooltip label="Ask mode: this session can read the code but not change it">
                  <button
                    type="button"
                    // Same "on" language as paletteIconBtnOn: the state
                    // lives in a filled wash, not a ring — a full-strength
                    // border reads as a validation outline, and it's the one
                    // thing that survives when the fill lands on the tinted
                    // surface this marker always sits on. Slightly stronger
                    // than that rule's 16/24 for exactly that reason: here the
                    // wash is the same ink as the surface under it.
                    // `rounded-control`, not the pill it used to be: this chip
                    // stands next to the model pill and the icon buttons, and
                    // three different corners in one 88px row is what made the
                    // toolbar read as assembled rather than designed.
                    className={cn(
                      // 12px copy against a 14px glyph, matching the model pill
                      // beside it: at 11px-against-15px the label read as a
                      // caption hung off an icon rather than the mode's name.
                      "inline-flex min-h-8 items-center gap-1.5 rounded-control px-2.5 text-label font-medium transition-colors",
                      "bg-[color-mix(in_srgb,var(--green)_18%,transparent)] text-green hover:bg-[color-mix(in_srgb,var(--green)_26%,transparent)]",
                    )}
                    // Ask mode has no one-click exit — leaving it cuts a
                    // worktree — so the marker opens the menu and lets you pick
                    // the labelled row. (Note mode, which does, says so with a
                    // dismissible chip above the field instead.)
                    {...tapProps(() => setMenu("add"))}
                    disabled={disabled}
                  >
                    <IconEye size={14} />
                    Ask
                  </button>
                </Tooltip>
              </motion.div>
            )}
          </AnimatePresence>
          {/* `grow basis-0 shrink-0` rather than `flex-1`: every direct child of
              the toolbar is pinned at flex-shrink 0 so the model pill is the
              only thing that gives way, and a shorthand would take that back. */}
          {!minimized && <div className="shrink-0 grow basis-0" />}

          {/* Model + effort live together on the right edge (ChatGPT-style):
              one pill, effort levels up top, the model behind a submenu.
              Phones reorder it next to the + button via flex order (see
              composerToolbarSelect). */}
          <AnimatePresence initial={false}>
            {!minimized && (
              <motion.div
                key="model-effort"
                layout="position"
                {...composerChipMotion}
                className={composerToolbarSelect}
              >
                <ModelEffortSelect
                  className={cn(palettePill, composerToolbarPill)}
                  title={modelTitle || "Model and reasoning effort for this session"}
                  models={models}
                  defaultModel={defaultModel}
                  model={model}
                  onModelChange={onModelChange}
                  modelDisabled={modelDisabled}
                  modelTitle={modelTitle}
                  effort={effort}
                  onEffortChange={onEffortChange}
                  fastMode={fastMode}
                  onFastModeChange={onFastModeChange}
                  accounts={accounts}
                  accountId={accountId}
                  onAccountChange={onAccountChange}
                  usage={usage}
                  showUsage
                  disabled={disabled}
                  onOpenChange={setModelMenuOpen}
                />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Wrapper around the dictation mic — gives Motion a layout box so it
              glides between rows during the morph without disturbing either. */}
          <motion.div
            layout="position"
            transition={composerMorph}
            layoutDependency={minimized}
            className={cn(
              "inline-flex shrink-0 items-center",
              minimized && "order-3",
            )}
          >
            {/* The mic is one of the resting pill's circles, so it takes the
                round variant with the "+" — that pairing used to come from a
                `.composer.composer-min .palette-icon-btn` descendant rule. */}
            <VoiceInput
              className={cn(
                paletteIconBtn,
                minimized && paletteIconBtnRound,
                !minimized && "phone:[&_svg]:size-[22px]",
              )}
              onText={insertDictation}
              disabled={disabled}
            />
          </motion.div>

          {busy && onStop && (
            <Tooltip label="Stop. Interrupts the current turn; the session stays ready.">
              <button
                type="button"
                className={cn(
                  composerSend,
                  composerSendStop,
                  // Without an order the stop button defaults to 0 and jumps to
                  // the far left of the resting row; seat it just before send.
                  minimized && "order-4",
                  minimized && composerSendMinimizedFill,
                )}
                {...tapProps(() => onStop())}
                disabled={disabled}
                aria-label="Stop current turn"
              >
                <IconStopSquare size={24} />
              </button>
            </Tooltip>
          )}
          {/* One busy-send button: the Enter follow-up preference (Settings →
              Preferences, default queue) picks its busy action; holding
              Command/Ctrl switches to the ⌘/Ctrl+Enter preference (default
              steer). Niche actions such as scheduling live under the + menu. */}
          {showSend && (
            <motion.div
              layout="position"
              transition={composerMorph}
              layoutDependency={minimized}
              className={cn(
                "relative inline-flex shrink-0 items-stretch",
                minimized && "order-5",
              )}
            >
              <ContextMenu.Root>
                <Tooltip
                  label={
                    noteMode
                      ? `Add note (${sendKeyLabel(sendKey)})`
                      : steerSend
                        ? "Steer message"
                        : sendTitle ||
                          (busy
                            ? "Queue message"
                            : `Send (${sendKeyLabel(sendKey)})`)
                  }
                >
                  <ContextMenu.Trigger
                    render={
                      <button
                        className={cn(
                          composerSend,
                          // A note posts straight away, so it keeps the plain
                          // send plate even while a turn is running.
                          noteMode
                            ? composerSendDefault
                            : steerSend
                              ? composerSendSteer
                              : busy
                                ? composerSendQueue
                                : composerSendDefault,
                          minimized && composerSendMinimizedFill,
                        )}
                        {...tapProps(() =>
                          fireSend(
                            onSend,
                            steerSend ? { steer: true } : undefined,
                          ),
                        )}
                        disabled={disabled || isSendDisabled}
                        aria-label={
                          noteMode
                            ? "Add note"
                            : steerSend
                              ? "Steer into the running turn"
                              : busy
                                ? "Queue until the current turn finishes"
                                : "Send message"
                        }
                      />
                    }
                  >
                    {/* The arrow comes down with the disc in the resting pill — a
                        24px glyph all but touches the smaller plate's edge. */}
                    {busy && !steerSend && !noteMode ? (
                      <IconReturn size={minimized ? 20 : 24} />
                    ) : (
                      <IconArrowUp size={minimized ? 20 : 24} />
                    )}
                  </ContextMenu.Trigger>
                </Tooltip>
                <ContextMenu.Popup className="min-w-[230px]">
                  <ContextMenu.Item
                    onClick={() => pickBusySend("queue")}
                  >
                    <IconReturn size={20} />
                    <span className="grow">Queue after run finishes</span>
                    {busySendKeys("queue") && (
                      <ContextMenu.Shortcut>
                        {busySendKeys("queue")}
                      </ContextMenu.Shortcut>
                    )}
                    {busySendPrefs.enter === "queue" && (
                      <IconCheck size={16} className="text-accent" />
                    )}
                  </ContextMenu.Item>
                  <ContextMenu.Item
                    onClick={() => pickBusySend("steer")}
                  >
                    <IconArrowUp size={20} />
                    <span className="grow">Steer into running turn</span>
                    {busySendKeys("steer") && (
                      <ContextMenu.Shortcut>
                        {busySendKeys("steer")}
                      </ContextMenu.Shortcut>
                    )}
                    {busySendPrefs.enter === "steer" && (
                      <IconCheck size={16} className="text-accent" />
                    )}
                  </ContextMenu.Item>
                </ContextMenu.Popup>
              </ContextMenu.Root>
            </motion.div>
          )}
        </div>
        {/* Phone vim key bar — the on-screen keyboard has no Esc/Tab/arrow
            keys (and the native accessory bar is WebKit chrome we can't
            touch), so give vim users a Termius-style key row pinned above the
            keyboard. Software keys route through vim.injectKey: consumed by
            the engine in normal/visual mode, emulated on the textarea in
            insert mode.

            iOS tap handling is the load-bearing part: a tap's default
            continuation is touchend → synthesized mousedown (blurs the
            textarea, dismissing the keyboard) → click — and the blur flips
            `focused`, which would unmount this bar BEFORE the click fires
            (preventing pointerdown does NOT stop any of that on iOS; it lost
            us the whole bar on-device). So each key acts on touchend and
            cancels it, suppressing the entire mouse-synthesis chain; onClick
            stays for mouse/pen, with a recent-touch guard for browsers that
            fire both. The bar also stays mounted outside insert mode even if
            focus is lost, so it can never vanish mid-interaction. */}
        {vimEnabled && isPhone && !minimized && (focused || vim.mode !== "insert") && (
          <div
            className="mt-1.5 flex gap-1.5 border-t border-line pt-1.5"
            onPointerDown={(e) => e.preventDefault()}
            onMouseDown={(e) => e.preventDefault()}
          >
            {(
              [
                ["esc", "Escape"],
                ["tab", "Tab"],
                ["←", "ArrowLeft"],
                ["↓", "ArrowDown"],
                ["↑", "ArrowUp"],
                ["→", "ArrowRight"],
              ] as const
            ).map(([label, key]) => (
              <button
                key={key}
                type="button"
                className={`h-8 flex-1 select-none rounded-md border border-line bg-surface text-label font-semibold text-dim active:bg-panel ${
                  key === "Escape" && vim.mode !== "insert"
                    ? "border-accent text-fg"
                    : ""
                }`}
                {...tapProps(() => vim.injectKey(key))}
                aria-label={key}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </motion.div>
      {/* The keyboard-shortcut hint is irrelevant on touch and eats vertical
          space right where the keyboard appears. */}
      {hint && (
        <div className="mt-[7px] text-center text-meta text-faint phone:hidden">
          {hint}
        </div>
      )}
      {/* Outside the toolbar: the stop button lives in a row that the phone
          composer unmounts when it minimizes, and the question has to survive
          the composer losing focus to the dialog. */}
      <StopConfirmModal
        open={stopConfirm}
        onOpenChange={setStopConfirm}
        onConfirm={() => {
          setStopConfirm(false);
          onStop?.();
        }}
      />
    </div>
  );
}
