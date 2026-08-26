import { brandKey, brandLogo } from "../brand-logos";
import { modelVendor } from "./model-engine";

/** Product-facing model brands for upstream vendors whose registry names differ. */
const VENDOR_BRANDS: Record<string, string> = {
	anthropic: "claude",
	openai: "codex",
};

/** Resolve a model id to a brand mark, leaving multi-vendor presets unbranded. */
export function modelBrandKey(id: string, provider?: string): string | null {
	const vendor = modelVendor(id);
	if (vendor) {
		const key = VENDOR_BRANDS[vendor] ?? brandKey(vendor);
		return brandLogo(key) ? key : null;
	}
	// Legacy direct-SDK ids carry no vendor segment; the engine names it.
	if (provider === "claude" || id.startsWith("claude-")) return "claude";
	if (provider === "codex" || id.startsWith("gpt-") || id.startsWith("codex-"))
		return "codex";
	return null;
}
