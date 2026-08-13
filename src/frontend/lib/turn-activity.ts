// How a turn's folded work (tool calls + intermediate assistant messages)
// displays in the session. "auto" is the default: the fold opens while the
// turn runs, so the work is visible as it happens, and closes the moment the
// turn settles. Closing it takes the notes with it, which is the part
// "messages" cannot do — there the in-between notes always read as normal
// transcript and only the tool calls fold away, so the header has nothing to
// close. "collapsed" folds everything, live included; "expanded" keeps every
// fold open. Individual tool details remain closed either way; compact tool
// runs follow "expanded" so that preference still means the full timeline.
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
	defaultValue: "auto",
	decode: (v) =>
		v === "messages" || v === "auto" || v === "expanded" || v === "collapsed"
			? v
			: null,
	encode: (v) => v,
});

export const getTurnActivityPref = pref.get;
export const setTurnActivityPref = pref.set;
export const onTurnActivityChanged = pref.onChanged;
