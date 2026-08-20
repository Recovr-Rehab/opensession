import React, { useEffect, useRef, useState } from "react";
import { Reorder } from "motion/react";
import type { SidebarToolId } from "../../lib/sidebar-tools";
import { Modal } from "../../ui/modal";
import { Switch } from "../../ui/switch";
import { IconGripVertical } from "../icons";
import { RepoTile, repoLabel } from "../RepoTile";

type OrderItem<T extends string> = {
	id: T;
	label: string;
	icon: React.ReactNode;
	action?: React.ReactNode;
};

function OrderSection<T extends string>({
	label,
	items,
	onCommit,
}: {
	label: string;
	items: OrderItem<T>[];
	onCommit: (order: T[]) => void;
}) {
	const signature = items.map((item) => item.id).join("\u0000");
	const [order, setOrder] = useState<T[]>(() => items.map((item) => item.id));
	const orderRef = useRef(order);
	const committedRef = useRef(signature);
	const [announcement, setAnnouncement] = useState("");

	useEffect(() => {
		const next = items.map((item) => item.id);
		setOrder(next);
		orderRef.current = next;
		committedRef.current = signature;
	}, [signature]);

	const byId = new Map(items.map((item) => [item.id, item]));

	function setDraft(next: T[]) {
		orderRef.current = next;
		setOrder(next);
	}

	function commit() {
		const next = orderRef.current;
		const nextSignature = next.join("\u0000");
		if (nextSignature === committedRef.current) return;
		committedRef.current = nextSignature;
		onCommit(next);
	}

	function move(id: T, offset: number) {
		const next = [...orderRef.current];
		const from = next.indexOf(id);
		const to = Math.max(0, Math.min(next.length - 1, from + offset));
		if (from < 0 || from === to) return;
		next.splice(from, 1);
		next.splice(to, 0, id);
		setDraft(next);
		committedRef.current = next.join("\u0000");
		onCommit(next);
		setAnnouncement(`${byId.get(id)?.label ?? id} moved to position ${to + 1}`);
	}

	return (
		<section
			className="-mx-2"
			aria-labelledby={`sidebar-order-${label.toLowerCase()}`}
		>
			<h3
				id={`sidebar-order-${label.toLowerCase()}`}
				className="m-0 mb-1.5 px-2 text-label font-semibold text-faint"
			>
				{label}
			</h3>
			{order.length === 0 ? (
				// Left-aligned like the rows it stands in for.
				<p className="m-0 rounded-lg bg-panel px-2 py-4 text-label text-faint">
					No {label.toLowerCase()} available.
				</p>
			) : (
				<Reorder.Group
					as="div"
					axis="y"
					values={order}
					onReorder={setDraft}
					className="rounded-lg bg-panel p-0.5"
					role="list"
				>
					{order.map((id, index) => {
						const item = byId.get(id);
						if (!item) return null;
						return (
							<Reorder.Item
								as="div"
								key={id}
								value={id}
								onDragEnd={commit}
								whileDrag={{ scale: 1.015, zIndex: 2 }}
								className="focus-ring group flex min-h-9 cursor-grab select-none items-center gap-2 rounded-control bg-panel px-1.5 py-1.5 text-item-title text-fg active:cursor-grabbing hover:bg-hover phone:min-h-11"
								role="listitem"
								tabIndex={0}
								aria-label={`${item.label}, position ${index + 1} of ${order.length}. Use the up and down arrow keys to move it.`}
								onKeyDown={(event) => {
									if (event.target !== event.currentTarget) return;
									if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
									event.preventDefault();
									move(id, event.key === "ArrowUp" ? -1 : 1);
								}}
							>
								<span className="flex size-5 shrink-0 items-center justify-center text-faint group-hover:text-dim">
									<IconGripVertical size={18} />
								</span>
								{/* Shared geometry keeps every tool and repository label
								    on the same vertical line. */}
								<span className="flex size-5 shrink-0 items-center justify-center text-dim [&_svg]:size-[20px]">
									{item.icon}
								</span>
								<span className="min-w-0 flex-1 truncate">{item.label}</span>
								{item.action && (
									<span
										className="shrink-0"
										onPointerDown={(event) => event.stopPropagation()}
									>
										{item.action}
									</span>
								)}
							</Reorder.Item>
						);
					})}
				</Reorder.Group>
			)}
			<div className="sr-only" aria-live="polite">
				{announcement}
			</div>
		</section>
	);
}

export function SidebarCustomizeDialog({
	open,
	onOpenChange,
	tools,
	repositories,
	onToolOrderChange,
	onRepositoryOrderChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	tools: Array<
		OrderItem<SidebarToolId> & {
			shown: boolean;
			onShownChange: (shown: boolean) => void;
		}
	>;
	repositories: string[];
	onToolOrderChange: (order: SidebarToolId[]) => void;
	onRepositoryOrderChange: (order: string[]) => void;
}) {
	return (
		<Modal.Root open={open} onOpenChange={onOpenChange}>
			<Modal.Content
				widthClassName="max-w-[32rem]"
				className="max-h-[80dvh] gap-3"
			>
				<Modal.Header title="Customize sidebar" />
				<OrderSection
					label="Tools"
					items={tools.map((tool) => ({
						...tool,
						action: (
							<Switch
								size="sm"
								className="phone:after:absolute phone:after:inset-x-0 phone:after:-inset-y-3 phone:after:content-['']"
								checked={tool.shown}
								onCheckedChange={tool.onShownChange}
								aria-label={`${tool.shown ? "Hide" : "Show"} ${tool.label} in sidebar`}
							/>
						),
					}))}
					onCommit={onToolOrderChange}
				/>
				<OrderSection
					label="Repositories"
					items={repositories.map((repo) => ({
						id: repo,
						label: repoLabel(repo),
						icon: <RepoTile name={repo} size={20} />,
					}))}
					onCommit={onRepositoryOrderChange}
				/>
			</Modal.Content>
		</Modal.Root>
	);
}
