import { defaultRepo } from "../config";
import { getCachedSessions } from "../session-cache";
import type { UnifiedSession } from "../types";
import { requestUser, type RouteContext } from "./context";

export interface OnboardingIdentity {
	login?: string | null;
	name?: string | null;
}

export function sessionBelongsToOnboardingUser(
	session: Pick<
		UnifiedSession,
		"automation" | "createdBy" | "createdByLogin" | "desk" | "startedBy"
	>,
	identity: OnboardingIdentity,
): boolean {
	if (session.automation || session.desk) return false;
	const login = identity.login?.trim().toLowerCase();
	if (login) return session.createdByLogin?.trim().toLowerCase() === login;

	const fullName = identity.name?.trim().toLowerCase();
	if (!fullName) return false;
	const firstName = fullName.split(/\s+/)[0];
	return [session.createdBy, session.startedBy].some((value) => {
		const candidate = value?.trim().toLowerCase();
		return candidate === fullName || candidate === firstName;
	});
}

export async function handleOnboardingRoutes(
	ctx: RouteContext,
): Promise<Response | undefined> {
	const { path, req, url } = ctx;
	if (path !== "/api/onboarding/status" || req.method !== "GET") return undefined;

	const name = requestUser(ctx, url.searchParams.get("user"));
	const identity = { login: ctx.authUser?.login, name: ctx.authUser?.name || name };
	let preparedRepo: {
		id: string;
		label: string;
		defaultBranch: string;
	} | null = null;
	try {
		const repo = defaultRepo();
		preparedRepo = {
			id: repo.id,
			label: repo.label,
			defaultBranch: repo.defaultBranch,
		};
	} catch {
		// A repo-less instance can still run Scratch sessions, but it cannot offer
		// a prepared repository when the first-session composer opens.
	}

	return Response.json({
		hasOwnSessions: getCachedSessions().some((session) =>
			sessionBelongsToOnboardingUser(session, identity),
		),
		preparedRepo,
	});
}
