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
