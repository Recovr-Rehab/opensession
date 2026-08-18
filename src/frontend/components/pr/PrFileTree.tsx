import { FileTree, useFileTree } from "@pierre/trees/react";
import { useRef } from "react";

function allDirectories(paths: string[]): string[] {
  const directories = new Set<string>();
  for (const path of paths) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  }
  return [...directories];
}

export function PrFileTree({
  paths,
  onOpenFile,
  compact = false,
}: {
  paths: string[];
  onOpenFile: (path: string) => void;
  compact?: boolean;
}) {
  const onOpenFileRef = useRef(onOpenFile);
  onOpenFileRef.current = onOpenFile;
  const { model } = useFileTree({
    paths,
    initialExpandedPaths: allDirectories(paths),
    onSelectionChange: (selection) => {
      const path = selection[0] ? String(selection[0]) : null;
      if (path && paths.includes(path)) onOpenFileRef.current(path);
    },
  });

  return (
    <aside
      id="pr-file-tree"
      aria-label="Changed files"
      className={
        compact
          ? "sticky top-11 z-[7] flex h-[320px] max-h-[42vh] flex-col bg-raised shadow-[inset_0_-1px_0_var(--divider)]"
          : "flex min-h-0 w-[280px] shrink-0 flex-col bg-raised shadow-[inset_-1px_0_0_var(--divider)]"
      }
    >
      <div className="flex h-10 shrink-0 items-center gap-2 px-3 text-label font-medium text-fg shadow-[inset_0_-1px_0_var(--divider)]">
        <span className="min-w-0 flex-1 truncate">Changed files</span>
        <span className="text-meta font-normal tabular-nums text-faint">{paths.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden px-1 py-1.5">
        <FileTree
          model={model}
          className="block h-full [color-scheme:dark] [--trees-accent-override:var(--accent)] [--trees-bg-override:transparent] [--trees-border-color-override:var(--divider)] [--trees-fg-muted-override:var(--text-faint)] [--trees-fg-override:var(--text-dim)] [--trees-focus-ring-color-override:var(--accent)] [--trees-selected-bg-override:var(--selected)] [--trees-selected-fg-override:var(--text)]"
        />
      </div>
    </aside>
  );
}
