import {
	personKey,
	prReviewCompletion,
	reviewRequestTargetsPerson,
	reviewRowMatchesPersonFilter,
	rowIsOwnWork,
	wsPrRequestsReviewFrom,
} from "./review-queue";
import { wsPrApproved, wsPrMerged } from "./sidebar-lanes";
import type { WsRow } from "./sidebar-types";

export type SidebarPlacement =
	| "snoozed"
	| "needs-review"
	| "approved-review"
	| "awaiting-review"
	| "completed-review"
	| "auto-created"
	| "status"
	| "outside";

export interface SidebarPlacementContext {
	currentUser: string;
	personFilter: string;
	snoozed: boolean;
	inStatusScope: boolean;
}

export interface PlacedSidebarRow<T extends WsRow = WsRow> {
	row: T;
	placement: SidebarPlacement;
}

const AUTOMATION_MACHINE_IDENTITY = "automation";

/**
 * A normal workspace or session created through the browser automation
 * identity. Automation runs are a different product concept and keep their
 * own `automation` field, so they never enter this section.
 */
export function rowWasAutoCreated(row: WsRow): boolean {
	const ordinarySessions = row.sessions.filter((session) => !session.automation);
	if (ordinarySessions.some(
		(session) =>
			[session.createdBy, session.startedBy].some(
				(person) =>
					person?.trim().toLowerCase() === AUTOMATION_MACHINE_IDENTITY,
			),
	))
		return true;
	// An automation-only row is still an automation run even if its container
	// happened to be minted by the machine identity.
	if (row.sessions.length > 0 && ordinarySessions.length === 0) return false;
	return (
		row.workspace?.createdBy.trim().toLowerCase() ===
		AUTOMATION_MACHINE_IDENTITY
	);
}

/** The dedicated section exists only in the default lens. Aggregate and
 * machine-person lenses already include these rows in Workspaces. */
export function rowUsesAutoCreatedSection(
	row: WsRow,
	personFilter: string,
): boolean {
	return personFilter === "me" && rowWasAutoCreated(row);
}

export function classifySidebarPlacement(
	row: WsRow,
	context: SidebarPlacementContext,
): SidebarPlacement {
	if (context.snoozed) return "snoozed";

	const me = context.currentUser.toLowerCase();
	const githubAsksMe =
		wsPrRequestsReviewFrom(row, personKey(context.currentUser)) &&
		!rowIsOwnWork(row, context.currentUser);
	const inReviewScope = reviewRowMatchesPersonFilter(
		row.owner,
		row.sessions.map((session) => session.reviewRequest),
		context.personFilter,
		context.currentUser,
		githubAsksMe,
	);

	if (inReviewScope && !wsPrMerged(row)) {
		// A request GitHub is still making of you outranks another reviewer's
		// approval. Your part is not complete until that request clears.
		if (githubAsksMe) return "needs-review";

		const approved = wsPrApproved(row);
		const needsReview = row.sessions.some(
			(session) =>
				reviewRequestTargetsPerson(session.reviewRequest, me) &&
				!session.reviewRequest?.accepted &&
				!prReviewCompletion(session.reviewRequest!, session),
		);
		if (!approved && needsReview) return "needs-review";

		const askedByMe = row.sessions.some(
			(session) => session.reviewRequest?.by.toLowerCase() === me,
		);
		if (approved && askedByMe) return "approved-review";

		const awaitingReview = row.sessions.some(
			(session) =>
				session.reviewRequest?.by.toLowerCase() === me &&
				!session.reviewRequest.accepted &&
				!prReviewCompletion(session.reviewRequest, session),
		);
		if (!approved && awaitingReview) return "awaiting-review";

		const mineRequest = row.sessions.some((session) => {
			const request = session.reviewRequest;
			return (
				request &&
				(request.by.toLowerCase() === me ||
					reviewRequestTargetsPerson(request, me))
			);
		});
		const reviewCompleted =
			row.sessions.some((session) => session.reviewRequest?.accepted) ||
			approved ||
			row.sessions.some(
				(session) =>
					session.reviewRequest &&
					prReviewCompletion(session.reviewRequest, session),
			);
		if (mineRequest && reviewCompleted) return "completed-review";
	}

	if (
		context.inStatusScope &&
		rowUsesAutoCreatedSection(row, context.personFilter)
	)
		return "auto-created";

	return context.inStatusScope ? "status" : "outside";
}

export function placeSidebarRows<T extends WsRow>(
	rows: readonly T[],
	contextFor: (row: T) => SidebarPlacementContext,
): Array<PlacedSidebarRow<T>> {
	return rows.map((row) => ({
		row,
		placement: classifySidebarPlacement(row, contextFor(row)),
	}));
}

export function rowsAtPlacement<T extends WsRow>(
	rows: readonly PlacedSidebarRow<T>[],
	placement: SidebarPlacement,
): T[] {
	return rows
		.filter((entry) => entry.placement === placement)
		.map((entry) => entry.row);
}
