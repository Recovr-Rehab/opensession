export type GithubAppOwnerType = "personal" | "organization";

export interface GithubAppCreateOwner {
	type: GithubAppOwnerType;
	login: string;
}

/** Read the account choice already encoded in GitHub's new-App URL. */
export function githubAppCreateOwner(value: string): GithubAppCreateOwner {
	try {
		const url = new URL(value);
		const match = url.pathname.match(/^\/organizations\/([^/]+)\/settings\/apps\/new$/);
		if (match) {
			return { type: "organization", login: decodeURIComponent(match[1] || "") };
		}
	} catch {}
	return { type: "personal", login: "" };
}

/** Keep all prefilled App settings while changing who creates the App. */
export function githubAppCreateUrlForOwner(
	value: string,
	type: GithubAppOwnerType,
	login: string,
): string {
	try {
		const url = new URL(value);
		url.pathname = type === "organization"
			? `/organizations/${encodeURIComponent(login.trim())}/settings/apps/new`
			: "/settings/apps/new";
		return url.toString();
	} catch {
		return value;
	}
}
