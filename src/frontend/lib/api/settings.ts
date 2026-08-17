import { request } from "./request";

// ── Audit log ──

export interface AuditPage {
	dates: string[];
	events?: Array<Record<string, unknown>>;
	total?: number;
	types?: string[];
}

export async function fetchAudit(opts: {
	date?: string;
	q?: string;
	type?: string;
	session?: string;
	/** Include the per-turn firehose (tool_use/tool_result/…). */
	all?: boolean;
	offset?: number;
	limit?: number;
}): Promise<AuditPage> {
	const params = new URLSearchParams();
	if (opts.date) params.set("date", opts.date);
	if (opts.q) params.set("q", opts.q);
	if (opts.type) params.set("type", opts.type);
	if (opts.session) params.set("session", opts.session);
	if (opts.all) params.set("all", "1");
	if (opts.offset) params.set("offset", String(opts.offset));
	if (opts.limit) params.set("limit", String(opts.limit));
	return request(`/audit?${params.toString()}`, {
		label: "Failed to fetch audit log",
	});
}

// ── Papercuts (Settings → Papercuts: cross-session friction log) ──

export interface PapercutDto {
	ts: string;
	message: string;
	repo?: string;
	sessionId?: string;
	model?: string;
	runKind?: string;
	by?: string;
}

export interface PapercutsRepoConfig {
	repoId: string;
	enabled: boolean;
}

export async function fetchPapercuts(opts?: {
	repo?: string;
	days?: number;
}): Promise<{ entries: PapercutDto[]; repos: PapercutsRepoConfig[] }> {
	const params = new URLSearchParams();
	if (opts?.repo) params.set("repo", opts.repo);
	if (opts?.days) params.set("days", String(opts.days));
	const qs = params.toString();
	return request(`/papercuts${qs ? `?${qs}` : ""}`, {
		label: "Failed to fetch papercuts",
	});
}

export async function setPapercutsRepoEnabled(
	repo: string,
	enabled: boolean,
): Promise<{ repos: PapercutsRepoConfig[] }> {
	return request("/papercuts/config", {
		method: "PUT",
		body: { repo, enabled },
	});
}

// ── Keychain (Settings → My accounts: per-person credentials + grants) ──

export interface KeychainCredentialDto {
	id: string;
	owner: string;
	service: string;
	description?: string;
	host: string;
	injection?: { header?: string; scheme?: string };
	allowedMethods?: string[];
	allowedPathPrefixes?: string[];
	createdAt: string;
	updatedAt: string;
}

export interface KeychainGrantDto {
	id: string;
	credentialId: string;
	owner: string;
	sessionId: string;
	requestedBy: string;
	purpose: string;
	mode: "once" | "standing";
	status: "active" | "used" | "revoked" | "expired";
	createdAt: string;
	expiresAt: string;
}

export interface KeychainAskDto {
	id: string;
	credentialId: string;
	owner: string;
	sessionId: string;
	requestedBy: string;
	purpose: string;
	requestedMode: "once" | "standing";
	status: "pending" | "approved" | "declined" | "expired";
	createdAt: string;
}

export async function fetchKeychain(): Promise<{
	credentials: KeychainCredentialDto[];
	grants: KeychainGrantDto[];
	asks: KeychainAskDto[];
}> {
	return request("/keychain", { label: "Failed to fetch the keychain" });
}

export async function addKeychainCredential(input: {
	service: string;
	host: string;
	secret: string;
	description?: string;
	injection?: { header?: string; scheme?: string };
	allowedMethods?: string[];
	allowedPathPrefixes?: string[];
}): Promise<{ credential: KeychainCredentialDto }> {
	return request("/keychain/credentials", { method: "POST", body: input });
}

export async function deleteKeychainCredential(id: string): Promise<{ ok: true }> {
	return request(`/keychain/credentials/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
}

export async function revokeKeychainGrant(id: string): Promise<{ ok: true }> {
	return request(`/keychain/grants/${encodeURIComponent(id)}`, {
		method: "DELETE",
	});
}

// ── Deploys (Settings → Deploys: agent-published internal apps) ──

export interface DeployVersionDto {
	version: number;
	createdAt: string;
	createdBy: string;
	sessionId?: string;
	entrypoint: string;
}

export interface DeployDto {
	id: string;
	name: string;
	owner: string;
	sessionId?: string;
	description?: string;
	port: number;
	currentVersion: number;
	versions: DeployVersionDto[];
	state: "running" | "stopped" | "crashed";
	lastError?: string;
	createdAt: string;
	updatedAt: string;
}

export async function fetchDeploys(): Promise<{ deploys: DeployDto[] }> {
	return request("/deploys", { label: "Failed to fetch deploys" });
}

export async function setDeployRunning(
	name: string,
	running: boolean,
): Promise<{ deploy: DeployDto }> {
	return request(`/deploys/${encodeURIComponent(name)}/${running ? "start" : "stop"}`, {
		method: "POST",
	});
}

export async function rollbackDeployTo(
	name: string,
	version: number,
): Promise<{ deploy: DeployDto }> {
	return request(`/deploys/${encodeURIComponent(name)}/rollback`, {
		method: "POST",
		body: { version },
	});
}

export async function deleteDeployApp(name: string): Promise<{ ok: true }> {
	return request(`/deploys/${encodeURIComponent(name)}`, { method: "DELETE" });
}

// ── Personal system prompt (Settings → Personal prompt) ──

export async function fetchPersonalPrompt(
	user: string,
): Promise<{ prompt: string }> {
	return request(`/personal-prompt?user=${encodeURIComponent(user)}`, {
		label: "Failed to fetch personal prompt",
	});
}

export async function savePersonalPrompt(
	user: string,
	prompt: string,
): Promise<{ prompt: string }> {
	return request("/personal-prompt", {
		method: "PUT",
		body: { user, prompt },
	});
}

// ── Instance identity (Settings → General: agent + product name) ──

export interface InstanceIdentityDto {
	personaName: string;
	productName: string;
	productMark: string;
	configPath: string;
}

export async function fetchInstanceIdentity(): Promise<InstanceIdentityDto> {
	return request("/settings/identity", {
		label: "Failed to fetch instance identity",
	});
}

/** Empty string resets a field to its built-in default. */
export async function saveInstanceIdentity(patch: {
	personaName?: string;
	productName?: string;
}): Promise<InstanceIdentityDto> {
	return request("/settings/identity", { method: "PUT", body: patch });
}

// ── Memory (Settings → Memory: repo/user/team/channel stores) ──

export interface MemoryEntryDto {
	id: string;
	text: string;
	by: string;
	at: string;
}

export interface MemoryScopeDto {
	scope: {
		key: string;
		kind: "repo" | "user" | "team" | "channel";
		label: string;
	};
	entries: MemoryEntryDto[];
}

export async function fetchMemory(): Promise<{ scopes: MemoryScopeDto[] }> {
	return request("/memory", { label: "Failed to fetch memory" });
}

export async function addMemoryEntryApi(
	scopeKey: string,
	text: string,
	by: string,
): Promise<{ entry: MemoryEntryDto }> {
	return request("/memory", {
		method: "POST",
		body: { scopeKey, text, by },
		label: "Failed to add memory",
	});
}

export async function updateMemoryEntryApi(
	scopeKey: string,
	id: string,
	text: string,
): Promise<{ entry: MemoryEntryDto }> {
	return request("/memory", {
		method: "PUT",
		body: { scopeKey, id, text },
		label: "Failed to update memory",
	});
}

export async function deleteMemoryEntryApi(
	scopeKey: string,
	id: string,
): Promise<void> {
	await request<void>("/memory", {
		method: "DELETE",
		body: { scopeKey, id },
		label: "Failed to delete memory",
	});
}
