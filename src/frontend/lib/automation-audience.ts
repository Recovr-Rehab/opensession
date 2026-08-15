/**
 * Which automations belong in the sidebar you are looking at.
 *
 * An automation reports to people, the same way a session is started by one,
 * so the sidebar's person lens should narrow both. The audience itself is
 * resolved server-side (`automationRecipients`, src/server/automations.ts) and
 * arrives on {@link AutomationOverview} as a plain list of names — everything
 * here is the matching, which is a pure function of that list plus the lens.
 */

import { DEFAULT_REPO_ID } from "./brand";
import type { AutomationOverview } from "./api/automations";

/**
 * Does this recipient name the person the lens is on? One teammate reaches us
 * as "Kent", "Kent de Bruin" and "kentdebruin" depending on whether the name
 * came from a config roster, a display name or a GitHub login, so the compare
 * is the app's usual loose one: equal, or either a prefix of the other.
 */
export function recipientMatchesPerson(
	recipient: string,
	personKey: string,
): boolean {
	const a = recipient.trim().toLowerCase();
	const b = personKey.trim().toLowerCase();
	if (!a || !b) return false;
	return a === b || a.startsWith(b) || b.startsWith(a);
}

/**
 * The four lens values, spelled out:
 *
 * - `everyone` — every automation, which is what the band showed before it
 *   had an audience at all.
 * - `me` — the ones that report to you. Nobody signed in can't answer that,
 *   so it falls back to everyone rather than to an empty band.
 * - `unassigned` — only the ones with nobody named: a house automation whose
 *   creator is gone or was never a person.
 * - a person key — the ones that report to that teammate.
 */
export function automationInPersonLens(
	automation: Pick<AutomationOverview, "recipients">,
	person: string,
	currentUser: string,
): boolean {
	const recipients = automation.recipients || [];
	if (person === "everyone") return true;
	if (person === "unassigned") return recipients.length === 0;
	const key =
		person === "me" ? currentUser.trim().toLowerCase() : person.trim();
	if (!key || key === "anonymous") return person === "me";
	return recipients.some((r) => recipientMatchesPerson(r, key));
}

/**
 * The repo lens, for automations. An automation's own `repo` is where it runs;
 * unset means the instance default, the same fallback the server applies. A
 * workspace it files under can name a different repo, and that counts too, so
 * narrowing to a repo doesn't hide an automation filed in one of its
 * workspaces.
 */
export function automationInRepoLens(
	automation: Pick<AutomationOverview, "repo" | "workspaceRepo">,
	repo: string,
): boolean {
	if (repo === "all") return true;
	return (
		(automation.repo || DEFAULT_REPO_ID) === repo ||
		automation.workspaceRepo === repo
	);
}
