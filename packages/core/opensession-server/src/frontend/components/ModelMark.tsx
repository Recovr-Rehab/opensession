import React from "react";
import { modelBrandKey } from "../lib/model-brand";
import { BrandMark } from "./BrandMark";

/**
 * The vendor mark behind a model id, so every model dropdown draws one brand
 * one way (the same registry the Connections cards and engine pickers use).
 * Presets combine vendors, so they carry no mark and keep their reserved slot
 * empty.
 */
export function ModelMark({
	id,
	provider,
	size = 15,
}: {
	id: string;
	provider?: string;
	size?: number;
}) {
	const key = modelBrandKey(id, provider);
	if (!key) return null;
	return <BrandMark name={key} size={size} />;
}
