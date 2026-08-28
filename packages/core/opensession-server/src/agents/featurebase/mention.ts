/** Complete-token mention of the configured handle, with or without @. */
export function featurebaseMentionRe(handle: string): RegExp {
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![A-Za-z0-9_])@?${escaped}(?![A-Za-z0-9_])`, "i");
}
