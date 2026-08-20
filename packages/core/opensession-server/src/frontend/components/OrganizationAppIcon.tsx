import React, { useState } from "react";
import { APP_LOGO_IMAGE } from "../lib/app-header-classes";
import {
	DEFAULT_APP_ICON_URL,
	useOrganizationIcon,
} from "../hooks/useOrganizationIcon";

/** The organization mark when configured, with the bundled app mark as fallback. */
export function OrganizationAppIcon() {
	const configuredSrc = useOrganizationIcon();
	const [failedSrc, setFailedSrc] = useState<string | null>(null);
	const usesOrganizationIcon =
		configuredSrc !== DEFAULT_APP_ICON_URL && failedSrc !== configuredSrc;
	const src = usesOrganizationIcon ? configuredSrc : DEFAULT_APP_ICON_URL;

	return (
		<img
			className={
				usesOrganizationIcon
					? "block size-11 rounded-control object-cover"
					: APP_LOGO_IMAGE
			}
			src={src}
			alt=""
			onError={() => {
				if (src !== DEFAULT_APP_ICON_URL) setFailedSrc(src);
			}}
		/>
	);
}
