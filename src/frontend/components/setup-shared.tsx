import { BASE_PATH } from "../lib/base";
import React from "react";
import { cn } from "../ui/cn";
import { CopyCheck, useCopy } from "../ui/copy";
import { IconCopy } from "./icons";

// Shared vocabulary for the Settings → Setup page (Setup.tsx) and its section
// siblings (SetupTeam.tsx, SetupRepos.tsx): the /api/setup/* response shapes,
// the state chip, the inline mono tokens, and one fetch helper that unwraps
// the backend's `{error}` bodies.

export interface SetupEnvVar {
	name: string;
	required: boolean;
	description: string;
	present: boolean;
}

export interface SetupIntegration {
	id: string;
	label: string;
	doc: string;
	enabled: boolean;
	env: SetupEnvVar[];
	missingRequired: string[];
}

export interface SetupGithub {
	userPrAuth: boolean;
	clientIdConfigured: boolean;
	clientSecretConfigured: boolean;
	redirectFlowAvailable: boolean;
	callbackUrl: string;
	botTokenPresent: boolean;
}

export interface SetupStatus {
	publicBaseUrl: string;
	repos: { id: string; label: string; path: string }[];
	team: { count: number; names: string[] };
	github: SetupGithub;
	integrations: SetupIntegration[];
}

export interface TeamMember {
	name: string;
	email?: string;
	github?: string;
	slackId?: string;
	aliases?: string[];
}

export interface BrowseRepo {
	fullName: string;
	private: boolean;
	description?: string | null;
	defaultBranch?: string;
	registered: boolean;
}

/** Same-origin JSON fetch against the setup API: prefixes BASE_PATH, encodes
 * an optional `json` body, and surfaces the backend's `{error}` message (or a
 * plain status line) as a thrown Error. */
export async function setupRequest<T = unknown>(
	path: string,
	init?: RequestInit & { json?: unknown },
): Promise<T> {
	const { json, ...rest } = init ?? {};
	const res = await fetch(`${BASE_PATH}${path}`, {
		...rest,
		...(json !== undefined
			? {
					headers: {
						"Content-Type": "application/json",
						...(rest.headers as Record<string, string> | undefined),
					},
					body: JSON.stringify(json),
				}
			: {}),
	});
	let body: any = null;
	try {
		body = await res.json();
	} catch {}
	if (!res.ok) throw new Error(body?.error || `Request failed (${res.status})`);
	return body as T;
}

export type ChipTone = "on" | "warn" | "off";

const CHIP_DOTS: Record<ChipTone, string> = {
	on: "var(--green)",
	warn: "var(--yellow)",
	off: "var(--text-faint)",
};

export function StateChip({ tone, label }: { tone: ChipTone; label: string }) {
	return (
		<span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-label text-dim">
			<span
				className="h-1.5 w-1.5 rounded-full"
				style={{ background: CHIP_DOTS[tone] }}
			/>
			{label}
		</span>
	);
}

/** Inline monospace token — env var names, CLI commands, paths. Sits as a
 * well on the raised card surface so it reads as literal text to type. */
export function Code({
	className,
	children,
}: {
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<code
			className={cn(
				"whitespace-nowrap rounded-sm bg-surface px-1.5 py-0.5 font-mono text-[0.92em] text-fg",
				className,
			)}
		>
			{children}
		</code>
	);
}

/** The callback URL and similar values you paste elsewhere: mono well + the
 * house copy affordance (inline check swap + toast). */
export function CopyableCode({ value }: { value: string }) {
	const { copied, copy } = useCopy();
	return (
		<button
			type="button"
			className="inline-flex max-w-full items-center gap-1.5 rounded-sm bg-surface py-0.5 pl-1.5 pr-1 text-left font-mono text-[0.92em] text-fg transition-colors hover:bg-active"
			onClick={() => copy(value, { toast: "Copied" })}
			title="Copy"
		>
			<span className="min-w-0 break-all [overflow-wrap:anywhere] whitespace-normal">
				{value}
			</span>
			<CopyCheck
				copied={copied}
				size={14}
				className="shrink-0 text-faint"
				idle={<IconCopy size={14} />}
			/>
		</button>
	);
}
