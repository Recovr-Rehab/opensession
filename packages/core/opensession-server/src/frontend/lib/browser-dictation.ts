/**
 * Live browser speech recognition for web dictation.
 *
 * Chrome and Safari can return partial text while the microphone is still
 * open. VoiceInput records the same utterance as a fallback, so a missing or
 * failed browser recognizer still uses the server's full-clip transcription.
 */

type SpeechResult = {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { readonly transcript: string };
};

type SpeechResultList = {
  readonly length: number;
  readonly [index: number]: SpeechResult;
};

type SpeechResultEvent = Event & { readonly results: SpeechResultList };

type SpeechErrorEvent = Event & { readonly error?: string };

type SpeechRecognizer = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognizerConstructor = new () => SpeechRecognizer;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognizerConstructor;
    webkitSpeechRecognition?: SpeechRecognizerConstructor;
  }
}

const FINAL_RESULT_WAIT_MS = 700;

function joinSpeech(left: string, right: string): string {
  const a = left.trim();
  const b = right.trim();
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`;
}

export function speechResultsText(results: SpeechResultList): string {
  let text = "";
  for (let index = 0; index < results.length; index++) {
    text = joinSpeech(text, results[index]?.[0]?.transcript || "");
  }
  return text;
}

export type BrowserDictation = {
  /** Ask the recognizer for its final correction, with a short hard bound. */
  finish(): Promise<string>;
  /** Stop without keeping any recognized text. */
  cancel(): void;
};

/**
 * Start a live recognizer if this browser has one. The caller should keep its
 * MediaRecorder running in parallel because browser speech services can be
 * unavailable even when the API exists.
 */
export function startBrowserDictation(
  onTranscript: (text: string) => void,
): BrowserDictation | null {
  if (typeof window === "undefined") return null;
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return null;

  let recognition: SpeechRecognizer;
  try {
    recognition = new Recognition();
  } catch {
    return null;
  }

  let prefix = "";
  let sessionText = "";
  let active = true;
  let finishing = false;
  let failed = false;
  let finishPromise: Promise<string> | null = null;
  let resolveFinish: ((text: string) => void) | null = null;
  let finishTimer: number | null = null;
  let restartTimer: number | null = null;

  const currentText = () => joinSpeech(prefix, sessionText);

  function settle() {
    if (finishTimer !== null) window.clearTimeout(finishTimer);
    finishTimer = null;
    resolveFinish?.(failed && !currentText() ? "" : currentText());
    resolveFinish = null;
  }

  function begin() {
    if (!active || finishing || failed) return;
    try {
      recognition.start();
    } catch {
      failed = true;
    }
  }

  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.lang = navigator.languages?.[0] || navigator.language || "en-US";
  recognition.onresult = (event) => {
    sessionText = speechResultsText(event.results);
    const text = currentText();
    if (text) onTranscript(text);
  };
  recognition.onerror = (event) => {
    // Aborting is the normal cancel path. Any other failure leaves the audio
    // recorder in charge of transcription.
    if (event.error !== "aborted") failed = true;
  };
  recognition.onend = () => {
    if (finishing || !active || failed) {
      settle();
      return;
    }

    // Chrome can close a continuous recognition session after a long pause.
    // Keep its text and reopen the service while recording remains active.
    prefix = currentText();
    sessionText = "";
    restartTimer = window.setTimeout(() => {
      restartTimer = null;
      begin();
    }, 0);
  };

  try {
    recognition.start();
  } catch {
    return null;
  }

  return {
    finish() {
      if (finishPromise) return finishPromise;
      active = false;
      finishing = true;
      if (restartTimer !== null) window.clearTimeout(restartTimer);
      restartTimer = null;
      if (failed) {
        finishPromise = Promise.resolve("");
        return finishPromise;
      }
      finishPromise = new Promise<string>((resolve) => {
        resolveFinish = resolve;
        finishTimer = window.setTimeout(settle, FINAL_RESULT_WAIT_MS);
      });
      try {
        recognition.stop();
      } catch {
        settle();
      }
      return finishPromise;
    },
    cancel() {
      active = false;
      finishing = true;
      if (restartTimer !== null) window.clearTimeout(restartTimer);
      if (finishTimer !== null) window.clearTimeout(finishTimer);
      restartTimer = null;
      finishTimer = null;
      resolveFinish?.("");
      resolveFinish = null;
      try {
        recognition.abort();
      } catch {
        // A recognizer that already ended needs no further cleanup.
      }
    },
  };
}
