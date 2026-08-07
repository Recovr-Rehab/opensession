// Per-user default model for NEW sessions (Settings → Preferences): what the
// New-session palette (and the workspace/support first-session composers)
// preselect for this user. "" = no preference — fall back to the workspace's
// interactive default from GET /api/models. A makeUserPref instance — see
// lib/user-pref for the server-side ui-prefs hydrate pattern. Any string the
// server sends (including "" for an explicit reset) is applied as-is.

import { makeUserPref } from "./user-pref";

const pref = makeUserPref<string>({
	localKey: "opensession-default-model-pref",
	prefKey: "default-model",
	changeEvent: "opensession-default-model-pref-changed",
	defaultValue: "",
	decode: (v) => (typeof v === "string" ? v : null),
	encode: (v) => v,
});

/** The user's preferred new-session model id, or "" for no preference. */
export const getDefaultModelPref = pref.get;
export const setDefaultModelPref = pref.set;
export const onDefaultModelPrefChanged = pref.onChanged;
