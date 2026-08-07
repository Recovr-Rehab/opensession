import { useCallback, useEffect, useRef, useState } from "react";
import {
	fetchModels,
	fetchPersonalPrompt,
	savePersonalPrompt,
	type ModelOption,
} from "../../lib/api";
import { BASE_PATH } from "../../lib/base";
import {
	getBusySendPrefs,
	onBusySendChanged,
	setBusySendPref,
	type BusySendPrefs,
} from "../../lib/busy-send-pref";
import {
	getDefaultModelPref,
	onDefaultModelPrefChanged,
	setDefaultModelPref,
} from "../../lib/default-model-pref";
import {
	getDeskVoicePref,
	onDeskVoiceChanged,
	setDeskVoicePref,
} from "../../lib/desk-voice-pref";
import {
	getPinNewSessions,
	getPinNewWorkspaces,
	onPinNewSessionsChanged,
	onPinNewWorkspacesChanged,
	setPinNewSessions,
	setPinNewWorkspaces,
} from "../../lib/pins";
import {
	MOD_ENTER_GLYPH,
	MOD_ENTER_LABEL,
	type SendKeyPref,
} from "../../lib/send-key";
import {
	getSendKeyPref,
	onSendKeyChanged,
	setSendKeyPref,
} from "../../lib/send-key-pref";
import {
	getTurnActivityPref,
	onTurnActivityChanged,
	setTurnActivityPref,
	type TurnActivityPref,
} from "../../lib/turn-activity";
import {
	getVimModePref,
	onVimModeChanged,
	setVimModePref,
} from "../../lib/vim-pref";
import { Button } from "../../ui/button";
import {
	SettingCard,
	SettingsGroupLabel,
	SettingsHeader,
	SettingsHint,
	SettingsPanel,
	SettingsSection,
	settingsInputClass,
	settingsTextareaClass,
} from "../../ui/settings";
import { InlineAlert, LoadingState } from "../../ui/state";
import { Switch } from "../../ui/switch";
import { toast } from "../../ui/toast";
import { getCurrentUser } from "../UserPicker";
import { Select, SettingRow } from "./shared";

// ── Desk voice ─────────────────────────────────────────────────────────────

interface DeskVoiceStatus {
	configured: boolean;
	keyMasked?: string;
}

function DeskVoiceApiKeyRow() {
	const [status, setStatus] = useState<DeskVoiceStatus | null>(null);
	const [apiKey, setApiKey] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const load = useCallback(() => {
		fetch(`${BASE_PATH}/api/desk/voice/status`)
			.then((r) => r.json())
			.then(setStatus)
			.catch((e) => setError(e.message));
	}, []);
	useEffect(load, [load]);

	async function put(value: string) {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch(`${BASE_PATH}/api/desk/voice/key`, {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ apiKey: value }),
			});
			const body = await res.json();
			if (!res.ok) throw new Error(body.error || `Failed: ${res.status}`);
			setStatus(body);
			setApiKey("");
		} catch (e: any) {
			setError(e.message || "Failed to save the API key");
		} finally {
			setBusy(false);
		}
	}

	return (
		<>
			{status?.configured && (
				<SettingRow
					title="OpenAI API key"
					desc={status.keyMasked}
					control={
						<Button size="sm" disabled={busy} onClick={() => put("")}>
							Remove
						</Button>
					}
				/>
			)}
			<SettingRow
				title={status?.configured ? "Replace key" : "OpenAI API key"}
				desc={
					error || (
						<>
							Stored on the server, used only for Desk voice calls. Any
							signed-in user can start voice calls once set.
						</>
					)
				}
				control={
					<div className="flex items-center gap-2">
						<input
							className={settingsInputClass}
							type="password"
							value={apiKey}
							onChange={(e) => setApiKey(e.target.value)}
							placeholder="sk-…"
						/>
						<Button
							size="sm"
							variant="primary"
							disabled={busy || !apiKey.trim()}
							onClick={() => put(apiKey.trim())}
						>
							{busy ? "Saving…" : "Save"}
						</Button>
					</div>
				}
			/>
		</>
	);
}

function DeskVoicePanel() {
	const [on, setOn] = useState(getDeskVoicePref);
	useEffect(() => onDeskVoiceChanged(() => setOn(getDeskVoicePref())), []);

	return (
		<>
			<SettingsGroupLabel>Desk voice</SettingsGroupLabel>
			<SettingCard>
				<SettingRow
					title="Voice mode"
					desc="Show the voice toggle in your Desk. Off hides it for you only."
					control={
						<Switch aria-label="Voice mode" checked={on} onCheckedChange={setDeskVoicePref} />
					}
				/>
				<DeskVoiceApiKeyRow />
			</SettingCard>
			<SettingsHint>
				Talk to your Desk — the standing session you summon with ⌘J — out loud
				instead of typing. Voice mode uses OpenAI Realtime and adds a
				microphone button to the Desk overlay; the API key is shared by
				everyone on this instance.
			</SettingsHint>
		</>
	);
}

/** Settings → Personal prompt: a per-user standing-instructions block injected
 * into the system note of every interactive run the user starts (server-side:
 * personal-prompts.ts via memoryNoteFor). Automations never receive it. */
function PersonalPromptPanel() {
	const user = getCurrentUser();
	const [prompt, setPrompt] = useState<string | null>(null);
	const [savedPrompt, setSavedPrompt] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");

	useEffect(() => {
		let alive = true;
		fetchPersonalPrompt(user)
			.then((r) => {
				if (!alive) return;
				setPrompt(r.prompt);
				setSavedPrompt(r.prompt);
			})
			.catch((e) => alive && setError(e.message));
		return () => {
			alive = false;
		};
	}, [user]);

	// There is no Save button: the prompt commits when the box loses focus and
	// again when the panel goes away, so leaving the page keeps your edit. The
	// latest values live in a ref because the unmount effect must run once (a
	// dependency on `prompt` would re-fire the cleanup on every keystroke).
	const latest = useRef({ prompt, savedPrompt, user });
	latest.current = { prompt, savedPrompt, user };

	const commit = useCallback(async () => {
		const { prompt: draft, savedPrompt: saved, user: who } = latest.current;
		if (draft === null || draft === saved) return;
		setStatus("saving");
		try {
			const r = await savePersonalPrompt(who, draft);
			setSavedPrompt(r.prompt);
			setStatus("saved");
		} catch (e: any) {
			setStatus("idle");
			toast(e?.message || "Failed to save personal prompt", {
				variant: "error",
			});
		}
	}, []);

	useEffect(() => {
		// Fire-and-forget on the way out — nothing is left to render a result to.
		return () => void commit();
	}, [commit]);

	const label = (
		<SettingsGroupLabel>Personal prompt</SettingsGroupLabel>
	);

	if (prompt === null)
		return (
			<>
				{label}
				{error ? (
					<InlineAlert>{error}</InlineAlert>
				) : (
					<LoadingState>Loading your prompt…</LoadingState>
				)}
			</>
		);

	const dirty = prompt !== savedPrompt;
	return (
		<>
			{label}
			<SettingsSection>
				<textarea
					className={settingsTextareaClass}
					rows={10}
					placeholder='e.g. "Keep answers short. Prefer tables for comparisons. Always mention which files you touched."'
					value={prompt}
					onChange={(e) => {
						setPrompt(e.target.value);
						setStatus("idle");
					}}
					onBlur={() => void commit()}
				/>
				<div className="mt-2 h-4 text-label font-medium text-faint">
					{status === "saving"
						? "Saving…"
						: dirty
							? "Saves when you click away"
							: status === "saved"
								? "Saved"
								: ""}
				</div>
			</SettingsSection>
			<SettingsHint>
				Added to the system prompt of every session you ({user}) start, on top
				of the built-in ones — tone, preferences, how you like work reported.
				It follows you across devices and surfaces (same identity as your
				memory store), and is never given to automations. Leave it empty to
				turn it off.
			</SettingsHint>
		</>
	);
}

/**
 * How working with a session behaves for you: the composer keys, what a
 * follow-up does mid-run, and how much of a turn's work the transcript shows.
 * Everything here is per user (ui-prefs), so it follows you across devices —
 * purely visual choices (theme, sidebar) live in Appearance instead.
 */
export function PreferencesPanel() {
	const [sendKey, setSendKey] = useState<SendKeyPref>(getSendKeyPref);
	const [busySend, setBusySend] = useState<BusySendPrefs>(getBusySendPrefs);
	const [vimMode, setVimMode] = useState<boolean>(getVimModePref);
	const [pinNew, setPinNew] = useState<boolean>(getPinNewSessions);
	const [pinNewWs, setPinNewWs] = useState<boolean>(getPinNewWorkspaces);
	useEffect(() => onSendKeyChanged(() => setSendKey(getSendKeyPref())), []);
	useEffect(() => onBusySendChanged(() => setBusySend(getBusySendPrefs())), []);
	useEffect(() => onVimModeChanged(() => setVimMode(getVimModePref())), []);
	useEffect(
		() => onPinNewSessionsChanged(() => setPinNew(getPinNewSessions())),
		[],
	);
	useEffect(
		() => onPinNewWorkspacesChanged(() => setPinNewWs(getPinNewWorkspaces())),
		[],
	);
	// Per-user default model for NEW sessions ("" = no preference — the
	// workspace default from GET /api/models applies).
	const [modelPref, setModelPref] = useState<string>(getDefaultModelPref);
	const [modelOptions, setModelOptions] = useState<ModelOption[]>([]);
	useEffect(
		() => onDefaultModelPrefChanged(() => setModelPref(getDefaultModelPref())),
		[],
	);
	const [turnActivity, setTurnActivity] =
		useState<TurnActivityPref>(getTurnActivityPref);
	useEffect(
		() => onTurnActivityChanged(() => setTurnActivity(getTurnActivityPref())),
		[],
	);
	useEffect(() => {
		fetchModels()
			.then((m) => setModelOptions(m.models))
			.catch(() => {});
	}, []);

	return (
		<SettingsPanel>
			<SettingsHeader
				title="Preferences"
				description="How you work with a session — how the message box behaves, how much of a turn's work the transcript shows, voice, and the standing instructions every session you start begins with. All of it follows your account, so it's the same on every device you sign in from."
			/>
			<SettingsGroupLabel className="mt-0">Messages</SettingsGroupLabel>
			<SettingCard>
				<SettingRow
					title="Default model"
					desc="What new sessions you start are preselected to run on. No preference keeps the workspace default. Stored per user, follows you across devices."
					control={
						<Select
							label="Default model"
							value={
								modelPref &&
								modelOptions.some((m) => m.id === modelPref)
									? modelPref
									: ""
							}
							options={[
								{ value: "", label: "No preference" },
								...modelOptions.map((m) => ({
									value: m.id,
									label: m.label,
								})),
							]}
							onChange={setDefaultModelPref}
						/>
					}
				/>
				<SettingRow
					title="Send messages with"
					desc={`Choose which key combination sends messages. Use ${
						sendKey === "mod-enter" ? "↵" : "⇧↵"
					} for new lines.`}
					control={
						<Select
							label="Send messages with"
							value={sendKey}
							options={[
								{ value: "enter", label: "Enter" },
								{ value: "mod-enter", label: MOD_ENTER_LABEL },
							]}
							onChange={setSendKeyPref}
						/>
					}
				/>
				<SettingRow
					title="Follow-up behavior"
					desc={
						<>
							What {sendKey === "enter" ? "Enter" : "sending"} does while the
							agent is busy. Queue waits until the run fully finishes
							(including running worker sessions); Steer folds your message
							into the running turn at its next step, without stopping the
							work. Stored per user, follows you across devices.
						</>
					}
					control={
						<Select
							label="Follow-up behavior"
							value={busySend.enter}
							options={[
								{ value: "queue", label: "Queue" },
								{ value: "steer", label: "Steer" },
							]}
							onChange={(v) => setBusySendPref("enter", v)}
						/>
					}
				/>
				{sendKey === "enter" && (
					<SettingRow
						title={`${MOD_ENTER_LABEL} while busy`}
						desc={
							<>
								What {MOD_ENTER_GLYPH} does while the agent is busy — set both
								to the same action if you never want the modifier to change
								it. Also applies when ⌘/Ctrl-clicking the send button.
							</>
						}
						control={
							<Select
								label={`${MOD_ENTER_LABEL} while busy`}
								value={busySend.mod}
								options={[
									{ value: "queue", label: "Queue" },
									{ value: "steer", label: "Steer" },
								]}
								onChange={(v) => setBusySendPref("mod", v)}
							/>
						}
					/>
				)}
				<SettingRow
					title="Vim mode"
					desc="Modal editing in the message composer: Esc for normal mode, the usual motions and operators, i to type. Enter still sends."
					control={
						<Switch aria-label="Vim mode" checked={vimMode} onCheckedChange={setVimModePref} />
					}
				/>
				<SettingRow
					title="Pin new sessions"
					desc="Automatically pin a session to your tab strip when you start it."
					control={
						<Switch
							aria-label="Pin new sessions"
							checked={pinNew}
							onCheckedChange={setPinNewSessions}
						/>
					}
				/>
				<SettingRow
					title="Pin new workspaces"
					desc="Also pin a workspace to your tab strip when you create one."
					control={
						<Switch
							aria-label="Pin new workspaces"
							checked={pinNewWs}
							onCheckedChange={setPinNewWorkspaces}
						/>
					}
				/>
			</SettingCard>

			<SettingsGroupLabel>Transcript</SettingsGroupLabel>
			<SettingCard>
				<SettingRow
					title="Tool calls & messages"
					desc="How each turn's working folds in the session. By default the turn's in-between messages read as normal transcript and only its tool calls fold away. Expanding a turn does not open its individual tool inputs."
					control={
						<Select
							label="Tool calls & messages"
							value={turnActivity}
							options={[
								{ value: "messages", label: "Fold tool calls" },
								{ value: "collapsed", label: "Fold everything" },
								{ value: "auto", label: "Expand while running" },
								{ value: "expanded", label: "Always expanded" },
							]}
							onChange={setTurnActivityPref}
						/>
					}
				/>
			</SettingCard>

			<DeskVoicePanel />
			<PersonalPromptPanel />
		</SettingsPanel>
	);
}
