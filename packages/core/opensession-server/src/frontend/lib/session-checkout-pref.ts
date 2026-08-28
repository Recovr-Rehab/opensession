// Where this person starts NEW code sessions on this machine. "default" keeps
// the repository's workspace-wide setting; the two explicit choices override
// it for the web sessions this person creates. Existing sessions and sessions
// opened from a pull request keep their current checkout semantics.

import { makeUserPref } from "./user-pref";

export type SessionCheckoutPref = "default" | "checkout" | "worktree";

const pref = makeUserPref<SessionCheckoutPref>({
	localKey: "opensession-session-checkout",
	prefKey: "session-checkout",
	changeEvent: "opensession-session-checkout-changed",
	defaultValue: "default",
	decode: (value) =>
		value === "default" || value === "checkout" || value === "worktree"
			? value
			: null,
	encode: (value) => value,
});

export const getSessionCheckoutPref = pref.get;
export const setSessionCheckoutPref = pref.set;
export const onSessionCheckoutPrefChanged = pref.onChanged;
