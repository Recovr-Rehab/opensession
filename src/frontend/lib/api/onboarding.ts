import { request } from "./request";

export interface TeammateOnboardingStatus {
	hasOwnSessions: boolean;
	admin: boolean;
	preparedRepo: {
		id: string;
		label: string;
		defaultBranch: string;
	} | null;
	capabilities: {
		task: { ready: boolean; blocker: string | null };
		changes: { ready: boolean; blocker: string | null };
	};
}

export function fetchTeammateOnboardingStatus(
	user: string,
	cloud = false,
): Promise<TeammateOnboardingStatus> {
	const params = new URLSearchParams({ user });
	if (cloud) params.set("cloud", "1");
	return request(
		`/onboarding/status?${params}`,
		{ label: "Couldn't check workspace readiness" },
	);
}
