import { desktopProtocolUrlFromBrowser } from "../lib/desktop-link";
import { Button } from "../ui/button";

export function DesktopLinkButton() {
	const url = desktopProtocolUrlFromBrowser();
	if (!url) return null;

	return (
		<Button
			variant="soft"
			size="xs"
			className="shrink-0"
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
	);
}
