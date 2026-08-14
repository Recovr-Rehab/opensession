import { useState } from "react";
import type { PreviewPortalRecipe, PreviewStatus } from "../lib/api";
import { portalTargetFor, type PortalTarget } from "../lib/portals";
import { cn } from "../ui/cn";
import { IconArrowUpRight, IconGlobe } from "./icons";

export function PortalsPanel({
	sessionId,
	status,
	activePortal,
	onOpenPortal,
	onStartPortal,
	onPortalAction,
}: {
	sessionId: string;
	status: PreviewStatus | null;
	activePortal?: PortalTarget | null;
	onOpenPortal?: (target: PortalTarget) => void;
	onStartPortal?: (recipe: PreviewPortalRecipe) => void;
	onPortalAction?: (name: string, action: "stop" | "restart") => Promise<void>;
}) {
	const [requestedSkill, setRequestedSkill] = useState<string | null>(null);
	const [working, setWorking] = useState<string | null>(null);
	if (!status) {
		return (
			<div className="flex h-full items-center justify-center px-5 text-center">
				<div className="flex max-w-60 flex-col items-center gap-2 text-supporting text-dim">
					<span className="h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-accent" />
					Discovering services…
				</div>
			</div>
		);
	}

	const services = status.services;
	const recipes = status.portalRecipes ?? [];
	const liveCount = services.filter(
		(service) => service.running && service.previewUrl,
	).length;

	return (
		<div className="space-y-4 px-3 py-3">
			<div className="space-y-1 px-1">
				<div className="flex items-center gap-2 text-label font-semibold text-fg">
					<IconGlobe size={15} className="text-dim" />
					{liveCount === 1 ? "1 live portal" : `${liveCount} live portals`}
				</div>
				<p className="text-supporting leading-relaxed text-dim">
					Services exposed by this session. Open one in the workspace browser or a
					separate window.
				</p>
			</div>

			{recipes.length ? (
				<div className="space-y-2">
					<div className="px-1 text-label font-semibold text-faint">
						Recommended
					</div>
					{recipes.map((recipe) => {
						const service = recipe.serviceKey
							? services.find((candidate) => candidate.key === recipe.serviceKey)
							: null;
						const target = service ? portalTargetFor(sessionId, service) : null;
						return (
							<div
								key={`${recipe.skill}:${recipe.serviceKey ?? recipe.name}`}
								className="rounded-xl bg-surface p-3"
							>
								<div className="text-label font-semibold text-fg">{recipe.name}</div>
								<p className="mt-0.5 text-supporting leading-relaxed text-dim">
									{recipe.description ?? `Starts with the ${recipe.skill} skill.`}
								</p>
								<button
									type="button"
									disabled={!target && !onStartPortal}
									onClick={() => {
										if (target) onOpenPortal?.(target);
										else {
											onStartPortal?.(recipe);
											setRequestedSkill(recipe.skill);
										}
									}}
									className="focus-ring mt-3 inline-flex min-h-8 items-center rounded-control border border-line-strong bg-control px-3 text-label font-semibold text-fg smooth-shadow-sm transition-[background-color,border-color,scale] hover:bg-hover active:scale-[0.96] disabled:opacity-40"
								>
									{target
										? "Open portal"
										: requestedSkill === recipe.skill
											? "Asked agent"
											: "Ask agent to start"}
								</button>
							</div>
						);
					})}
				</div>
			) : null}

			{services.length ? (
				<div className="space-y-2">
					{services.map((service) => {
						const target = portalTargetFor(sessionId, service);
						const active =
							!!target &&
							activePortal?.sessionId === sessionId &&
							activePortal.key === service.key;
						return (
							<div
								key={service.key}
								className={cn(
									"group flex min-h-14 items-center gap-2 rounded-row px-2 py-2 transition-[background-color,box-shadow]",
									active
										? "bg-hover smooth-shadow-sm"
										: "bg-surface hover:bg-hover",
								)}
							>
								<button
									type="button"
									disabled={!target}
									onClick={() => target && onOpenPortal?.(target)}
									className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-md p-1 text-left active:scale-[0.99] disabled:cursor-default"
								>
									<span
										className={cn(
											"h-2 w-2 shrink-0 rounded-full",
											service.running ? "bg-green" : "bg-line-strong",
										)}
										aria-hidden="true"
									/>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-label font-semibold text-fg">
											{service.name}
										</span>
										<span className="block truncate text-xs text-dim">
											{service.description ?? `Port ${service.port}`} ·{" "}
											{target
												? active
													? "Open"
													: "Running"
												: service.running
													? service.state === "starting"
														? "Starting"
														: service.state === "sleeping" || service.state === "waking"
															? service.state === "sleeping" ? "Sleeping" : "Waking"
														: "Unavailable"
													: service.state === "failed"
														? "Failed"
														: "Stopped"}
										</span>
									</span>
								</button>
								{target ? (
									<a
										href={target.url}
										target="_blank"
										rel="noopener"
										className="focus-ring inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-control text-dim transition-colors hover:bg-panel hover:text-fg active:scale-[0.96]"
										aria-label={`Open ${service.name} in a separate browser window`}
										title="Open in browser"
									>
										<IconArrowUpRight size={16} />
									</a>
								) : null}
								{service.managed && onPortalAction ? (
									<div className="flex shrink-0 items-center gap-1">
										<button
											type="button"
											disabled={working === service.name}
											onClick={() => { setWorking(service.name); void onPortalAction(service.name, "restart").catch(() => {}).finally(() => setWorking(null)); }}
											className="focus-ring min-h-10 rounded-control px-2 text-xs font-semibold text-dim transition-colors hover:bg-hover hover:text-fg active:scale-[0.96] disabled:opacity-45"
										>
											Restart
										</button>
										<button
											type="button"
											disabled={working === service.name || !service.running}
											onClick={() => { setWorking(service.name); void onPortalAction(service.name, "stop").catch(() => {}).finally(() => setWorking(null)); }}
											className="focus-ring min-h-10 rounded-control px-2 text-xs font-semibold text-red transition-colors hover:bg-hover active:scale-[0.96] disabled:opacity-45"
										>
											Stop
										</button>
									</div>
								) : null}
							</div>
						);
					})}
				</div>
			) : (
				<div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
					<div className="text-label font-semibold text-fg">
						{status.starting ? "Starting services…" : "No portals discovered"}
					</div>
					<p className="mt-1 text-supporting leading-relaxed text-dim">
						{status.starting
							? "They’ll appear here as soon as their ports are ready."
							: "Start Preview to expose the services declared by this repository."}
					</p>
				</div>
			)}
		</div>
	);
}
