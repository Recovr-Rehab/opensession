import Foundation
import Observation
import SwiftUI

/// One explicit Active or Settled choice in the account-level settlement map.
/// The server stores the map by sidebar row key, shared with the web client.
struct WorkspaceSettlementRecord: Codable, Equatable, Sendable {
    enum State: String, Codable, Sendable {
        case active, settled
    }

    let state: State
    let at: String
    let terminalSignature: String?

    init(state: State, at: String, terminalSignature: String? = nil) {
        self.state = state
        self.at = at
        self.terminalSignature = terminalSignature
    }
}

struct WorkspaceLifecycleFacts: Equatable, Sendable {
    let key: String
    let createdAt: Date
    let lastActivity: Date
    let blocked: Bool
    let hasOpenPullRequest: Bool
    let terminalPullRequestSignature: String?
    let terminalPullRequestAt: Date?
}

struct WorkspaceLifecycleState: Equatable, Sendable {
    enum Reason: Equatable, Sendable {
        case explicit, pullRequest, inactive
    }

    let settled: Bool
    let settledAt: Date?
    let reason: Reason?

    static let active = WorkspaceLifecycleState(
        settled: false,
        settledAt: nil,
        reason: nil
    )
}

/// Pure Active/Settled derivation. This mirrors the web sidebar's lifecycle:
/// ordinary activity never changes Active order, settlement is reversible,
/// and automation waits while the workspace still needs attention.
enum WorkspaceLifecycle {
    private struct PullRequestFact {
        var state: String?
        var updatedAt: Date?
    }

    static func facts(for workspace: SidebarWorkspace) -> WorkspaceLifecycleFacts {
        let sessions = workspace.sessions
        let key = SidebarRowKeys.rowKey(for: workspace)
        let createdAt = Session.parseISO(workspace.workspace?.createdAt)
            ?? sessions.compactMap { Session.parseISO($0.createdAt) }.min()
            ?? .distantPast
        let lastActivity = Session.parseISO(workspace.workspace?.draft?.updatedAt)
            ?? sessions.compactMap(\.lastActivityDate).max()
            ?? .distantPast
        let blocked = workspace.isRunning
            || workspace.lane == .needsInput
            || sessions.contains { session in
                session.isRunning == true
                    || session.waitingForInput == true
                    || session.workspacePreparing == true
                    || (session.queuedCount ?? 0) > 0
                    || session.reviewRequest != nil
                    || !(session.prReviewRequested ?? []).isEmpty
            }

        var pullRequests: [String: PullRequestFact] = [:]
        func absorb(
            id: String,
            state: String?,
            updatedAt: String?
        ) {
            let next = PullRequestFact(
                state: state?.uppercased(),
                updatedAt: Session.parseISO(updatedAt)
            )
            guard let current = pullRequests[id] else {
                pullRequests[id] = next
                return
            }
            if current.state == nil && next.state != nil
                || (next.updatedAt ?? .distantPast) >= (current.updatedAt ?? .distantPast) {
                pullRequests[id] = next
            }
        }

        for session in sessions {
            if session.prNumber != nil || session.prUrl?.isEmpty == false {
                let id = session.prUrl?.isEmpty == false
                    ? session.prUrl!
                    : "\(session.effectiveRepo)#\(session.prNumber!)"
                absorb(id: id, state: session.prState, updatedAt: session.prUpdatedAt)
            }
            for pullRequest in session.prs ?? [] {
                guard pullRequest.number != nil || pullRequest.url?.isEmpty == false else {
                    continue
                }
                let id = pullRequest.url?.isEmpty == false
                    ? pullRequest.url!
                    : "\(pullRequest.repo)#\(pullRequest.number!)"
                absorb(
                    id: id,
                    state: pullRequest.state,
                    updatedAt: pullRequest.updatedAt
                )
            }
        }

        let ordered = pullRequests.sorted { $0.key < $1.key }
        let hasOpen = ordered.contains { $0.value.state == "OPEN" }
        let allTerminal = !ordered.isEmpty && ordered.allSatisfy {
            $0.value.state == "MERGED" || $0.value.state == "CLOSED"
        }
        let signature = allTerminal
            ? ordered.map { "\($0.key):\($0.value.state!)" }.joined(separator: "|")
            : nil
        let terminalAt = allTerminal
            ? ordered.compactMap { $0.value.updatedAt }.max()
            : nil

        return WorkspaceLifecycleFacts(
            key: key,
            createdAt: createdAt,
            lastActivity: lastActivity,
            blocked: blocked,
            hasOpenPullRequest: hasOpen,
            terminalPullRequestSignature: signature,
            terminalPullRequestAt: terminalAt
        )
    }

    static func state(
        facts: WorkspaceLifecycleFacts,
        record: WorkspaceSettlementRecord?,
        now: Date = Date(),
        autoSettleDays: Int?,
        autoSettlePullRequests: Bool,
        pinned: Bool = false,
        snoozed: Bool = false
    ) -> WorkspaceLifecycleState {
        if facts.blocked || pinned || snoozed { return .active }

        let recordAt = Session.parseISO(record?.at) ?? .distantPast
        if record?.state == .settled, recordAt >= facts.lastActivity {
            return WorkspaceLifecycleState(
                settled: true,
                settledAt: recordAt,
                reason: .explicit
            )
        }

        let terminalSuppressed = facts.terminalPullRequestSignature != nil
            && facts.terminalPullRequestSignature == record?.terminalSignature
        if autoSettlePullRequests,
           !terminalSuppressed,
           facts.terminalPullRequestSignature != nil,
           let terminalAt = facts.terminalPullRequestAt,
           terminalAt >= facts.lastActivity {
            return WorkspaceLifecycleState(
                settled: true,
                settledAt: terminalAt,
                reason: .pullRequest
            )
        }

        guard !facts.hasOpenPullRequest, let autoSettleDays else { return .active }
        let activeOverrideAt = record?.state == .active ? recordAt : .distantPast
        let anchor = max(facts.lastActivity, activeOverrideAt)
        let threshold = anchor.addingTimeInterval(TimeInterval(autoSettleDays * 86_400))
        guard threshold < now else { return .active }
        return WorkspaceLifecycleState(
            settled: true,
            settledAt: threshold,
            reason: .inactive
        )
    }

    static func sortActive(
        _ workspaces: [SidebarWorkspace],
        facts: [String: WorkspaceLifecycleFacts]
    ) -> [SidebarWorkspace] {
        workspaces.sorted { left, right in
            let leftFacts = facts[SidebarRowKeys.rowKey(for: left)]
            let rightFacts = facts[SidebarRowKeys.rowKey(for: right)]
            let leftDate = leftFacts?.createdAt ?? .distantPast
            let rightDate = rightFacts?.createdAt ?? .distantPast
            return leftDate == rightDate ? left.id < right.id : leftDate > rightDate
        }
    }

    static func sortSettled(
        _ workspaces: [SidebarWorkspace],
        facts: [String: WorkspaceLifecycleFacts],
        states: [String: WorkspaceLifecycleState]
    ) -> [SidebarWorkspace] {
        workspaces.sorted { left, right in
            let leftKey = SidebarRowKeys.rowKey(for: left)
            let rightKey = SidebarRowKeys.rowKey(for: right)
            let leftSettled = states[leftKey]?.settledAt ?? .distantPast
            let rightSettled = states[rightKey]?.settledAt ?? .distantPast
            if leftSettled != rightSettled { return leftSettled > rightSettled }
            let leftCreated = facts[leftKey]?.createdAt ?? .distantPast
            let rightCreated = facts[rightKey]?.createdAt ?? .distantPast
            return leftCreated == rightCreated ? left.id < right.id : leftCreated > rightCreated
        }
    }
}

/// Account-level lifecycle state plus the native cache of the two automatic
/// settlement preferences and the read-only snooze guard.
@Observable
@MainActor
final class WorkspaceSettlementStore {
    static let shared = WorkspaceSettlementStore()

    private(set) var records: [String: WorkspaceSettlementRecord] = [:]
    private(set) var snoozes: [String: String] = [:]
    private(set) var autoSettleDays: Int?
    private(set) var autoSettlePullRequests: Bool

    private var context: NativePreferences.Context?
    private var mutationRevision = 0

    private static let daysKey = "os1.sidebar.autoSettleDays"
    private static let pullRequestsKey = "os1.sidebar.autoSettlePullRequests"

    private init() {
        let defaults = UserDefaults.standard
        autoSettleDays = Self.decodeDays(defaults.string(forKey: Self.daysKey))
        autoSettlePullRequests = defaults.object(forKey: Self.pullRequestsKey) as? Bool ?? true
    }

    func hydrate() async {
        let requestContext = NativePreferences.context()
        resetIfNeeded(requestContext)
        let revision = mutationRevision
        async let loadedRecords: [String: WorkspaceSettlementRecord]? = try? SettingsAPI.settlements(
            user: requestContext.user
        )
        async let loadedSnoozes: [String: String]? = try? SettingsAPI.snoozes(
            user: requestContext.user
        )
        async let loadedPreferences: [String: String]? = try? SettingsAPI.uiPrefs(
            user: requestContext.user
        )
        let result = await (loadedRecords, loadedSnoozes, loadedPreferences)
        guard NativePreferences.context() == requestContext,
              mutationRevision == revision else { return }
        if let loaded = result.0 { records = loaded }
        if let loaded = result.1 { snoozes = loaded }
        if let loaded = result.2 { applyPreferences(loaded) }
    }

    func record(for workspace: SidebarWorkspace) -> WorkspaceSettlementRecord? {
        records[SidebarRowKeys.rowKey(for: workspace)]
    }

    func isSnoozed(_ workspace: SidebarWorkspace, now: Date = Date()) -> Bool {
        let keys = [SidebarRowKeys.rowKey(for: workspace)] + workspace.sessions.map(\.id)
        return keys.contains { key in
            guard let until = Session.parseISO(snoozes[key]) else { return false }
            return until > now
        }
    }

    func set(
        _ workspace: SidebarWorkspace,
        settled: Bool,
        terminalSignature: String?
    ) {
        let requestContext = NativePreferences.context()
        resetIfNeeded(requestContext)
        let key = SidebarRowKeys.rowKey(for: workspace)
        guard SidebarRowKeys.isPersistable(key) else { return }
        records[key] = WorkspaceSettlementRecord(
            state: settled ? .settled : .active,
            at: Self.timestamp(),
            terminalSignature: settled ? nil : terminalSignature
        )
        mutationRevision += 1
        let revision = mutationRevision
        let snapshot = records
        Task { [weak self] in
            guard let saved = try? await SettingsAPI.saveSettlements(
                user: requestContext.user,
                settlements: snapshot
            ), let self,
               NativePreferences.context() == requestContext,
               self.mutationRevision == revision
            else { return }
            self.records = saved
        }
    }

    func setAutoSettleDays(_ days: Int?) {
        guard days == nil || [1, 3, 7, 14, 30].contains(days!) else { return }
        resetIfNeeded(NativePreferences.context())
        autoSettleDays = days
        UserDefaults.standard.set(days.map(String.init) ?? "off", forKey: Self.daysKey)
        savePreference("auto-settle-days", value: days.map(String.init) ?? "off")
    }

    func setAutoSettlePullRequests(_ enabled: Bool) {
        resetIfNeeded(NativePreferences.context())
        autoSettlePullRequests = enabled
        UserDefaults.standard.set(enabled, forKey: Self.pullRequestsKey)
        savePreference("auto-settle-prs", value: enabled ? "on" : "off")
    }

    private func savePreference(_ key: String, value: String) {
        mutationRevision += 1
        let revision = mutationRevision
        let requestContext = NativePreferences.context()
        Task { [weak self] in
            guard (try? await SettingsAPI.updateUiPrefs(
                user: requestContext.user,
                prefs: [key: value]
            )) != nil,
            let self,
            NativePreferences.context() == requestContext,
            self.mutationRevision == revision
            else { return }
        }
    }

    private func resetIfNeeded(_ next: NativePreferences.Context) {
        guard let context else {
            self.context = next
            return
        }
        guard context != next else { return }
        self.context = next
        records = [:]
        snoozes = [:]
        autoSettleDays = 3
        autoSettlePullRequests = true
        mutationRevision += 1
    }

    private func applyPreferences(_ prefs: [String: String]) {
        autoSettleDays = Self.decodeDays(prefs["auto-settle-days"])
        autoSettlePullRequests = prefs["auto-settle-prs"] != "off"
        let defaults = UserDefaults.standard
        defaults.set(autoSettleDays.map(String.init) ?? "off", forKey: Self.daysKey)
        defaults.set(autoSettlePullRequests, forKey: Self.pullRequestsKey)
    }

    private static func decodeDays(_ raw: String?) -> Int? {
        if raw == "off" { return nil }
        guard let raw, let days = Int(raw), (1...90).contains(days) else { return 3 }
        return days
    }

    private static func timestamp() -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: Date())
    }
}

/// The native settings rows for the same two account preferences the web
/// Preferences panel exposes.
struct WorkspaceSettlementSettingsSection: View {
    @State private var store = WorkspaceSettlementStore.shared

    var body: some View {
        Section {
            Picker("Settle inactive work", selection: Binding(
                get: { store.autoSettleDays ?? 0 },
                set: { store.setAutoSettleDays($0 == 0 ? nil : $0) }
            )) {
                Text("Off").tag(0)
                Text("After 1 day").tag(1)
                Text("After 3 days").tag(3)
                Text("After 7 days").tag(7)
                Text("After 14 days").tag(14)
                Text("After 30 days").tag(30)
            }
            Toggle("Settle finished pull requests", isOn: Binding(
                get: { store.autoSettlePullRequests },
                set: store.setAutoSettlePullRequests
            ))
        } header: {
            Text("Session list")
        } footer: {
            Text("Settled work stays in the sidebar and returns to Active when new work arrives.")
        }
        .task { await store.hydrate() }
    }
}
