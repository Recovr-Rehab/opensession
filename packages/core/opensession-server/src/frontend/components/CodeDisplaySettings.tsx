import type { CodeDisplaySettingsState } from "../hooks/useCodeDisplaySettings";
import { Segmented, SegmentedOption } from "../ui/segmented";
import { SettingRow, SwitchRow } from "../ui/setting-row";

/** The diff-rendering section shared by Review and sidebar Changes. */
export function CodeDisplaySettings({
  diffStyle,
  changeDiffStyle,
  wrapLines,
  changeWrapLines,
  structuralHighlighting,
  changeStructuralHighlighting,
  showFileStats,
  changeShowFileStats,
  codeTheme,
  changeCodeTheme,
}: CodeDisplaySettingsState) {
  return (
    <>
      <SettingRow label="Layout">
        <Segmented
          label="Diff layout"
          size="sm"
          value={diffStyle}
          onValueChange={(next) =>
            changeDiffStyle(next as "unified" | "split")
          }
        >
          <SegmentedOption value="split">Split</SegmentedOption>
          <SegmentedOption value="unified">Unified</SegmentedOption>
        </Segmented>
      </SettingRow>
      <SwitchRow
        label="Wrap lines"
        checked={wrapLines}
        onCheckedChange={changeWrapLines}
      />
      <SwitchRow
        label="Highlight changed words"
        checked={structuralHighlighting}
        onCheckedChange={changeStructuralHighlighting}
      />
      <SwitchRow
        label="Line counts"
        checked={showFileStats}
        onCheckedChange={changeShowFileStats}
      />
      <SettingRow label="Theme">
        <Segmented
          label="Code theme"
          size="sm"
          value={codeTheme}
          onValueChange={(next) =>
            changeCodeTheme(next as "system" | "light" | "dark")
          }
        >
          <SegmentedOption value="system">Match app</SegmentedOption>
          <SegmentedOption value="light">Light</SegmentedOption>
          <SegmentedOption value="dark">Dark</SegmentedOption>
        </Segmented>
      </SettingRow>
    </>
  );
}
