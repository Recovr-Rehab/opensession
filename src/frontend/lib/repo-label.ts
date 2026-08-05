// A few repos display under a different name than their internal id. The
// self-hosted repo is one of them: the product's wordmark is two words
// ("Open Session") but its repo is one, so id `opensession` keeps reading
// `opensession` everywhere its name is shown, with an `O` tile glyph.
//
// This is presentation only: ids stay canonical on the wire, in worktree
// paths, in `ghRepo`, and in every API payload. It lives in lib/ (not next to
// RepoTile) so lib-level formatters like pr-refs.ts can reach it without a
// component import.
const REPO_DISPLAY: Record<string, { label: string; letter: string }> = {
	opensession: { label: "opensession", letter: "O" },
};

/** The name a repo shows in the UI (its id, except for the renamed ones). */
export function repoLabel(id: string): string {
	return REPO_DISPLAY[id]?.label ?? id;
}

/** The glyph a repo's fallback letter tile shows. */
export function repoLetter(id: string): string {
	return REPO_DISPLAY[id]?.letter ?? (id[0] || "?").toUpperCase();
}
