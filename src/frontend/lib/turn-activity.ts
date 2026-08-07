// How a turn's folded work (tool calls + intermediate assistant messages)
// displays in the session. "messages" is the default: the turn's in-between
// notes read as normal transcript and only the tool calls fold away, because
// the narration is the part worth reading and a Bash invocation almost never
// is. "collapsed" folds both; "auto" opens the whole fold while it is running
// and "expanded" keeps it open. Individual tool rows are separate disclosures
// and remain closed either way.
// A makeUserPref instance — see lib/user-pref for the server-side ui-prefs
// hydrate pattern (MacBook, iPhone Safari and the installed PWA all have
// separate localStorage, which is why "I set it but it's still collapsed
// sometimes" happened before the server-side store).

import { makeUserPref } from "./user-pref";

export type TurnActivityPref = "messages" | "auto" | "expanded" | "collapsed";

const pref = makeUserPref<TurnActivityPref>({
	localKey: "opensession-turn-activity",
	prefKey: "turn-activity",
	changeEvent: "opensession-turn-activity-changed",
	defaultValue: "messages",
	decode: (v) =>
		v === "messages" || v === "auto" || v === "expanded" || v === "collapsed"
			? v
			: null,
	encode: (v) => v,
});

export const getTurnActivityPref = pref.get;
export const setTurnActivityPref = pref.set;
export const onTurnActivityChanged = pref.onChanged;
