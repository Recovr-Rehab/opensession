import { useState } from "react";
import { IconX } from "./icons";
import { PRODUCT_NAME } from "../lib/brand";
import { desktopProtocolUrlFromBrowser } from "../lib/desktop-link";
import { SIDEBAR_TOAST_CARD } from "../lib/sidebar-toast-classes";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/tooltip";

export function DesktopLinkToast() {
	const [dismissed, setDismissed] = useState(false);
	const url = desktopProtocolUrlFromBrowser();
	if (!url || dismissed) return null;

	return (
		<div
			className={SIDEBAR_TOAST_CARD}
			role="region"
			aria-label="Open in desktop app"
		>
			{/* Wraps rather than truncates: the product name is instance
			    configurable, and at the card's width a two-word one already
			    clipped to "Open in Open S…". Two lines match the update
			    toast's height; the clamp keeps a long name from growing the
			    card without bound. */}
			<span className="min-w-0 flex-1 text-balance line-clamp-2 text-label font-medium leading-[1.3] text-fg">
				Open in {PRODUCT_NAME}
			</span>
			<div className="flex shrink-0 items-center gap-1">
				<Button
					variant="primary"
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
			</div>
		</div>
	);
}
