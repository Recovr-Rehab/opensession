import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { SetupGithub, SetupIntegration } from "./setup-shared";
import { GithubAuthCard, IntegrationsList } from "./SetupIntegrations";

const integration: SetupIntegration = {
	id: "linear",
	label: "Linear",
	doc: "",
	enabled: false,
	env: [],
	links: [],
	missingRequired: ["LINEAR_API_KEY"],
};

function renderIntegration(enabled: boolean): string {
	return renderToStaticMarkup(
		<IntegrationsList
			integrations={[{ ...integration, enabled }]}
			onSaved={() => {}}
		/>,
	);
}

describe("integration credential warnings", () => {
	test("hides missing credentials while the integration is off", () => {
		expect(renderIntegration(false)).not.toContain("Missing LINEAR_API_KEY");
	});

	test("shows missing credentials while the integration is on", () => {
		expect(renderIntegration(true)).toContain("Missing LINEAR_API_KEY");
	});
});

const github: SetupGithub = {
	userPrAuth: false,
	clientIdConfigured: false,
	clientSecretConfigured: false,
	mentionHandle: "opensession",
	appCredentialConfigured: false,
	privateKeyConfigured: false,
	appSlug: null,
	installationOwner: "acme",
	appCreateUrl: "https://github.com/organizations/acme/settings/apps/new",
};

function renderGithub(appSlug: string | null): string {
	return renderToStaticMarkup(
		<GithubAuthCard
			github={{ ...github, appSlug }}
			onSaved={() => {}}
			onboarding
		/>,
	);
}

describe("GitHub App onboarding actions", () => {
	test("shows both numbered steps and disables install until there is an App slug", () => {
		const markup = renderGithub(null);
		expect(markup).toContain("1. Create GitHub App");
		expect(markup).toMatch(
			/<button[^>]*disabled=""[^>]*><span[^>]*>2\. Install GitHub App<\/span><\/button>/,
		);
	});

	test("links the install step when the App slug is known", () => {
		const markup = renderGithub("open-session-acme");
		expect(markup).toContain(
			'href="https://github.com/apps/open-session-acme/installations/new"',
		);
		expect(markup).toContain("2. Install GitHub App");
	});

	test("uploads the private key from a PEM file", () => {
		const markup = renderGithub(null);
		expect(markup).toContain('type="file"');
		expect(markup).toContain('accept=".pem,application/x-pem-file,text/plain"');
		expect(markup).toContain("Choose PEM file");
		expect(markup).not.toContain("BEGIN RSA PRIVATE KEY");
	});
});
