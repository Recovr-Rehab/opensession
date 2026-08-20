import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "motion/react";
import { transcribeClip } from "../lib/api";
import { IconArrowUp, IconCheck, IconMic, IconX } from "./icons";
import { Tooltip } from "../ui/tooltip";
import { PRODUCT_NAME } from "../lib/brand";
import { cn } from "../ui/cn";
import { duration, ease } from "../ui/motion";
import { paletteIconBtn } from "../lib/palette-classes";
import { composerSend, composerSendDefault } from "../lib/composer-classes";

type Phase = "idle" | "requesting" | "recording" | "transcribing";

/** Dictation is capped. This is a session input, not a memo recorder. */
const MAX_SECONDS = 120;
const BAR_COUNT = 72;

/* The recording bar's chrome. Every variant is written out in full rather than
   composed from a fragment: Tailwind scans source text, so a class assembled
   from a variable is never generated.

   The bar covers the WHOLE input rather than parking on its bottom edge: while
   a clip is recording there is nothing to read and nothing to edit in the
   draft underneath, and a half-visible field invited a caret into text the
   dictation was about to append to. It carries the host surface's own fill so
   the waveform reads as drawn straight onto the container, not onto a second
   raised slab inside it. */
const OVERLAY =
	"pointer-events-auto absolute inset-0 z-[6] flex items-end gap-1.5 bg-[var(--composer-surface)] px-3.5 pb-2.5 phone:px-3 phone:pb-[9px]";
/** Default corner. A host whose container is rounded differently passes its
 *  own (the new-session card is `rounded-2xl`). */
const OVERLAY_RADIUS = "rounded-[var(--composer-radius)]";

/* Waveform bars. Colour lives on the variant, never alongside a second colour
   utility on the same element. Two of those don't compose, the sheet's order
   decides the winner. Bars without a sample yet are a 2px baseline dot; live
   ones get their height inline from the level meter. */
const WAVE_BAR_IDLE = "mx-auto h-0.5 w-0.5 min-w-0 max-w-0.5 flex-1 rounded-xs bg-faint";
const WAVE_BAR_LIVE =
	"mx-auto h-0.5 w-0.5 min-w-0 max-w-0.5 flex-1 rounded-xs bg-dim transition-[height] duration-[90ms] ease-linear";

/* Plain glyph buttons have no fill or border. The ✓ picks up the accent. */
const GLYPH_CANCEL =
	"inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-dim transition-colors hover:bg-hover hover:text-fg disabled:cursor-default disabled:opacity-35";
const GLYPH_ACCEPT =
	"inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md border-none bg-transparent text-fg transition-colors hover:bg-hover hover:text-accent disabled:cursor-default disabled:opacity-35";

/* The `voice-spinner` hook is gone: base.css's reduced-motion block used to
   name it to pin the rotation to a constant 0.8s, but that block now matches
   `[class*="animate-spin"]`, the utility itself, and pins the same 0.8s, so
   the name earned nothing. Measured both ways, plain and under emulated
   reduced motion, before removing it. The border is written one side at a time
   on purpose. A `border-color` shorthand next to a `border-top-color` is the
   same two-utilities-one-property race as the waveform colours above. */
const SPINNER =
	"h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-l-line-strong border-r-line-strong border-b-line-strong border-t-dim [animation-duration:0.8s]";

/** The recording row arrives through a short blur rather than sliding. The
 *  overlay's surface itself is not animated: it covers the field on the first
 *  frame, so text cannot remain visible while the controls settle in. */
const ROW_MOTION = {
	initial: { filter: "blur(4px)" },
	animate: { filter: "blur(0px)" },
	transition: { type: "tween", duration: duration.base, ease },
} as const;
const GLYPH_MORPH = {
	type: "spring",
	duration: duration.large,
	bounce: 0,
} as const;
const MIC_OUT = {
	initial: { opacity: 1, filter: "blur(0px)", scale: 1 },
	animate: { opacity: 0, filter: "blur(4px)", scale: 0.25 },
	transition: GLYPH_MORPH,
} as const;
const CHECK_IN = {
	initial: { opacity: 0, filter: "blur(4px)", scale: 0.25 },
	animate: { opacity: 1, filter: "blur(0px)", scale: 1 },
	transition: GLYPH_MORPH,
} as const;

/**
 * Wispr-Flow-style dictation control shared by the session Composer and the
 * New-session palette. Idle it's just a mic button; tapping it takes over the
 * whole input surface with a recording bar (cancel × · live waveform · save ✓ ·
 * save and send ↑), then a "Transcribing…" bar while the clip runs through
 * /api/transcribe, and finally hands the text to `onText` or, when the send
 * button asked for it, to `onTextSend`.
 *
 * ✓ and ↑ differ only in what happens after the text lands: ✓ leaves it in the
 * draft to read and edit (and dictating again appends to it), ↑ sends the
 * message as it stands.
 *
 * The bar renders as an absolutely-positioned overlay filling the nearest
 * positioned ancestor, so the host container must be positioned: `.composer`
 * in the session view, and the palette's Modal.Content, whose `variant="palette"`
 * carries `relative` for exactly this.
 */
export function VoiceInput({
  onText,
  onTextSend,
  disabled,
  className = paletteIconBtn,
  overlayClassName,
  overlayStyle,
  overlayTargetRef,
  editTargetRef,
  onActiveChange,
}: {
  onText: (text: string) => void;
  /** Take the text and send it straight away. Without one, the send button is
   *  not drawn. A host with nothing to send to only offers ✓. */
  onTextSend?: (text: string) => void;
  disabled?: boolean;
  /** Classes for the idle mic button. Both hosts pass their own: the
   *  new-session footer so the mic keeps the sizing its neighbours get there,
   *  the composer so it turns into a circle with the "+" in the resting
   *  pill. */
  className?: string;
  /** Corner (and any surface override) for the recording bar, to match the
   *  container it covers. */
  overlayClassName?: string;
  overlayStyle?: React.CSSProperties;
  /** Optional full-input layer. The session Composer's mic lives inside its
   *  toolbar, so its overlay is portaled to a box covering the Composer. */
  overlayTargetRef?: React.RefObject<HTMLElement | null>;
  /** The draft field to restore after keeping, cancelling, or an error. */
  editTargetRef?: React.RefObject<HTMLElement | null>;
  /** Lets a host collapse its container while dictation owns the input. */
  onActiveChange?: (active: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<number[]>([]);
  const recRef = useRef<MediaRecorder | null>(null);
  /** Invalidates an unresolved permission request when recording is cancelled
   *  or the control unmounts. A late stream is stopped instead of recording. */
  const requestRef = useRef(0);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const callbacksRef = useRef({ onText, onTextSend });
  callbacksRef.current = { onText, onTextSend };
  const activeChangeRef = useRef(onActiveChange);
  activeChangeRef.current = onActiveChange;
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const acceptRef = useRef(false);
  /** Which button ended the clip: ↑ sends the result, ✓ just keeps it. */
  const sendRef = useRef(false);
  const timersRef = useRef<number[]>([]);

  function cleanup() {
    timersRef.current.forEach((t) => clearInterval(t));
    timersRef.current = [];
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    recRef.current = null;
  }
  useEffect(
    () => () => {
      requestRef.current++;
      cleanup();
    },
    [],
  );

  // The overlay is visually modal, so make it modal to keyboards and assistive
  // technology too. The portal target remains interactive; its siblings are
  // restored to exactly the inert state they had before recording.
  const active = phase !== "idle";
  useEffect(() => {
    activeChangeRef.current?.(active);
    return () => {
      if (active) activeChangeRef.current?.(false);
    };
  }, [active]);
  useEffect(() => {
    const target = overlayTargetRef?.current;
    const parent = target?.parentElement;
    if (!active || !target || !parent) return;
    const siblings = Array.from(parent.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child !== target,
    );
    const previous = siblings.map((element) => [element, element.inert] as const);
    for (const [element] of previous) element.inert = true;
    return () => {
      for (const [element, inert] of previous) element.inert = inert;
    };
  }, [active, overlayTargetRef]);

  // Errors show as a small bubble above the control; clear themselves.
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 5000);
    return () => clearTimeout(t);
  }, [error]);

  function restoreEditorFocus() {
    // The first frame lets React remove `inert`; the second restores the caret
    // after that commit instead of trying to focus an inert textarea.
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        returnFocusRef.current?.focus({ preventScroll: true }),
      ),
    );
  }

  async function start() {
    setError(null);
    // getUserMedia only exists in secure contexts. Over plain http (the
    // :3850 hostname) the mic simply isn't there.
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError(`Mic needs HTTPS. Open ${PRODUCT_NAME} at its ts.net URL.`);
      return;
    }
    // Take over the field in the same gesture that asked for the mic. Waiting
    // for a permission round trip first made the button appear unresponsive.
    const request = ++requestRef.current;
    setPhase("requesting");
    // The bar hides the field, so the caret must leave it too: a keystroke
    // into text nobody can see is an edit made blind, and the dictation is
    // about to append to that same draft.
    const focused = document.activeElement as HTMLElement | null;
    returnFocusRef.current = editTargetRef?.current ?? focused;
    focused?.blur?.();

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      if (request === requestRef.current) {
        setError("Microphone permission denied");
        setPhase("idle");
        restoreEditorFocus();
      }
      return;
    }
    if (request !== requestRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;
    // Chrome/Firefox record webm/opus; iOS Safari only does mp4/AAC. The
    // server transcodes whatever container we send.
    const mime =
      ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) =>
        MediaRecorder.isTypeSupported?.(m),
      ) || "";
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    recRef.current = rec;
    chunksRef.current = [];
    acceptRef.current = false;
    sendRef.current = false;
    rec.ondataavailable = (e) => {
      if (e.data.size) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const accepted = acceptRef.current;
      const blob = new Blob(chunksRef.current, {
        type: rec.mimeType || mime || "audio/webm",
      });
      cleanup();
      if (accepted) void finish(blob, request);
      else {
        setPhase("idle");
        restoreEditorFocus();
      }
    };

    // Live level meter for the waveform is progressive enhancement. Recording
    // works fine without it.
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx: AudioContext = new Ctx();
      audioCtxRef.current = ctx;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      timersRef.current.push(
        window.setInterval(() => {
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          setLevels((prev) => [...prev.slice(-(BAR_COUNT - 1)), Math.min(1, rms * 4)]);
        }, 90),
      );
    } catch {
      // no waveform, no problem
    }

    const startedAt = Date.now();
    setLevels([]);
    timersRef.current.push(
      window.setInterval(() => {
        if (Date.now() - startedAt >= MAX_SECONDS * 1000) stop(true);
      }, 1000),
    );
    rec.start(250);
    setPhase("recording");
  }

  function stop(accept: boolean, send = false) {
    if (phase === "requesting") {
      requestRef.current++;
      setPhase("idle");
      restoreEditorFocus();
      return;
    }
    const rec = recRef.current;
    if (!rec || rec.state === "inactive") return;
    acceptRef.current = accept;
    sendRef.current = accept && send;
    if (accept) setPhase("transcribing");
    rec.stop();
  }

  async function finish(blob: Blob, request: number) {
    let restoreFocus = false;
    try {
      const text = await transcribeClip(blob);
      if (request !== requestRef.current) return;
      const callbacks = callbacksRef.current;
      if (!text) {
        setError("Heard nothing. Try again.");
        restoreFocus = true;
      } else if (sendRef.current && callbacks.onTextSend) {
        callbacks.onTextSend(text);
      } else {
        callbacks.onText(text);
        restoreFocus = true;
      }
    } catch (e: any) {
      if (request !== requestRef.current) return;
      setError(e?.message || "Transcription failed");
      restoreFocus = true;
    } finally {
      if (request === requestRef.current) {
        sendRef.current = false;
        setPhase("idle");
        if (restoreFocus) restoreEditorFocus();
      }
    }
  }

  const overlay = phase !== "idle" && (
    <div
      className={cn(OVERLAY, overlayClassName || OVERLAY_RADIUS)}
      style={overlayStyle}
    >
      {phase === "recording" || phase === "requesting" ? (
        <motion.div
          key="recording"
          className="flex h-10 min-w-0 flex-1 items-center gap-2 phone:gap-1.5"
          {...ROW_MOTION}
        >
          <span className="sr-only" role="status" aria-live="polite">
            {phase === "requesting" ? "Starting dictation" : "Recording"}
          </span>
          {/* Leading × puts the way out where a person's eye starts. The
              two committing actions stay together on the right. */}
          <Tooltip label="Cancel">
            <button
              type="button"
              className={GLYPH_CANCEL}
              onClick={() => stop(false)}
              aria-label="Cancel dictation"
            >
              <IconX size={22} />
            </button>
          </Tooltip>
          {/* Full-width track: baseline dots on the quiet/older left, live
              bars accumulating on the right by the accept buttons. */}
          <div
            className="flex h-full min-w-0 flex-1 items-center gap-0.5 overflow-hidden"
            aria-hidden="true"
          >
            {Array.from({ length: BAR_COUNT }, (_, i) => {
              const l = levels[levels.length - BAR_COUNT + i];
              const active = l !== undefined;
              return (
                <span
                  key={i}
                  className={active ? WAVE_BAR_LIVE : WAVE_BAR_IDLE}
                  style={{ height: active ? `${16 + l * 84}%` : undefined }}
                />
              );
            })}
          </div>
          <Tooltip label="Keep it. The text lands in the draft to edit.">
            <button
              type="button"
              className={cn(GLYPH_ACCEPT, "relative")}
              onClick={() => stop(true)}
              disabled={phase === "requesting"}
              aria-label="Stop and transcribe"
            >
              {/* Start with the mic at the checkmark's resting position,
                  then blur the two glyphs through one another. */}
              <motion.span
                className="absolute inset-0 inline-flex items-center justify-center"
                {...MIC_OUT}
                aria-hidden="true"
              >
                <IconMic size={22} />
              </motion.span>
              <motion.span
                className="inline-flex"
                {...CHECK_IN}
                aria-hidden="true"
              >
                <IconCheck size={22} />
              </motion.span>
            </button>
          </Tooltip>
          {onTextSend && (
            <Tooltip label="Send it">
              <button
                type="button"
                className={cn(composerSend, composerSendDefault)}
                onClick={() => stop(true, true)}
                disabled={phase === "requesting"}
                aria-label="Stop, transcribe and send"
              >
                <IconArrowUp size={20} />
              </button>
            </Tooltip>
          )}
        </motion.div>
      ) : (
        <motion.div
          key="transcribing"
          className="flex h-10 min-w-0 flex-1 items-center gap-2.5 px-1"
          role="status"
          aria-live="polite"
          {...ROW_MOTION}
        >
          <span className={SPINNER} aria-hidden="true" />
          <span className="shrink-0 text-label font-medium text-dim">
            Transcribing…
          </span>
        </motion.div>
      )}
    </div>
  );
  const overlayTarget = overlayTargetRef?.current;

  return (
    <>
      <Tooltip label="Dictate">
        <button
          type="button"
          className={className}
          onClick={start}
          disabled={disabled || phase !== "idle"}
          aria-label="Dictate"
        >
          <IconMic size={22} />
        </button>
      </Tooltip>
      {error && phase === "idle" && (
        <div
          role="alert"
          className="absolute bottom-[calc(100%+8px)] right-0 z-[7] whitespace-nowrap rounded-control border border-[color-mix(in_srgb,var(--red)_40%,transparent)] bg-red-soft px-[11px] py-[7px] text-supporting font-medium text-red"
        >
          {error}
        </div>
      )}
      {overlayTarget && overlay ? createPortal(overlay, overlayTarget) : overlay}
    </>
  );
}
