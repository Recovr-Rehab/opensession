import React, { useEffect, useState } from "react";
import {
	fetchOrganizationSettings,
	removeOrganizationIcon,
	saveOrganizationSettings,
	uploadOrganizationIcon,
	type OrganizationSettingsDto,
} from "../../lib/api";
import { pngFromImageFile } from "../../lib/icon-image";
import { Button } from "../../ui/button";
import { cn } from "../../ui/cn";
import {
	SettingCard,
	SettingCardSkeleton,
	SettingRow,
	SettingRowControl,
	SettingRowDescription,
	SettingRowText,
	SettingRowTitle,
	SettingsHeader,
	SettingsHint,
	SettingsPanel,
	settingsInputClass,
} from "../../ui/settings";
import { toast } from "../../ui/toast";
import { InlineAlert } from "../../ui/state";
import { IconArrowUpToLine, IconTrash } from "../icons";

const NAME_INPUT_CLASS = cn(settingsInputClass, "w-[220px] max-w-full");

export function GeneralPanel() {
	const [settings, setSettings] = useState<OrganizationSettingsDto | null>(null);
	const [draft, setDraft] = useState("");
	const [busy, setBusy] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [iconFailed, setIconFailed] = useState(false);
	const fileInput = React.useRef<HTMLInputElement>(null);

	async function load(cancelled?: () => boolean) {
		setLoadError(null);
		try {
			const next = await fetchOrganizationSettings();
			if (cancelled?.()) return;
			setSettings(next);
			setDraft(next.organizationName);
		} catch (error: any) {
			if (cancelled?.()) return;
			const message = error?.message || "Couldn’t load organization settings";
			setLoadError(message);
			toast(message, { variant: "error" });
		}
	}

	useEffect(() => {
		let cancelled = false;
		void load(() => cancelled);
		return () => {
			cancelled = true;
		};
	}, []);

	async function update(work: () => Promise<OrganizationSettingsDto>, message: string) {
		if (busy) return;
		setBusy(true);
		try {
			const next = await work();
			setSettings(next);
			setDraft(next.organizationName);
			setIconFailed(false);
			toast(message, { variant: "success" });
		} catch (error: any) {
			toast(error?.message || "Couldn’t save organization settings", {
				variant: "error",
			});
			if (settings) setDraft(settings.organizationName);
		} finally {
			setBusy(false);
		}
	}

	async function commitName() {
		const next = draft.trim();
		if (!settings || next === settings.organizationName || busy) {
			if (settings) setDraft(settings.organizationName);
			return;
		}
		await update(
			() => saveOrganizationSettings({ organizationName: next }),
			"Organization name saved.",
		);
	}

	async function upload(file: File) {
		await update(async () => {
			const png = await pngFromImageFile(file);
			return uploadOrganizationIcon(png);
		}, "Organization icon updated.");
	}

	const initial = (settings?.organizationName || "O").trim().charAt(0).toUpperCase();
	const showIcon = !!settings?.organizationIconUrl && !iconFailed;

	return (
		<SettingsPanel>
			<SettingsHeader
				title="General"
				description="Set the name and icon people see for this organization."
			/>
			{loadError && !settings ? (
				<InlineAlert onRetry={() => void load()}>{loadError}</InlineAlert>
			) : settings ? (
				<>
					<SettingCard>
						<SettingRow className="items-center">
							<SettingRowText>
								<SettingRowTitle>Organization icon</SettingRowTitle>
								<SettingRowDescription>
									Choose a square image that represents your organization.
								</SettingRowDescription>
							</SettingRowText>
							<SettingRowControl className="flex flex-wrap items-center justify-end gap-2">
								{settings.organizationIconUrl && (
									<Button
										variant="ghost"
										icon={<IconTrash size={20} />}
										disabled={busy}
										onClick={() =>
											void update(removeOrganizationIcon, "Organization icon removed.")
										}
									>
										Remove
									</Button>
								)}
								<button
									type="button"
									disabled={busy}
									onClick={() => fileInput.current?.click()}
									aria-label={showIcon ? "Change organization icon" : "Upload organization icon"}
									className="focus-ring group relative flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-active text-section-title font-semibold text-dim outline outline-1 outline-divider disabled:pointer-events-none"
								>
									{showIcon ? (
										<img
											src={settings.organizationIconUrl || undefined}
											alt=""
											className="size-full object-cover"
											onError={() => setIconFailed(true)}
										/>
									) : (
										initial
									)}
									<span className="pointer-events-none absolute inset-0 grid place-items-center rounded-[inherit] bg-black/50 text-white opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
										<IconArrowUpToLine size={20} />
									</span>
								</button>
								<input
									ref={fileInput}
									type="file"
									disabled={busy}
									accept="image/*"
									className="hidden"
									onChange={(event) => {
										const file = event.target.files?.[0];
										event.target.value = "";
										if (file) void upload(file);
									}}
								/>
							</SettingRowControl>
						</SettingRow>
						<SettingRow>
							<SettingRowText>
								<SettingRowTitle>Organization name</SettingRowTitle>
								<SettingRowDescription>
									The company or team sharing this workspace.
								</SettingRowDescription>
							</SettingRowText>
							<input
								className={NAME_INPUT_CLASS}
								value={draft}
								maxLength={80}
								disabled={busy}
								onChange={(event) => setDraft(event.target.value)}
								onBlur={() => void commitName()}
								onKeyDown={(event) => {
									if (event.key === "Enter") event.currentTarget.blur();
									else if (event.key === "Escape") setDraft(settings.organizationName);
								}}
								aria-label="Organization name"
							/>
						</SettingRow>
					</SettingCard>
					<SettingsHint>
						Shared by everyone in this workspace. Clearing the name restores the
						 product name.
					</SettingsHint>
				</>
			) : (
				<SettingCardSkeleton rows={2} label="Loading organization settings" />
			)}
		</SettingsPanel>
	);
}
