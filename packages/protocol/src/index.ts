/**
 * Open Session protocol — the contracts a cloud agent session is made of:
 *
 * - `./events`  — engine-neutral run event stream (`StreamEvent`, `TurnUsage`)
 * - `./runner`  — the run-host wire contract (`RunHostSpec`, host/client
 *                 messages, NDJSON framing): what "bring your own runner" means
 * - `./session` — the client↔server session contract (`TranscriptEntry`,
 *                 asks, usage, core WebSocket frames): "bring your own UI"
 * - `./identity` — cross-cutting identity records (`GitIdentity`)
 *
 * The Open Session server, web UI, and native clients are the reference
 * implementations; anything speaking these types can run or watch a session.
 */
export * from "./events";
export * from "./runner";
export * from "./session";
export * from "./identity";
