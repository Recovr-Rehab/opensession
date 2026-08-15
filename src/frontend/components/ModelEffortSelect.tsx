import React from "react";
import type { ModelOption, ProviderAccountOption } from "../lib/api";
import { useEngines } from "../hooks/useEngines";
import { baseModelId, engineModelId, modelEngine, type EngineId } from "../lib/model-engine";
import { Menu } from "../ui/menu";
import { cn } from "../ui/cn";
import { Tooltip } from "../ui/tooltip";
import { IconBolt, IconCheck, IconChevronRight, IconUndo } from "./icons";
import { BrandMark } from "./BrandTile";
import type { SessionUsage } from "../lib/types";
import { UsageCost, UsageDetails } from "./UsageMeter";

export const EFFORTS = [
	{ id: "none", label: "None" },
	{ id: "low", label: "Low" },
	{ id: "medium", label: "Medium" },
	{ id: "high", label: "High" },
	{ id: "xhigh", label: "Extra high" },
	{ id: "max", label: "Max" },
];

type Props = {
	models: ModelOption[];
	defaultModel: string;
	/** Current model id; "" = default. */
	model: string;
	onModelChange: (model: string) => void;
	/** Model is set elsewhere (e.g. Slack-owned sessions) — effort stays switchable. */
	modelDisabled?: boolean;
	modelTitle?: string;
	/** When effort isn't wired, the menu is just the model list. */
	effort?: string;
	onEffortChange?: (effort: string) => void;
	fastMode?: boolean;
	onFastModeChange?: (fastMode: boolean) => void;
	/**
	 * Pinnable provider accounts. The menu filters these to the active model's
	 * Claude or Codex pool; "" = auto (personal-first, pool fallback).
	 */
	accounts?: ProviderAccountOption[];
	/** Pinned account id; "" / undefined = auto. */
	accountId?: string;
	onAccountChange?: (accountId: string) => void;
	/** Conversation usage shown inside this menu; omitted in new-session pickers. */
	usage?: SessionUsage;
	showUsage?: boolean;
	disabled?: boolean;
	title?: string;
	className?: string;
	/** Fires as the menu opens/closes. The phone composer needs it: the popup
	 * takes focus (blurring the textarea), and the composer must stay expanded
	 * while open or this trigger unmounts and the menu closes with it. */
	onOpenChange?: (open: boolean) => void;
};

const PRIMARY_MODEL_IDS = [
	"claude-fable-5",
	"claude-opus-5",
	"claude-sonnet-5",
	"gpt-5.5",
] as const;
const PRIMARY_MODEL_ID_SET = new Set<string>(PRIMARY_MODEL_IDS);

/** Engine display names, keyed by ModelOption.provider — only used for the
 * legacy (no-opencode-configured) grouping fallback below. */
export const ENGINE_LABELS: Record<string, string> = {
	claude: "Claude",
	codex: "Codex",
	opencode: "OpenCode",
	pi: "Pi",
};

/** De-emphasized group name for the native Claude-SDK/Codex entries that stick
 * around as automation/fallback plumbing during the opencode migration. */
export const LEGACY_GROUP_LABEL = "Legacy (direct SDK)";

/**
 * Engine model ids are config-driven slugs shaped
 * `<engine>/<provider>/<model>` ("opencode/anthropic/claude-sonnet-5",
 * "pi/anthropic/claude-opus-5"). Split one into a grouping provider + model
 * slug so the UI never shows the raw slashed id. For opencode ids the
 * grouping provider is the upstream segment (the engine is invisible); pi ids
 * group under the ENGINE itself ("pi" → the "Pi" picker section) so they
 * never mingle with the opencode rows serving the same upstream. Null for
 * anything that isn't an engine-prefixed id.
 */
export function opencodeModelParts(
	id: string,
): { provider: string; model: string } | null {
	// The direct-SDK engines route the same entries, so they read as their
	// base id here: the upstream provider groups them, not the engine.
	const routed = modelEngine(id);
	if (routed === "claude" || routed === "codex") return opencodeModelParts(baseModelId(id));
	const engine = id.startsWith("opencode/")
		? "opencode"
		: id.startsWith("pi/")
			? "pi"
			: null;
	if (!engine) return null;
	const rest = id.slice(engine.length + 1);
	const slash = rest.indexOf("/");
	if (slash <= 0) return null;
	return {
		provider: engine === "pi" ? "pi" : rest.slice(0, slash),
		model: rest.slice(slash + 1),
	};
}

/** Engine routing (id prefixes, composition, the base id every lookup
 * resolves through) lives in lib/model-engine. Re-exported here because the
 * picker's callers have always imported it from this module. */
export { baseModelId, engineModelId, modelEngine, piModelId } from "../lib/model-engine";

/** Pure slug prettifier: "claude-sonnet-5" → "Sonnet 5", "claude-haiku-4-5" →
 * "Haiku 4.5", "gpt-5.4-mini" → "GPT-5.4 mini". Mirrors the server's
 * opencodeModelLabel (models.ts) but needs no models list, so it works in the
 * transcript weave before /api/models has loaded — and keeps friendly names
 * correct even while the server still serves pre-rename labels. */
export function friendlyModelSlug(slug: string): string {
	if (slug === "gpt-oss-120b") return "GPT OSS 120B";
	if (slug === "gemma-4-31b") return "Gemma 4 31B";
	if (slug === "zai-glm-4.7") return "Z.ai GLM 4.7";
	if (slug.startsWith("gpt-")) {
		const m = slug.slice(4).match(/^(\d+(?:[.-]\d+)*)(?:-(.+))?$/);
		if (m) return `GPT-${m[1].replace(/-/g, ".")}${m[2] ? ` ${m[2].replace(/-/g, " ")}` : ""}`;
		return `GPT-${slug.slice(4)}`;
	}
	const words: string[] = [];
	const nums: string[] = [];
	for (const part of slug.replace(/^claude-/, "").split("-")) {
		if (/^\d/.test(part)) nums.push(part);
		else if (part) words.push(part.charAt(0).toUpperCase() + part.slice(1));
	}
	return [words.join(" "), nums.join(".")].filter(Boolean).join(" ") || slug;
}

/**
 * A workspace preset's own name for an id that carries the workspace it was
 * defined in ("workspace-preset/ws-b985…/opus-fable" → "Opus 5 + Fable
 * oracle"), or null when the id isn't one.
 *
 * A session can run a preset from a DIFFERENT workspace — /model and a carried
 * default both allow it, and the runner resolves either — while the catalog is
 * always fetched for the session's own workspace. So the exact id can be
 * absent; every workspace seeds the same preset ids, so the trailing segment
 * still names it. Without a catalog at all, the slug is still a name, and the
 * storage path never is.
 */
export function workspacePresetLabel(
	id: string,
	models: ModelOption[],
): string | null {
	const slug = id.match(/^workspace-preset\/[^/]+\/(.+)$/)?.[1];
	if (!slug) return null;
	return (
		models.find((m) => m.id === id)?.label ||
		models.find(
			(m) => m.id.startsWith("workspace-preset/") && m.id.endsWith(`/${slug}`),
		)?.label ||
		friendlyModelSlug(slug)
	);
}

/** Display name without the vendor noise: "Claude Fable 5" → "Fable 5",
 * "GPT-5.5 (Codex)" → "GPT-5.5", "opencode/anthropic/claude-sonnet-5" →
 * "Sonnet 5". The engine is an implementation detail — it never shows in a
 * model's name. */
export function shortModelLabel(id: string, models: ModelOption[]): string {
	// An engine-routed id reads as its base entry ("pi/dial/opus-fable",
	// "claude/dial/opus-fable" both keep the preset's label, not a slug) —
	// the engine is routing, and it never shows in a model's name.
	const routedBase = baseModelId(id);
	if (routedBase !== id && models.some((m) => m.id === routedBase))
		return shortModelLabel(routedBase, models);
	const preset = workspacePresetLabel(baseModelId(id), models);
	if (preset) return preset;
	const oc = opencodeModelParts(id);
	if (oc) return friendlyModelSlug(oc.model);
	// Last resort is the id itself, minus its routing prefix — an id with no
	// catalog entry is still a name, and the engine is not part of it.
	const raw = models.find((m) => m.id === id)?.label || routedBase || "Default";
	return raw.replace(/^Claude\s+/i, "").replace(/\s*\(Codex\)$/i, "");
}

/** Friendly names for the upstream providers in the grouped main list. */
const PROVIDER_LABELS: Record<string, string> = {
	dial: "The Dial",
	custom: "Custom",
	orchestrator: "The Orchestrator",
	anthropic: "Anthropic",
	openai: "OpenAI",
	pi: "Pi",
	xai: "xAI",
	meta: "Meta",
	google: "Google",
	openrouter: "OpenRouter",
	groq: "Groq",
	mistral: "Mistral",
	deepseek: "DeepSeek",
	moonshotai: "Moonshot AI",
	cerebras: "Cerebras",
};

/** Section order in the grouped main list; unlisted providers follow in
 * config order. */
const PROVIDER_ORDER = ["dial", "custom", "orchestrator", "anthropic", "openai", "pi", "cerebras", "xai", "meta", "moonshotai"];

/** Preferred display order for the opencode main list (by id tail); anything
 * unlisted keeps its registry/config order after these. */
const OPENCODE_TAIL_ORDER = [
	// The Dial presets ("dial/<tier>" ids) lead the list, hardest tier first,
	// then The Orchestrator presets ("orchestrator/<name>" ids).
	"ultra",
	"high",
	"medium",
	"low",
	"fable",
	"sol",
	"claude-fable-5",
	"claude-opus-5",
	"claude-opus-4-8",
	"claude-sonnet-5",
	"claude-sonnet-4-6",
	"claude-haiku-4-5",
	"gpt-5.6-sol",
	"gpt-5.6-terra",
	"gpt-5.6-luna",
	"kimi-k3",
	"gpt-oss-120b",
	"gemma-4-31b",
	"zai-glm-4.7",
];

/** The engine providers whose entries form the first-class model list. */
const ENGINE_PROVIDERS = new Set(["opencode", "pi"]);

/**
 * Split the registry into the first-class engine entries (opencode + pi,
 * sorted for display) and the legacy native claude/codex ones. When engine
 * models are configured they ARE the model list; natives tuck under
 * LEGACY_GROUP_LABEL.
 */
export function splitModelOptions(models: ModelOption[]): {
	opencode: ModelOption[];
	legacy: ModelOption[];
} {
	const rank = (m: ModelOption) => {
		const i = OPENCODE_TAIL_ORDER.indexOf(m.id.split("/").pop() || "");
		return i === -1 ? OPENCODE_TAIL_ORDER.length : i;
	};
	const opencode = models
		.filter((m) => ENGINE_PROVIDERS.has(m.provider))
		.map((m, i) => [m, i] as const)
		.sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
		.map(([m]) => m);
	return { opencode, legacy: models.filter((m) => !ENGINE_PROVIDERS.has(m.provider)) };
}

type ModelMenuOption = {
	value: string;
	label: string;
	id: string;
	/** Engine key (ModelOption.provider) for the legacy-fallback group headers. */
	engine: string;
	/** Picker section override from the registry ("dial" = The Dial). */
	group?: string;
	/** One-line subtitle rendered under the label (dial presets). */
	description?: string;
};

/**
 * Combined model + reasoning-effort pill (Claude-app-style): one trigger on the
 * composer's right edge opening a short menu of settings rows — Model, Engine,
 * Effort, Speed, Account — each showing its current value and opening a
 * submenu, over a "Reset to default" row. The model list used to sit at the top
 * level, which made the menu as tall as the registry and buried the four
 * settings under it; a row per setting keeps the menu one screenful whatever
 * the catalog does, at the cost of one extra hop to change model.
 *
 * Unlike PaletteSelect there is no native-select phone fallback: the nested
 * submenus don't map to a <select>, and Base UI menus handle touch fine.
 */
export function ModelEffortSelect({
	models,
	defaultModel,
	model,
	onModelChange,
	modelDisabled,
	modelTitle,
	effort,
	onEffortChange,
	fastMode,
	onFastModeChange,
	accounts,
	accountId,
	onAccountChange,
	usage,
	showUsage = false,
	disabled,
	title,
	className,
	onOpenChange,
}: Props) {
	const effectiveModel = model || defaultModel;
	// Pi-routed ids resolve to their base list entry for label/effort/account
	// lookups — the engine prefix is routing, not a different model.
	const effectiveBase = baseModelId(effectiveModel);
	const modelLabel = shortModelLabel(effectiveModel, models);
	const supportedEffortIds = models.find((m) => m.id === effectiveBase)?.efforts ?? [];
	const supportedEfforts = EFFORTS.filter((e) => supportedEffortIds.includes(e.id));
	const effectiveEffort = supportedEffortIds.includes(effort ?? "")
		? effort!
		: supportedEffortIds.includes("high")
			? "high"
			: supportedEffortIds[0];
	const effortLabel = EFFORTS.find((e) => e.id === effectiveEffort)?.label;
	const hasEffort = !!onEffortChange && supportedEfforts.length > 0;
	const modelInfo = models.find((m) => m.id === effectiveBase);
	const accountProvider = modelInfo?.accountProvider;
	const providerAccounts = (accounts || []).filter((a) => a.provider === accountProvider);
	const hasAccount = !!onAccountChange && providerAccounts.length > 0;
	const currentAccount = accountId
		? providerAccounts.find((a) => a.id === accountId)
		: undefined;
	const subscriptionAccount = providerAccounts.find(
		(a) => a.kind !== "api_key" && a.usable,
	);
	const hasFastMode =
		modelInfo?.fastModeSupported === true &&
		currentAccount?.kind !== "api_key" &&
		!!(currentAccount || subscriptionAccount) &&
		!!onFastModeChange;
	const accountLabel = currentAccount ? currentAccount.name : "Auto";
	// Engine choice is the model id's routing prefix, so it needs no state of
	// its own: read it off the current id, and write it by recomposing that id.
	const engineOptions = useEngines().engines.filter((e) => e.available);
	const activeEngine = modelEngine(effectiveModel);
	const hasEngine = engineOptions.length > 1;
	const engineLabel =
		engineOptions.find((e) => e.id === activeEngine)?.label ||
		ENGINE_LABELS[activeEngine] ||
		activeEngine;
	/** Recompose the current model onto `engine`; "" keeps following the default. */
	const changeEngine = (engine: EngineId) => {
		const next = engineModelId(engine, effectiveModel);
		if (!next) return;
		onModelChange(next === defaultModel ? "" : next);
	};

	// "Reset to default" puts every row in this menu back where a fresh session
	// starts: following the default model (not pinning it), that model's own
	// default effort, fast mode off, account on auto. Effort resolves against
	// the DEFAULT model rather than the current one — reset changes both, and
	// the effort the current model happens to support may not exist there.
	const defaultEffortIds = models.find((m) => m.id === baseModelId(defaultModel))?.efforts ?? [];
	const defaultEffort = defaultEffortIds.includes("high") ? "high" : defaultEffortIds[0];
	const atDefault =
		(modelDisabled || model === "" || model === defaultModel) &&
		(!hasEffort || !defaultEffort || effectiveEffort === defaultEffort) &&
		(!hasFastMode || !fastMode) &&
		(!hasAccount || !accountId);
	const resetToDefault = () => {
		if (!modelDisabled) onModelChange("");
		if (onEffortChange && defaultEffort) onEffortChange(defaultEffort);
		if (onFastModeChange) onFastModeChange(false);
		if (onAccountChange) onAccountChange("");
	};

	const optionFor = (id: string): ModelMenuOption => {
		const info = models.find((m) => m.id === id);
		return {
			value: id === defaultModel ? "" : id,
			// Preset rows drop their "Dial · " / "Orchestrator · " prefix — they
			// render under "The Dial" / "The Orchestrator" group headers, where
			// the full label would read twice.
			label:
				info?.group === "dial" || info?.group === "orchestrator"
					? shortModelLabel(id, models).replace(/^(?:Dial|Orchestrator)\s*·\s*/, "")
					: shortModelLabel(id, models),
			id,
			engine: info?.provider || (opencodeModelParts(id) ? "opencode" : "claude"),
			group: info?.group,
			description: info?.description,
		};
	};
	// Legacy entries keep their FULL registry label ("Claude Sonnet 5",
	// "GPT-5.5 (Codex)") so they never read as duplicates of the first-class
	// short names above them.
	const legacyOptionFor = (m: ModelOption): ModelMenuOption => ({
		value: m.id === defaultModel ? "" : m.id,
		label: m.label,
		id: m.id,
		engine: m.provider,
	});
	const { opencode: opencodeModels, legacy: legacyModels } = splitModelOptions(models);
	// With opencode configured it IS the model list: its entries are the main
	// list (friendly names, no engine anywhere) and the native claude/codex
	// entries — automation/fallback plumbing during the migration — tuck under
	// a de-emphasized "Legacy (direct SDK)" submenu at the bottom.
	const opencodeFirst = opencodeModels.length > 0;
	const availableModelIds = new Set(models.map((m) => m.id));
	const primaryOptions = opencodeFirst
		? [
				...(availableModelIds.has(defaultModel) ? [] : [optionFor(defaultModel)]),
				...opencodeModels.map((m) => optionFor(m.id)),
			]
		: PRIMARY_MODEL_IDS.filter((id) => availableModelIds.has(id)).map((id) => optionFor(id));
	const otherOptions = opencodeFirst
		? legacyModels.map(legacyOptionFor)
		: [
				...(PRIMARY_MODEL_ID_SET.has(defaultModel) ? [] : [optionFor(defaultModel)]),
				...models
					.filter((m) => m.id !== defaultModel && !PRIMARY_MODEL_ID_SET.has(m.id))
					.map((m) => optionFor(m.id)),
			];
	// No-opencode fallback only: "Other models" grouped by engine. With
	// opencode present the submenu is the flat legacy list instead.
	const engineOrder = ["claude", "codex", "opencode"];
	const engines = [
		...engineOrder,
		...otherOptions.map((o) => o.engine).filter((e) => !engineOrder.includes(e)),
	];
	const otherGroups = [...new Set(engines)]
		.map((engine) => ({
			engine,
			label: ENGINE_LABELS[engine] || engine,
			options: otherOptions.filter((o) => o.engine === engine),
		}))
		.filter((g) => g.options.length > 0);
	// Main-list sections by upstream provider (Anthropic / OpenAI / xAI / …) —
	// a flat list stops scanning well once third-party providers join the
	// picker. Falls back to flat when everything is one provider.
	const providerOf = (id: string) => opencodeModelParts(id)?.provider || "other";
	const providerGroups: Array<{ provider: string; label: string; options: ModelMenuOption[] }> = [];
	for (const option of primaryOptions) {
		// A registry group ("dial") overrides provider-segment grouping.
		const provider = option.group || providerOf(option.id);
		let group = providerGroups.find((g) => g.provider === provider);
		if (!group) {
			group = {
				provider,
				label:
					PROVIDER_LABELS[provider] ||
					provider.charAt(0).toUpperCase() + provider.slice(1),
				options: [],
			};
			providerGroups.push(group);
		}
		group.options.push(option);
	}
	providerGroups.sort((a, b) => {
		const ai = PROVIDER_ORDER.indexOf(a.provider);
		const bi = PROVIDER_ORDER.indexOf(b.provider);
		return (ai === -1 ? PROVIDER_ORDER.length : ai) - (bi === -1 ? PROVIDER_ORDER.length : bi);
	});
	const groupedPrimary = opencodeFirst && providerGroups.length > 1;

	const isSelected = (option: ModelMenuOption) =>
		option.value === model ||
		option.id === effectiveBase ||
		(option.value === "" && (model === "" || model === defaultModel));
	// Dim hint on the legacy submenu trigger when the CURRENT model lives in
	// there — otherwise the open menu would show no checked row at all.
	const selectedLegacyLabel =
		opencodeFirst && !primaryOptions.some(isSelected)
			? otherOptions.find(isSelected)?.label
			: undefined;

	const renderModelOption = (option: ModelMenuOption) => {
		const selected = isSelected(option);
		const nextEfforts = models.find((m) => m.id === option.id)?.efforts ?? [];
		// Engine stays sticky across model changes: the new id is recomposed onto
		// the engine the session is already on. An entry that can't route there
		// (wrong vendor for a direct-SDK engine, a legacy native id) is offered
		// disabled rather than silently dropped back to opencode.
		const routed =
			activeEngine === "opencode" ? option.value : engineModelId(activeEngine, option.id);
		const offEngine = routed === null;
		const disabled = modelDisabled || offEngine;
		const item = (
			<Menu.Item
				onClick={() => {
					onModelChange(routed ?? option.value);
					if (onEffortChange && !nextEfforts.includes(effort ?? "")) {
						const nextEffort = nextEfforts.includes("high") ? "high" : nextEfforts[0];
						if (nextEffort) onEffortChange(nextEffort);
					}
				}}
				disabled={disabled}
				title={
					modelDisabled
						? modelTitle
						: offEngine
							? `Not available on the ${engineLabel} engine`
							: undefined
				}
				className={cn("justify-between gap-3", selected && "bg-hover", disabled && "opacity-55")}
			>
				{option.description ? (
					<span className="flex min-w-0 flex-1 flex-col">
						<span className="truncate">{option.label}</span>
						<span className="truncate text-xs text-faint">{option.description}</span>
					</span>
				) : (
					<span className="min-w-0 truncate">{option.label}</span>
				)}
				{selected && <IconCheck className="shrink-0 text-dim" size={17} />}
			</Menu.Item>
		);
		return option.description ? (
			<Tooltip key={option.value || option.id} label={option.description} side="right" multiline>
				{item}
			</Tooltip>
		) : (
			React.cloneElement(item, { key: option.value || option.id })
		);
	};

	return (
		<Menu.Root onOpenChange={onOpenChange}>
			<Menu.Trigger
				type="button"
				// Quiet pill: no outline at rest, hover state only, no chevron.
				className={cn(
					"border-transparent hover:border-transparent hover:bg-hover",
					className,
				)}
				title={title}
				disabled={disabled || (!hasEffort && !hasFastMode && !hasEngine && modelDisabled)}
				aria-label={
					hasAccount
						? "Model, reasoning effort, and provider account"
						: hasEffort
							? "Model and reasoning effort"
							: "Model"
				}
			>
				{/* `data-effort` is a styling hook for the caller, not state: the
				    new-session footer hides the suffix on ultra-narrow screens so the
				    model name keeps the room, and the composer toolbar does not. */}
				{hasFastMode && fastMode && (
					<>
						<IconBolt className="flex-none text-faint" size={20} />
						<span className="sr-only">Fast mode</span>
					</>
				)}
				<span className="truncate">{modelLabel}</span>
				{hasEffort && (
					<span data-effort className="flex-none text-faint">
						{effortLabel}
					</span>
				)}
			</Menu.Trigger>
			<Menu.Popup align="end" sideOffset={6} className="max-w-[min(360px,calc(100vw-1rem))]">
				{showUsage && (
					<>
						<Menu.SubmenuRoot>
							<Menu.SubmenuTrigger className="justify-between gap-3">
								<span className="min-w-0 truncate">Conversation usage</span>
								<span className="flex flex-none items-center gap-1 text-dim">
									<UsageCost usage={usage} />
									<IconChevronRight className="shrink-0" size={17} />
								</span>
							</Menu.SubmenuTrigger>
							<Menu.Popup className="w-64 max-w-[min(360px,calc(100vw-1rem))]">
								<UsageDetails usage={usage} className="p-1.5" />
							</Menu.Popup>
						</Menu.SubmenuRoot>
						<Menu.Separator className="my-1" />
					</>
				)}
				<Menu.SubmenuRoot>
					<Menu.SubmenuTrigger className="justify-between gap-3">
						<span className="min-w-0 truncate">Model</span>
						<span className="flex min-w-0 flex-none items-center gap-1 text-dim">
							<span className="truncate">{modelLabel}</span>
							<IconChevronRight className="shrink-0" size={17} />
						</span>
					</Menu.SubmenuTrigger>
					<Menu.Popup className="max-w-[min(360px,calc(100vw-1rem))]">
						{groupedPrimary
							? providerGroups.map((g, i) => (
									<React.Fragment key={g.provider}>
										{i > 0 && <Menu.Separator className="my-1" />}
										<Menu.Group>
											<Menu.GroupLabel>{g.label}</Menu.GroupLabel>
											{g.options.map(renderModelOption)}
										</Menu.Group>
									</React.Fragment>
								))
							: primaryOptions.map(renderModelOption)}
						{otherOptions.length > 0 && (
							<Menu.SubmenuRoot>
								<Menu.SubmenuTrigger
									className={cn("justify-between gap-3", opencodeFirst && "text-dim")}
								>
									<span className="min-w-0 truncate">
										{opencodeFirst ? LEGACY_GROUP_LABEL : "Other models"}
									</span>
									<span className="flex flex-none items-center gap-1 text-dim">
										{selectedLegacyLabel && (
											<span className="text-faint">{selectedLegacyLabel}</span>
										)}
										<IconChevronRight className="shrink-0" size={17} />
									</span>
								</Menu.SubmenuTrigger>
								<Menu.Popup className="max-w-[min(360px,calc(100vw-1rem))]">
									{!opencodeFirst && otherGroups.length > 1
										? otherGroups.map((g, i) => (
												<React.Fragment key={g.engine}>
													{i > 0 && <Menu.Separator className="my-1" />}
													<Menu.Group>
														<Menu.GroupLabel>{g.label}</Menu.GroupLabel>
														{g.options.map(renderModelOption)}
													</Menu.Group>
												</React.Fragment>
											))
										: otherOptions.map(renderModelOption)}
								</Menu.Popup>
							</Menu.SubmenuRoot>
						)}
					</Menu.Popup>
				</Menu.SubmenuRoot>
				{hasEngine && (
					<Menu.SubmenuRoot>
						<Menu.SubmenuTrigger className="justify-between gap-3">
							<span className="min-w-0 truncate">Engine</span>
							<span className="flex flex-none items-center gap-1 text-dim">
								{engineLabel}
								<IconChevronRight className="shrink-0 text-dim" size={17} />
							</span>
						</Menu.SubmenuTrigger>
						<Menu.Popup className="max-w-[min(360px,calc(100vw-1rem))]">
							{engineOptions.map((e) => {
								const selected = e.id === activeEngine;
								// An engine that can't run the current model stays visible
								// but unpickable — hiding it would read as "not configured".
								const unavailable = !engineModelId(e.id, effectiveModel);
								return (
									<Menu.Item
										key={e.id}
										onClick={() => changeEngine(e.id)}
										disabled={unavailable}
										title={
											unavailable
												? `${modelLabel} isn't available on the ${e.label} engine`
												: undefined
										}
										className={cn(
											"justify-between gap-3",
											selected && "bg-hover",
											unavailable && "opacity-55",
										)}
									>
	<span className="flex min-w-0 items-center gap-2">
											<span className="flex size-4 shrink-0 items-center justify-center text-dim">
												<BrandMark name={e.id} />
											</span>
											<span className="min-w-0 truncate">{e.label}</span>
										</span>
										{selected && <IconCheck className="shrink-0 text-dim" size={17} />}
									</Menu.Item>
								);
							})}
						</Menu.Popup>
					</Menu.SubmenuRoot>
				)}
				{hasEffort && (
					<Menu.SubmenuRoot>
						<Menu.SubmenuTrigger className="justify-between gap-3">
							<span className="min-w-0 truncate">Effort</span>
							<span className="flex flex-none items-center gap-1 text-dim">
								{effortLabel}
								<IconChevronRight className="shrink-0 text-dim" size={17} />
							</span>
						</Menu.SubmenuTrigger>
						<Menu.Popup className="max-w-[min(360px,calc(100vw-1rem))]">
							{supportedEfforts.map((e) => {
								const selected = effectiveEffort === e.id;
								return (
									<Menu.Item
										key={e.id}
										onClick={() => onEffortChange!(e.id)}
										className={cn("justify-between gap-3", selected && "bg-hover")}
									>
										<span className="min-w-0 truncate">{e.label}</span>
										{selected && (
											<IconCheck className="shrink-0 text-dim" size={17} />
										)}
									</Menu.Item>
								);
							})}
						</Menu.Popup>
					</Menu.SubmenuRoot>
				)}
				{hasFastMode && (
					<Menu.SubmenuRoot>
						<Menu.SubmenuTrigger className="justify-between gap-3">
							<span className="min-w-0 truncate">Speed</span>
							<span className="flex flex-none items-center gap-1 text-dim">
								{fastMode ? "Fast" : "Standard"}
								<IconChevronRight className="shrink-0 text-dim" size={17} />
							</span>
						</Menu.SubmenuTrigger>
						<Menu.Popup className="max-w-[min(360px,calc(100vw-1rem))]">
							{[
								{ fast: false, label: "Standard" },
								{ fast: true, label: "Fast" },
							].map((o) => {
								const selected = !!fastMode === o.fast;
								return (
									<Menu.Item
										key={o.label}
										onClick={() => {
											// Fast mode runs on a subscription account, so picking it
											// while on auto pins the one it will actually use.
											if (o.fast && !currentAccount && subscriptionAccount) {
												onAccountChange?.(subscriptionAccount.id);
											}
											onFastModeChange!(o.fast);
										}}
										className={cn("justify-between gap-3", selected && "bg-hover")}
									>
										<span className="min-w-0 truncate">{o.label}</span>
										{selected && <IconCheck className="shrink-0 text-dim" size={17} />}
									</Menu.Item>
								);
							})}
						</Menu.Popup>
					</Menu.SubmenuRoot>
				)}
				{hasAccount && (
					<Menu.SubmenuRoot>
						<Menu.SubmenuTrigger className="justify-between gap-3">
							<span className="min-w-0 truncate">Account</span>
							<span className="flex flex-none items-center gap-1 text-dim">
								{accountLabel}
								<IconChevronRight className="shrink-0 text-dim" size={17} />
							</span>
						</Menu.SubmenuTrigger>
						<Menu.Popup className="max-w-[min(360px,calc(100vw-1rem))]">
							<Menu.Item
								onClick={() => onAccountChange!("")}
								className={cn("justify-between gap-3", !accountId && "bg-hover")}
							>
								<span className="min-w-0 truncate">Auto</span>
								{!accountId && (
									<IconCheck className="shrink-0 text-dim" size={17} />
								)}
							</Menu.Item>
							{providerAccounts.map((a) => {
								const selected = a.id === accountId;
								return (
									<Menu.Item
										key={a.id}
										onClick={() => onAccountChange!(a.id)}
										className={cn("justify-between gap-3", selected && "bg-hover")}
									>
										<span className="min-w-0 truncate">
											{a.name}
											{a.owner ? ` · ${a.owner}` : ""}
											{a.usable ? "" : " · exhausted"}
										</span>
										{selected && (
											<IconCheck className="shrink-0 text-dim" size={17} />
										)}
									</Menu.Item>
								);
							})}
						</Menu.Popup>
					</Menu.SubmenuRoot>
				)}
				<Menu.Separator className="my-1" />
				<Menu.Item
					onClick={resetToDefault}
					disabled={atDefault}
					className={cn("justify-between gap-3", atDefault && "opacity-55")}
				>
					<span className="min-w-0 truncate">Reset to default</span>
					<IconUndo className="shrink-0 text-dim" size={17} />
				</Menu.Item>
			</Menu.Popup>
		</Menu.Root>
	);
}
