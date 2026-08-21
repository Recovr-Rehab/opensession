import type { UnifiedSession } from "./types";

const SESSION_REFERENCE_RE =
	/(^|[^A-Za-z0-9_-])(?:@session:)?((?:os|bks)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?![A-Za-z0-9-])/gi;

type SessionName = Pick<UnifiedSession, "title" | "workspaceName">;

/** Replace stable session references with the name people see in the UI. */
export function nameSessionReferencesForTitle(
	prompt: string,
	find: (id: string) => SessionName | undefined,
): string {
	return prompt.replace(SESSION_REFERENCE_RE, (reference, prefix, id) => {
		const session = find(id);
		const name = session?.workspaceName || session?.title;
		return name ? `${prefix}${name}` : reference;
	});
}
