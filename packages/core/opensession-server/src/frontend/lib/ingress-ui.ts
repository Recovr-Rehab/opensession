import type { IngressExposure, PublicIngressSettings } from "./api/ingress";

export const INGRESS_METHODS: Array<{
	value: IngressExposure;
	label: string;
	description: string;
}> = [
	{
		value: "tailscale",
		label: "Tailscale Funnel",
		description: "Uses Tailscale’s generated .ts.net URL. No DNS records or inbound firewall ports.",
	},
	{
		value: "cloudflare",
		label: "Cloudflare Tunnel",
		description: "An outbound connector through Cloudflare. No inbound firewall ports are required.",
	},
	{
		value: "custom",
		label: "Custom domain with Caddy",
		description: "Works with any DNS provider. Your server must accept public traffic on ports 80 and 443.",
	},
];

export function ingressHealthLabel(health: PublicIngressSettings["health"]): string {
	if (health === "ready") return "Ready";
	if (health === "waiting_dns") return "Waiting for DNS";
	if (health === "unreachable") return "Not reachable";
	return "Not configured";
}

export function ingressHealthDot(health: PublicIngressSettings["health"]): string {
	if (health === "ready") return "var(--green)";
	if (health === "waiting_dns") return "var(--yellow)";
	if (health === "unreachable") return "var(--red)";
	return "var(--text-faint)";
}

/** Accept a hostname or an HTTPS origin and return only its hostname. */
export function ingressHostname(value: string, fallback = "ingress.example.com"): string {
	const trimmed = value.trim();
	if (!trimmed) return fallback;
	try {
		return new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`).hostname || fallback;
	} catch {
		return fallback;
	}
}

export function customDnsRecords(settings: PublicIngressSettings, value: string): string[] {
	const hostname = ingressHostname(value);
	return [
		...settings.server.ipv4.map((address) => `A ${hostname} ${address}`),
		...settings.server.ipv6.map((address) => `AAAA ${hostname} ${address}`),
	];
}

export function customCaddyConfig(value: string): string {
	return `${ingressHostname(value)} {\n    # BEGIN OPENSESSION SANDBOX INGRESS\n    handle {\n        reverse_proxy 127.0.0.1:3860\n    }\n    # END OPENSESSION SANDBOX INGRESS\n}`;
}

export function configuredAppDomain(settings: PublicIngressSettings): string {
	try {
		const url = new URL(settings.app.publicBaseUrl);
		return url.protocol === "https:" ? url.hostname : "";
	} catch {
		return "";
	}
}

export function privateAppDnsRecord(settings: PublicIngressSettings, value: string): string | null {
	return settings.app.tailnetIpv4
		? `A ${ingressHostname(value, "os.example.com")} ${settings.app.tailnetIpv4}`
		: null;
}

export function privateAppCaddyConfig(settings: PublicIngressSettings, value: string): string {
	const hostname = ingressHostname(value, "os.example.com");
	const bind = settings.app.tailnetIpv4 || "<tailscale-ip>";
	return `${hostname} {\n    bind ${bind}\n    tls /etc/opensession/tls/${hostname}.crt /etc/opensession/tls/${hostname}.key\n    reverse_proxy 127.0.0.1:3850 {\n        lb_try_duration 15s\n        lb_try_interval 250ms\n    }\n}`;
}

export function configuredIngressDrafts(settings: PublicIngressSettings): Record<IngressExposure, string> {
	return {
		tailscale: settings.tailscale.suggestedUrl,
		cloudflare: settings.exposure === "cloudflare" ? settings.publicBaseUrl : "",
		custom:
			settings.exposure === "custom" && settings.publicBaseUrl
				? ingressHostname(settings.publicBaseUrl, "")
				: "",
	};
}
