import { useState } from "react";
import { IconX } from "./icons";
import { desktopProtocolUrlFromBrowser } from "../lib/desktop-link";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { FloatingStatus } from "../ui/floating-status";
import { Tooltip } from "../ui/tooltip";

export function DesktopLinkToast({
	placement,
}: {
	placement: "composer" | "page";
}) {
	const [dismissed, setDismissed] = useState(false);
	const url = desktopProtocolUrlFromBrowser();
	if (!url || dismissed) return null;

	return (
		<div
			className={cn(
				"pointer-events-none left-1/2 z-30 -translate-x-1/2",
				placement === "composer"
					? "absolute top-0 -translate-y-full"
					: "absolute bottom-6",
			)}
		>
			<FloatingStatus className="pointer-events-auto gap-1.5 py-1.5 pr-1.5 pl-2">
				<Button
					variant="soft"
					size="sm"
					onClick={() => {
						// A user-initiated hidden navigation can open a custom protocol while
						// keeping this web page available when no desktop app handles it.
						const frame = document.createElement("iframe");
						frame.hidden = true;
						frame.setAttribute("aria-hidden", "true");
						frame.src = url;
						document.body.appendChild(frame);
						setTimeout(() => frame.remove(), 1_500);
					}}
				>
					Open app
				</Button>
				<Tooltip label="Dismiss" side="top">
					<Button
						variant="ghost"
						size="sm"
						icon={<IconX size={16} />}
						aria-label="Dismiss Open app"
						onClick={() => setDismissed(true)}
					/>
				</Tooltip>
			</FloatingStatus>
		</div>
	);
}
