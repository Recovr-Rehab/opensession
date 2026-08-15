/**
 * Which automations belong in the sidebar you are looking at.
 *
 * An automation reports to people, the same way a session is started by one,
 * so the sidebar's person lens should narrow both. The audience itself is
 * resolved server-side (`automationRecipients`, src/server/automations.ts) and
 * arrives on the automation overview as a plain list of names. Everything here
 * is the matching, which is a pure function of that list plus the lens.
 */

import { DEFAULT_REPO_ID } from "./brand";

/**
 * Does this recipient name the person the lens is on? One teammate reaches us
 * as "Kent", "Kent de Bruin" and "kentdebruin" depending on whether the name
 * came from a config roster, a display name or a GitHub login, so the compare
 * is the app's usual loose one: equal, or either a prefix of the other.
 */
/**
 * What an automation the overview can't describe counts as: a house routine.
 * The runs of a deleted automation stay in the band long after the automation
 * is gone, and they belong to nobody in particular.
 */
export const HOUSE_AUTOMATION: {
	recipients: string[];
	repo?: string;
	workspaceRepo?: string;
} = { recipients: [] };

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
 * - `me` — yours, plus the ones addressed to nobody in particular. A house
 *   routine like the production sweep is everyone's, so keeping it here is
 *   what stops the default view losing most of the band the day audiences
 *   arrived. What drops out is an automation someone else's name is on.
 * - `unassigned` — only the ones nobody is named on.
 * - a person key — the ones that report to that teammate. House routines are
 *   not theirs in particular, so they stay out: you asked for one person.
 */
export function automationInPersonLens(
	automation: { recipients?: string[] },
	person: string,
	currentUser: string,
): boolean {
	const recipients = automation.recipients || [];
	if (person === "everyone") return true;
	if (recipients.length === 0) return person === "me" || person === "unassigned";
	if (person === "unassigned") return false;
	const key =
		person === "me" ? currentUser.trim().toLowerCase() : person.trim();
	// Signed out, "mine" can't be answered — show the band rather than empty it.
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
	automation: { repo?: string; workspaceRepo?: string },
	repo: string,
): boolean {
	if (repo === "all") return true;
	return (
		(automation.repo || DEFAULT_REPO_ID) === repo ||
		automation.workspaceRepo === repo
	);
}
