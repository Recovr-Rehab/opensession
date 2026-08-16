// Whether your runs type their reply out as the model writes it, instead of
// posting the finished message in one go. A makeUserPref instance — see
// lib/user-pref for the server-side ui-prefs hydrate pattern.
//
// Unlike the other prefs here, this one is READ BY THE SERVER: the opencode
// runner looks up the run owner's value (src/server/stream-text.ts) and either
// forwards each growing text part as a delta or keeps mirroring whole parts.
// The local cache exists only to render this toggle, so `prefKey` has to stay
// in step with STREAM_TEXT_PREF_KEY on the server.

import { makeUserPref } from "./user-pref";

const pref = makeUserPref<boolean>({
	localKey: "opensession-stream-text",
	prefKey: "stream-text",
	changeEvent: "opensession-stream-text-changed",
	defaultValue: false,
	decode: (v) => (v === "on" ? true : v === "off" ? false : null),
	encode: (v) => (v ? "on" : "off"),
});

export const getStreamTextPref = pref.get;
export const setStreamTextPref = pref.set;
export const onStreamTextChanged = pref.onChanged;
