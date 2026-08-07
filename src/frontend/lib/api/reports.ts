import { BASE, request } from "./request";
import type {
	ReportGroup,
	ReportMeta,
	AnalyticsSummary,
} from "../types";

export async function fetchReportGroups(): Promise<ReportGroup[]> {
	const result = await request<{ groups: ReportGroup[] }>("/reports", {
		label: "Failed to load reports",
	});
	return result.groups;
}

export async function fetchReports(automationId: string): Promise<ReportMeta[]> {
	const result = await request<{ reports: ReportMeta[] }>(
		`/reports/${encodeURIComponent(automationId)}`,
		{ label: "Failed to load report history" },
	);
	return result.reports;
}

export async function fetchSessionReports(
	sessionId: string,
): Promise<ReportMeta[]> {
	const result = await request<{ reports: ReportMeta[] }>(
		`/reports/session/${encodeURIComponent(sessionId)}`,
		{ label: "Failed to load session reports" },
	);
	return result.reports;
}

export function reportRawUrl(automationId: string, reportId: string): string {
	return `${BASE}/reports/${encodeURIComponent(automationId)}/${encodeURIComponent(reportId)}/raw`;
}

export async function fetchAnalytics(
	from: string,
	to: string,
): Promise<AnalyticsSummary> {
	return request<AnalyticsSummary>(
		`/analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
		{ label: "Failed to load analytics" },
	);
}

/** Today/last-7-days aggregates for the Home overview strip. */
export interface HomeStatsBucket {
	sessions: number;
	turns: number;
	errors: number;
	durationMs: number;
	inputTokens: number;
	outputTokens: number;
	cacheReadTokens: number;
	cacheWriteTokens: number;
}

export interface HomeStats {
	today: HomeStatsBucket;
	week: HomeStatsBucket;
}

export async function fetchHomeStats(): Promise<HomeStats> {
	return request<HomeStats>("/analytics/home", {
		label: "Failed to load home stats",
	});
}
