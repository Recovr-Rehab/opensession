import React from "react";
import { repoLetter } from "../lib/repo-label";
import { repoColor, repoIconRevision } from "../lib/repo-colors";

// The display-name map lives in lib/repo-label and the tile colors in
// lib/repo-colors, so lib-level formatters can reach both without a component
// import; re-exported here because most callers reach them alongside the tile.
// Both stay keyed on the raw id, so they're stable across a display rename.
export { repoLabel } from "../lib/repo-label";
export { repoColor } from "../lib/repo-colors";

// Bumped when the icons behind /repo-icon/<id>.png are redrawn: the response
// is cacheable, so without a new URL an installed PWA keeps painting the old
// art until its copy expires. 3 dropped the owner/org-avatar fallback, so the
// repos that were wearing their org's mark had to stop asking for it; 4 trims
// the empty margin around every icon, so the copies drawn small have to go.
const ICON_VERSION = 4;

// A repo's icon tile (sidebar Repo dropdown, session-header breadcrumb, repo
// menus): the server's /repo-icon/<id>.png when the repo was given an icon of
// its own, else a colored letter — the default, and deliberately so, since an
// org's mark is the same picture for every repo it owns. The color is assigned
// per repo across the registered set (lib/repo-colors), so two tiles differ
// even when their letters don't. Every icon arrives drawn to the same
// proportions (see the route), so the tile scales them all identically.
// `size` (px) shrinks it for tight spots like the phone header's model line;
// omitted = the 18px default. `round` makes it a full circle (e.g. the phone
// title pill, where it sits against the pill's own rounding).
export function RepoTile({
	name,
	size,
	round,
}: {
	name: string;
	size?: number;
	round?: boolean;
}) {
	// Failure is tracked per name AND icon revision, so a tile retries the img
	// both when it switches repo and when this repo's art changes — a repo
	// given an icon from Settings had already 404'd, and without the revision
	// in the key it would keep painting its letter until a reload.
	const [failedFor, setFailedFor] = React.useState<string | null>(null);
	const style: React.CSSProperties = {};
	if (size) {
		style.width = size;
		style.height = size;
		style.fontSize = Math.round(size * 0.6);
		style.borderRadius = round ? "50%" : Math.max(3, Math.round(size * 0.28));
	} else if (round) {
		style.borderRadius = "50%";
	}
	const rev = repoIconRevision(name);
	const attempt = `${name}:${rev ?? 0}`;
	if (failedFor !== attempt) {
		return (
			<span className="repo-tile repo-tile--img" style={style}>
				<img
					src={`/repo-icon/${encodeURIComponent(name)}.png?v=${ICON_VERSION}${
						rev ? `&r=${rev}` : ""
					}`}
					alt=""
					loading="lazy"
					onError={() => setFailedFor(attempt)}
				/>
			</span>
		);
	}
	style.background = repoColor(name);
	const letter = repoLetter(name);
	return (
		<span className="repo-tile" style={style}>
			{letter}
		</span>
	);
}
