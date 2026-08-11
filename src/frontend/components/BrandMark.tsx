import React from "react";
import { BRAND_LOGOS } from "../brand-logos";

export function BrandMark({ name, size = 20 }: { name: string; size?: number }) {
	const key = name.toLowerCase();
	const logo = BRAND_LOGOS[key] || BRAND_LOGOS[key.split("-")[0]];
	if (!logo) return null;
	return (
		<svg
			data-brand={key}
			viewBox={logo.viewBox}
			width={size}
			height={size}
			fill="currentColor"
			aria-hidden="true"
		>
			{logo.paths.map((d, i) => (
				<path key={i} d={d} />
			))}
		</svg>
	);
}
