/** A DataTransfer has no files to inspect until drop. Its type list is the
 * reliable way to distinguish an OS file drag from links and internal rows. */
export function hasDraggedFiles(
  dataTransfer: Pick<DataTransfer, "types"> | null | undefined,
): boolean {
  return Array.from(dataTransfer?.types ?? []).includes("Files");
}

export const GLOBAL_FILE_COMPOSER_ATTR = "data-global-file-composer";

/** Whether a visible foreground composer owns the app-wide file drop. Hidden,
 * kept-mounted surfaces have no client rects and cannot steal the active drop. */
export function foregroundFileComposerOpen(
  candidates?: Iterable<{ getClientRects(): { length: number } }>,
): boolean {
  const nodes =
    candidates ??
    (typeof document === "undefined"
      ? []
      : document.querySelectorAll<HTMLElement>(
          `[${GLOBAL_FILE_COMPOSER_ATTR}]`,
        ));
  return Array.from(nodes).some((node) => node.getClientRects().length > 0);
}
