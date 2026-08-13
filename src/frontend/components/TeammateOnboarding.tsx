import type { TeammateOnboardingStatus } from "../lib/api";
import type { NewSessionPrefill } from "../lib/new-session-link";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { cn } from "../ui/cn";
import { IconMessageQuestion, IconPencil } from "./icons";
import { RepoTile } from "./RepoTile";

export interface TeammateOnboardingModel {
	status: TeammateOnboardingStatus | null;
	error: string | null;
	connected: boolean;
	onRetry: () => void;
	onStart: (prefill: NewSessionPrefill) => void;
	onOpenSetup: () => void;
}

export function TeammateOnboarding({
	model,
	placement = "page",
}: {
	model: TeammateOnboardingModel;
	placement?: "page" | "sidebar";
}) {
	const { status, error, connected, onRetry, onStart, onOpenSetup } = model;
	const compact = placement === "sidebar";
	const taskCapability = status?.capabilities.task;
	const blockers = [
		!connected ? "Open Session is reconnecting." : null,
		taskCapability?.blocker ?? null,
	].filter((value, index, all): value is string => !!value && all.indexOf(value) === index);
	const ready = connected && taskCapability?.ready;

	return (
		<section
			aria-labelledby={`teammate-onboarding-${placement}`}
			className={cn(compact ? "mx-3 my-3" : "mx-auto mt-7 w-full max-w-[760px]")}
		>
			<div className={cn(compact ? "mb-3" : "mb-5 text-center")}>
				<h2
					id={`teammate-onboarding-${placement}`}
					className={cn(
						"m-0 font-semibold tracking-[-0.025em] text-fg text-balance",
						compact ? "text-item-title" : "text-page-title",
					)}
				>
					{error || blockers.length ? "Open Session isn't ready yet" : "Start your first session"}
				</h2>
				<p className={cn("m-0 mt-1 leading-relaxed text-dim text-pretty", compact ? "text-meta" : "text-body")}>
					{error
						? "We couldn't check this workspace."
						: blockers.length
							? "Your team needs to resolve the items below before you can start."
							: `${status?.preparedRepo?.label || "Your repository"} is ready. Choose how the agent should work.`}
				</p>
			</div>

			{status?.preparedRepo && (
				<Card className={cn("flex items-center gap-3", compact ? "mb-2.5 p-3" : "mb-3 p-4")}>
					<RepoTile name={status.preparedRepo.id} size={compact ? 24 : 28} />
					<div className="min-w-0 flex-1">
						<div className="truncate text-item-title font-semibold text-fg">{status.preparedRepo.label}</div>
						<div className="text-meta text-dim">Prepared repository · {status.preparedRepo.defaultBranch}</div>
					</div>
					<span className={cn("flex items-center gap-1.5 text-label font-medium", ready ? "text-green" : "text-dim")}>
						<span className={cn("size-1.5 rounded-full", ready ? "bg-green" : "bg-faint")} /> {ready ? "Ready" : "Waiting"}
					</span>
				</Card>
			)}

			{ready && status?.preparedRepo ? (
				<div className={cn("grid gap-3", compact ? "grid-cols-1" : "grid-cols-2")}>
					<ModeCard
						compact={compact}
						icon={<IconMessageQuestion size={22} />}
						title="Ask only"
						description="Read and investigate the repository. Files stay unchanged."
						qualifier="Read-only"
						action="Ask"
						onClick={() => onStart({ mode: "ask", repo: status.preparedRepo!.id })}
					/>
					<ModeCard
						compact={compact}
						icon={<IconPencil size={22} />}
						title="Make changes"
						description="Create a new branch. The agent can edit files and run checks."
						qualifier="New branch"
						action="Make changes"
						onClick={() => onStart({ mode: "code", repo: status.preparedRepo!.id })}
					/>
				</div>
			) : (
				<Card className={cn(compact ? "p-3" : "p-4")}>
					{error ? (
						<p className="m-0 text-supporting text-dim">Couldn't check readiness.</p>
					) : !status ? (
						<p className="m-0 text-supporting text-dim">Checking readiness…</p>
					) : (
						<ul className="m-0 space-y-2 pl-5 text-supporting text-dim">
							{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
						</ul>
					)}
					<div className="mt-3 flex flex-wrap gap-2">
						<Button size="sm" onClick={onRetry}>Check again</Button>
						{status?.admin && blockers.length > 0 && (
							<Button size="sm" variant="ghost" onClick={onOpenSetup}>Open workspace setup</Button>
						)}
					</div>
				</Card>
			)}
		</section>
	);
}

function ModeCard({
	compact,
	icon,
	title,
	description,
	qualifier,
	action,
	onClick,
}: {
	compact: boolean;
	icon: React.ReactNode;
	title: string;
	description: string;
	qualifier: string;
	action: string;
	onClick: () => void;
}) {
	return (
		<Card className={cn("flex flex-col", compact ? "p-3" : "p-4")}>
			<div className="flex items-start gap-3">
				<span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-active text-fg">{icon}</span>
				<div className="min-w-0 flex-1">
					<div className="text-item-title font-semibold text-fg">{title}</div>
					<p className="m-0 mt-0.5 text-supporting leading-relaxed text-dim text-pretty">{description}</p>
				</div>
			</div>
			<div className="mt-4 flex items-center justify-between gap-3">
				<span className="text-meta font-medium text-faint">{qualifier}</span>
				<Button size="sm" variant={title === "Make changes" ? "primary" : "default"} onClick={onClick}>{action}</Button>
			</div>
		</Card>
	);
}
