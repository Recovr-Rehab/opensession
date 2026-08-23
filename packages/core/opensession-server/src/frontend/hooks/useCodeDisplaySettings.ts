import { useCallback, useEffect, useState } from "react";

export type DiffStyle = "unified" | "split";
export type CodeTheme = "system" | "light" | "dark";

export interface CodeDisplaySettingsState {
  diffStyle: DiffStyle;
  changeDiffStyle: (next: DiffStyle) => void;
  wrapLines: boolean;
  changeWrapLines: (next: boolean) => void;
  structuralHighlighting: boolean;
  changeStructuralHighlighting: (next: boolean) => void;
  showFileStats: boolean;
  changeShowFileStats: (next: boolean) => void;
  codeTheme: CodeTheme;
  changeCodeTheme: (next: CodeTheme) => void;
}

const SETTING_EVENT = "opensession-code-setting";

export function useStoredCodeSetting<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => {
    const stored = localStorage.getItem(key) as T | null;
    return stored && allowed.includes(stored) ? stored : fallback;
  });
  const change = useCallback(
    (next: T) => {
      setValue(next);
      try {
        localStorage.setItem(key, next);
        window.dispatchEvent(
          new CustomEvent(SETTING_EVENT, { detail: { key, value: next } }),
        );
      } catch {}
    },
    [key],
  );
  const allowedKey = allowed.join("\0");
  useEffect(() => {
    const sync = (event: Event) => {
      const detail = (
        event as CustomEvent<{ key?: string; value?: string }>
      ).detail;
      if (detail?.key === key && allowed.includes(detail.value as T)) {
        setValue(detail.value as T);
      }
    };
    window.addEventListener(SETTING_EVENT, sync);
    return () => window.removeEventListener(SETTING_EVENT, sync);
    // Callers often pass a literal list. Its values, not its array identity,
    // decide when this listener needs a new validation closure.
  }, [key, allowedKey]);
  return [value, change];
}

/** Rendering preferences shared by the full Review canvas and sidebar Changes. */
export function useCodeDisplaySettings(
  defaultDiffStyle: DiffStyle,
): CodeDisplaySettingsState {
  const [diffStyle, changeDiffStyle] = useStoredCodeSetting(
    "opensession-pr-diff-style",
    ["unified", "split"] as const,
    defaultDiffStyle,
  );
  const [wrapSetting, changeWrapSetting] = useStoredCodeSetting(
    "opensession-pr-diff-wrap",
    ["0", "1"] as const,
    "0",
  );
  const [structuralSetting, changeStructuralSetting] = useStoredCodeSetting(
    "opensession-pr-structural-highlighting",
    ["0", "1"] as const,
    "1",
  );
  const [fileStatsSetting, changeFileStatsSetting] = useStoredCodeSetting(
    "opensession-pr-file-stats",
    ["0", "1"] as const,
    "1",
  );
  const [codeTheme, changeCodeTheme] = useStoredCodeSetting(
    "opensession-pr-code-theme",
    ["system", "light", "dark"] as const,
    "system",
  );

  return {
    diffStyle,
    changeDiffStyle,
    wrapLines: wrapSetting === "1",
    changeWrapLines: (next) => changeWrapSetting(next ? "1" : "0"),
    structuralHighlighting: structuralSetting === "1",
    changeStructuralHighlighting: (next) =>
      changeStructuralSetting(next ? "1" : "0"),
    showFileStats: fileStatsSetting === "1",
    changeShowFileStats: (next) => changeFileStatsSetting(next ? "1" : "0"),
    codeTheme,
    changeCodeTheme,
  };
}
