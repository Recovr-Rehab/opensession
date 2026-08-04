/**
 * Onboarding status endpoint — what the Settings → Setup page renders.
 *
 * Aggregates the instance's configuration state (repos, team roster, GitHub
 * auth, per-integration enablement + credential presence) into one read-only
 * snapshot. SECURITY: this returns presence booleans only — never an env var
 * value, and never the OAuth client secret in any form.
 */

import type { RouteContext } from "./context";

export async function handleSetupRoutes(
	ctx: RouteContext,
): Promise<Response | undefined> {
	const { req, path } = ctx;

	if (path === "/backstage/api/setup/status" && req.method === "GET") {
		const { configuredServer, configuredRepos, configuredIdentity } =
			await import("../config");
		const { INTEGRATIONS } = await import("../integrations/registry");
		const { isEnabled } = await import("../integrations/load");
		const { githubUserAuthSettings, githubRedirectFlowAvailable } =
			await import("../github-auth");

		const publicBaseUrl = configuredServer().publicBaseUrl.replace(/\/$/, "");
		const github = githubUserAuthSettings();

		return Response.json({
			publicBaseUrl,
			repos: Object.values(configuredRepos()).map((r) => ({
				id: r.id,
				label: r.label,
				path: r.repo,
			})),
			team: (() => {
				const team = configuredIdentity().team;
				return { count: team.length, names: team.map((m) => m.name) };
			})(),
			github: {
				userPrAuth: github.enabled,
				clientIdConfigured: !!github.clientId,
				redirectFlowAvailable: githubRedirectFlowAvailable(),
				callbackUrl: `${publicBaseUrl}/api/auth/callback`,
				botTokenPresent: !!process.env.GITHUB_API_TOKEN,
			},
			// `always` entries self-gate and need no setup, so they are not
			// presented as onboarding steps.
			integrations: INTEGRATIONS.filter((spec) => !spec.always).map((spec) => {
				const env = spec.env.map((e) => ({
					name: e.name,
					required: !!e.required,
					description: e.description,
					present: !!process.env[e.name],
				}));
				return {
					id: spec.id,
					label: spec.label,
					doc: spec.doc,
					enabled: isEnabled(spec),
					env,
					missingRequired: env
						.filter((e) => e.required && !e.present)
						.map((e) => e.name),
				};
			}),
		});
	}

	return undefined;
}
