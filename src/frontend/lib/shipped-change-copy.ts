const PAST_TENSE: Record<string, string> = {
	add: "added",
	adopt: "adopted",
	change: "changed",
	create: "created",
	fix: "fixed",
	improve: "improved",
	make: "made",
	polish: "polished",
	redesign: "redesigned",
	remove: "removed",
	replace: "replaced",
	simplify: "simplified",
	update: "updated",
	use: "updated",
};

export function suggestedShippedChangeMessage(title: string, repo?: string): string {
	const clean = title.replace(/^\[[^\]]+\]\s*/, "").replace(/[.!?]+$/, "").trim();
	if (!clean) return "We shipped an update.";
	const [verb, ...rest] = clean.split(/\s+/);
	const action = PAST_TENSE[verb.toLowerCase()];
	const change = action ? `${action}${rest.length ? ` ${rest.join(" ")}` : ""}` : `shipped ${clean}`;
	const product = repo === "tella-fusion" && !/\btella\b/i.test(change) ? " in Tella" : "";
	return `We ${change}${product}.`;
}
