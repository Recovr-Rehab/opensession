import { useEffect, useState, type ReactNode } from "react";
import { useIsPhone } from "../hooks/useIsPhone";
import { BASE_PATH } from "../lib/base";
import { Button } from "../ui/button";
import { ResponsiveDialog } from "../ui/sheet";
import { IconChevronLeft, IconX } from "./icons";

/** Apple's mark, for the Mac download. A solid glyph, not part of the stroke set. */
function IconApple({ size = 20 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="currentColor"
			aria-hidden="true"
		>
			<path d="M16.365 1.43c0 1.14-.417 2.2-1.25 3.06-.99 1.02-2.09 1.61-3.28 1.52a3.3 3.3 0 0 1-.02-.4c0-1.09.47-2.25 1.3-3.09.42-.43.95-.79 1.6-1.08.64-.28 1.25-.44 1.82-.47.02.15.03.3.03.46zM20.6 17.02c-.32.74-.7 1.42-1.14 2.05-.6.86-1.09 1.45-1.47 1.78-.59.54-1.22.82-1.9.84-.48 0-1.07-.14-1.75-.42-.68-.28-1.31-.42-1.89-.42-.6 0-1.25.14-1.94.42-.7.28-1.26.43-1.69.44-.65.03-1.29-.26-1.92-.86-.41-.36-.92-.97-1.53-1.83-.65-.92-1.19-1.98-1.6-3.2-.45-1.31-.68-2.58-.68-3.81 0-1.4.3-2.61.91-3.62a5.35 5.35 0 0 1 1.9-1.93 5.1 5.1 0 0 1 2.57-.72c.51 0 1.18.16 2.02.47.83.31 1.37.47 1.6.47.18 0 .78-.19 1.79-.55.96-.34 1.77-.48 2.43-.42 1.79.14 3.14.85 4.03 2.13-1.6.97-2.39 2.33-2.38 4.07.02 1.36.51 2.49 1.48 3.38.44.42.93.74 1.47.97-.12.34-.24.66-.38.97z" />
		</svg>
	);
}

export function DownloadAppsDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const phone = useIsPhone();
	const [showInstallHelp, setShowInstallHelp] = useState(false);

	useEffect(() => {
		if (!open) setShowInstallHelp(false);
	}, [open]);

	return (
		<ResponsiveDialog
			open={open}
			onClose={() => onOpenChange(false)}
			phone={phone}
			label="Download apps"
			modalClassName="w-[calc(100vw-3rem)] max-w-[48rem] max-h-[calc(100dvh-3rem)] rounded-[calc(30px*var(--rf))] p-10"
			sheetClassName="max-h-[92dvh]"
		>
			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-5 pt-2 desktop:overflow-visible desktop:p-0">
				<header className="mb-5 flex shrink-0 items-center justify-between gap-4">
					<div className="flex min-w-0 items-center gap-1">
						{showInstallHelp && (
							<Button
								variant="ghost"
								size="lg"
								icon={<IconChevronLeft size={22} />}
								className="size-11 shrink-0 desktop:size-9"
								onClick={() => setShowInstallHelp(false)}
								aria-label="Back to apps"
							/>
						)}
						<h2 className="m-0 truncate text-page-title font-semibold leading-tight tracking-[-0.02em] text-fg">
							{showInstallHelp ? "Install the web app" : "Download apps"}
						</h2>
					</div>
					<Button
						variant="soft"
						size="lg"
						icon={<IconX size={22} />}
						className="size-11 shrink-0 rounded-full text-faint desktop:size-9"
						onClick={() => onOpenChange(false)}
						aria-label="Close"
					/>
				</header>

				<DownloadAppsBody
					showInstallHelp={showInstallHelp}
					onShowInstallHelp={() => setShowInstallHelp(true)}
				/>
			</div>
		</ResponsiveDialog>
	);
}

/**
 * The two app cards, or the three PWA steps once the web card is picked. Split
 * out of the dialog so Settings › Downloads can host the same thing inline —
 * one description of what you can install, two places to reach it.
 */
export function DownloadAppsBody({
	showInstallHelp,
	onShowInstallHelp,
}: {
	showInstallHelp: boolean;
	onShowInstallHelp: () => void;
}) {
	if (showInstallHelp)
		return (
			<div className="grid min-h-0 flex-1 gap-3 desktop:grid-cols-3">
				<InstallStep number="1" title="Open in your browser">
					Use Safari on iPhone or iPad, or Chrome on Android and desktop.
				</InstallStep>
				<InstallStep number="2" title="Open the browser menu">
					On iPhone or iPad, tap Share. Elsewhere, open the browser menu.
				</InstallStep>
				<InstallStep number="3" title="Add Open Session">
					Choose Add to Home Screen, Install app, or Add to Dock.
				</InstallStep>
			</div>
		);

	return (
		<div className="grid min-h-0 flex-1 gap-4 desktop:grid-cols-[3fr_2fr]">
			<AppCard
				preview={
					<div className="relative h-full overflow-hidden bg-blue-soft bg-gradient-to-br from-blue-soft via-transparent to-green-soft pl-5 pt-5">
						<img
							src={`${BASE_PATH}/download-mac.webp`}
							alt="Open Session running on Mac"
							className="h-full w-full rounded-tl-lg object-cover object-left-top outline outline-1 -outline-offset-1 outline-black/10"
						/>
						<div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-b from-transparent to-panel" />
					</div>
				}
				title="Open Session for Mac"
				subtitle="Apple silicon"
			>
				<Button
					variant="primary"
					size="lg"
					icon={<IconApple size={20} />}
					className="min-h-10 w-full"
					render={
						<a
							href={`${BASE_PATH}/api/packages/clients/mac/download/latest.dmg`}
						/>
					}
				>
					Download
				</Button>
			</AppCard>

			<AppCard
				preview={
					<div className="relative flex h-full justify-center overflow-hidden bg-green-soft bg-gradient-to-br from-green-soft via-transparent to-blue-soft px-3 pt-6">
						<img
							src={`${BASE_PATH}/download-phone.webp`}
							alt="Open Session installed as a phone web app"
							className="h-[115%] w-auto max-w-none origin-top object-contain object-top smooth-shadow-lg"
						/>
						<div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-b from-transparent to-panel" />
					</div>
				}
				title="Web"
				subtitle="Install as a PWA"
			>
				<Button
					variant="soft"
					size="lg"
					className="min-h-10 w-full"
					onClick={onShowInstallHelp}
				>
					How to install
				</Button>
			</AppCard>
		</div>
	);
}

function AppCard({
	preview,
	title,
	subtitle,
	children,
}: {
	preview: ReactNode;
	title: string;
	subtitle: string;
	children: ReactNode;
}) {
	return (
		<section className="flex min-h-[20rem] flex-col overflow-hidden rounded-[calc(22px*var(--rf))] bg-panel desktop:h-[22rem] desktop:min-h-0">
			<div className="min-h-0 flex-1">{preview}</div>
			<div className="relative z-10 flex shrink-0 flex-col px-4 pb-4 desktop:px-5 desktop:pb-5">
				<h3 className="m-0 text-section-title font-semibold leading-tight text-fg">{title}</h3>
				<p className="mb-4 mt-1 text-body font-medium text-dim">{subtitle}</p>
				{children}
			</div>
		</section>
	);
}

function InstallStep({
	number,
	title,
	children,
}: {
	number: string;
	title: string;
	children: ReactNode;
}) {
	return (
		<section className="flex min-h-48 flex-col rounded-xl bg-panel p-5 desktop:min-h-60">
			<div className="mb-auto flex size-10 items-center justify-center rounded-control bg-accent text-body font-semibold text-on-accent">
				{number}
			</div>
			<h3 className="mb-1 mt-6 text-section-title font-semibold leading-tight text-fg">{title}</h3>
			<p className="m-0 text-body font-normal leading-relaxed text-dim">{children}</p>
		</section>
	);
}
