import SwiftUI

/// Toolbar chip for a session's PR: the number plus one status dot — merged /
/// closed / draft, or the check rollup while open. Tapping it opens PrPanelView.
struct PrChipLabel: View {
    let number: Int
    /// nil while only the sessions-list snapshot is known (details still
    /// loading) — the dot goes neutral rather than guessing a check state.
    let summary: PrDetails.Summary?

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(summary.map { $0.color } ?? Color.secondary)
                .frame(width: 7, height: 7)
            Text(verbatim: "#\(number)")
                .font(.subheadline.weight(.semibold))
                .monospacedDigit()
        }
    }
}

extension PrDetails.Summary {
    var color: Color {
        switch self {
        case .merged: .purple
        case .closed: .red
        case .draft: .gray
        case .failing: .red
        case .pending: .orange
        case .passing: .green
        }
    }

    var label: String {
        switch self {
        case .merged: "Merged"
        case .closed: "Closed"
        case .draft: "Draft"
        case .failing: "Checks failing"
        case .pending: "Checks running"
        case .passing: "Open"
        }
    }
}

/// The PR details sheet: title, state and review badges, branch/line stats,
/// conflict warning, every check with its status, the reviewer list — and,
/// while the PR is open, the same three actions the web panel offers: submit a
/// review, merge, close.
struct PrPanelView: View {
    var viewModel: SessionViewModel
    /// How this is being shown. `.pushed` brings no chrome of its own: the
    /// navigation stack is already there, and the way out is the chevron (or
    /// the edge swipe) rather than a Done button.
    var chrome: Chrome = .sheet
    @Environment(\.dismiss) private var dismiss

    /// The action in flight, if any. One at a time: the section disables while
    /// it runs, so this doubles as "which row shows the spinner". Reviewing has
    /// no entry here — the review sheet owns its own submit state.
    @State private var busy: PrAction?
    /// The server's own sentence when an action failed (a GitHub error, or
    /// "Connect your GitHub account…" when this person hasn't).
    @State private var actionError: String?
    @State private var reviewing = false
    /// Merge method awaiting confirmation — merging is the one action here
    /// that can't be taken back, so it always passes through a dialog.
    @State private var pendingMerge: String?
    @State private var confirmingClose = false

    enum Chrome { case sheet, pushed }

    enum PrAction { case merge, close }

    var body: some View {
        Group {
            switch chrome {
            case .sheet:
                NavigationStack {
                    titled(content)
                        .toolbar {
                            ToolbarItem(placement: .topTrailingCompat) {
                                Button("Done") { dismiss() }
                            }
                        }
                }
            case .pushed:
                titled(content)
            }
        }
        // Checks move fast while CI runs; re-fetch on open (server-cached).
        .task { await viewModel.refreshPr() }
        #if os(macOS)
        .frame(minWidth: 460, minHeight: 540)
        #endif
    }

    private func titled(_ view: some View) -> some View {
        // `Text(verbatim:)`, not a bare interpolation: inferred as a
        // LocalizedStringKey, "PR #\(number)" runs the number through the
        // device's locale — #5555 renders "PR #5.555" anywhere that groups
        // thousands with a dot. Same reason the overflow menu spells its PR
        // row verbatim.
        view
            .navigationTitle(
                Text(verbatim: viewModel.prDetails.map { "PR #\($0.number)" } ?? "Pull request")
            )
            .inlineTitleBarCompat()
    }

    @ViewBuilder
    private var content: some View {
        if let pr = viewModel.prDetails {
            List {
                overviewSection(pr)
                if pr.isOpen {
                    Section {
                        NavigationLink {
                            PrReviewCanvas(viewModel: viewModel)
                        } label: {
                            Label("Files changed", systemImage: "doc.text.magnifyingglass")
                        }
                    }
                }
                actionsSection(pr)
                checksSection(pr)
                reviewersSection(pr)
            }
            .insetGroupedListCompat()
            #if os(iOS)
            .scrollContentBackground(.hidden)
            .background(OS1VisualStyle.background)
            #endif
            .refreshable { await viewModel.refreshPr() }
            .sheet(isPresented: $reviewing) {
                PrReviewSheet(canMerge: pr.isOpen) { event, summary, mergeAfter in
                    try await viewModel.submitPrReview(event: event, summary: summary)
                    if mergeAfter { try await viewModel.mergePr() }
                }
            }
            .confirmationDialog(
                mergeConfirmTitle(pr),
                isPresented: Binding(
                    get: { pendingMerge != nil },
                    set: { if !$0 { pendingMerge = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button(mergeButtonLabel(pendingMerge ?? "squash")) {
                    let method = pendingMerge ?? "squash"
                    pendingMerge = nil
                    run(.merge) { try await viewModel.mergePr(method: method) }
                }
                Button("Cancel", role: .cancel) { pendingMerge = nil }
            } message: {
                Text(mergeConfirmMessage(pr))
            }
            .confirmationDialog(
                "Close this pull request?",
                isPresented: $confirmingClose,
                titleVisibility: .visible
            ) {
                Button("Close pull request", role: .destructive) {
                    run(.close) { try await viewModel.closePr() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("The branch keeps its commits. You can reopen the pull request on GitHub.")
            }
        } else if viewModel.prLoadFailed {
            ContentUnavailableView {
                Label("Couldn't load the pull request", systemImage: "exclamationmark.triangle")
            } description: {
                Text("GitHub may be rate-limited. Try again in a moment.")
            } actions: {
                Button("Retry") { viewModel.loadPr() }
            }
        } else {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func overviewSection(_ pr: PrDetails) -> some View {
        Section {
            VStack(alignment: .leading, spacing: 8) {
                Text(pr.title ?? "Untitled")
                    .font(.headline)
                HStack(spacing: 6) {
                    badge(pr.summary.label, color: pr.summary.color)
                    if let decision = reviewBadge(pr.reviewDecision) {
                        badge(decision.label, color: decision.color)
                    }
                }
                VStack(alignment: .leading, spacing: 3) {
                    if let author = pr.author, !author.isEmpty {
                        metaText("Opened by \(author)")
                    }
                    if let head = pr.headRefName, let base = pr.baseRefName {
                        metaText("\(head) → \(base)")
                    }
                    metaText(
                        "+\(pr.additions ?? 0) −\(pr.deletions ?? 0) in "
                            + "\(pr.changedFiles ?? 0) file\((pr.changedFiles ?? 0) == 1 ? "" : "s")"
                    )
                }
                if pr.mergeable == "CONFLICTING" {
                    Label(
                        "Has conflicts with \(pr.baseRefName ?? "the base branch")",
                        systemImage: "exclamationmark.triangle.fill"
                    )
                    .font(.footnote)
                    .foregroundStyle(.orange)
                }
            }
            .padding(.vertical, 2)
            if let url = pr.url.flatMap(URL.init) {
                Link(destination: url) {
                    Label("Open on GitHub", systemImage: "arrow.up.right")
                }
            }
        }
    }

    /// Review / merge / close, only while the PR is open — a merged or closed
    /// PR has nothing here to do, and GitHub would refuse anyway.
    @ViewBuilder
    private func actionsSection(_ pr: PrDetails) -> some View {
        if pr.isOpen {
            Section {
                Button {
                    actionError = nil
                    reviewing = true
                } label: {
                    actionRow("Review", systemImage: "checkmark.bubble")
                }
                Menu {
                    Button("Squash and merge") { pendingMerge = "squash" }
                    Button("Create a merge commit") { pendingMerge = "merge" }
                    Button("Rebase and merge") { pendingMerge = "rebase" }
                } label: {
                    actionRow("Merge", systemImage: "arrow.triangle.merge", spinning: busy == .merge)
                }
                Button(role: .destructive) {
                    actionError = nil
                    confirmingClose = true
                } label: {
                    actionRow("Close pull request", systemImage: "xmark.circle", destructive: true)
                }
            } header: {
                Text("Actions")
            } footer: {
                if let actionError {
                    Text(actionError)
                        .foregroundStyle(.red)
                }
            }
            .disabled(busy != nil)
        }
    }

    private func actionRow(
        _ title: String,
        systemImage: String,
        spinning: Bool = false,
        destructive: Bool = false
    ) -> some View {
        HStack {
            Label(title, systemImage: systemImage)
                .foregroundStyle(destructive ? Color.red : Color.accentColor)
            Spacer(minLength: 8)
            if spinning {
                ProgressView().controlSize(.small)
            }
        }
    }

    /// Run one action, keeping its failure in the panel: the server answers a
    /// refusal (conflicts, a stack layer still open, no GitHub credential) with
    /// a sentence meant for a person, so show that rather than a status code.
    private func run(_ action: PrAction, _ work: @escaping () async throws -> Void) {
        guard busy == nil else { return }
        busy = action
        actionError = nil
        Task {
            do {
                try await work()
            } catch {
                actionError = (error as? LocalizedError)?.errorDescription
                    ?? error.localizedDescription
            }
            busy = nil
        }
    }

    private func mergeButtonLabel(_ method: String) -> String {
        switch method {
        case "merge": "Create a merge commit"
        case "rebase": "Rebase and merge"
        default: "Squash and merge"
        }
    }

    private func mergeConfirmTitle(_ pr: PrDetails) -> String {
        "Merge PR #\(pr.number)?"
    }

    /// Name what a merge would land on top of. GitHub is the authority — the
    /// server doesn't pre-empt it — so these are warnings, not blocks.
    private func mergeConfirmMessage(_ pr: PrDetails) -> String {
        var warnings: [String] = []
        if pr.mergeable == "CONFLICTING" { warnings.append("it has conflicts") }
        if (pr.checks ?? []).contains(where: { $0.rank == .failure }) {
            warnings.append("checks are failing")
        } else if (pr.checks ?? []).contains(where: { $0.rank == .pending }) {
            warnings.append("checks are still running")
        }
        if pr.isDraft == true { warnings.append("it's still a draft") }
        if pr.reviewDecision == "CHANGES_REQUESTED" {
            warnings.append("changes were requested")
        }
        let base = pr.baseRefName ?? "the base branch"
        guard !warnings.isEmpty else { return "This merges into \(base)." }
        return "This merges into \(base) even though \(warnings.joined(separator: ", "))."
    }

    @ViewBuilder
    private func checksSection(_ pr: PrDetails) -> some View {
        let checks = pr.checks ?? []
        Section(checksHeader(checks)) {
            if checks.isEmpty {
                Text("No checks reported")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(checks.enumerated()), id: \.offset) { _, check in
                    if let url = check.url.flatMap(URL.init) {
                        Link(destination: url) { checkRow(check) }
                            .foregroundStyle(.primary)
                    } else {
                        checkRow(check)
                    }
                }
            }
        }
    }

    private func checksHeader(_ checks: [PrCheck]) -> String {
        guard !checks.isEmpty else { return "Checks" }
        let passed = checks.filter { $0.rank == .success }.count
        return "Checks · \(passed)/\(checks.count) passed"
    }

    private func checkRow(_ check: PrCheck) -> some View {
        HStack(spacing: 10) {
            checkIcon(check.rank)
            VStack(alignment: .leading, spacing: 1) {
                Text(check.name)
                    .font(.subheadline)
                    .lineLimit(1)
                if let workflow = check.workflowName, !workflow.isEmpty {
                    Text(workflow)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 8)
            if let duration = checkDuration(check) {
                Text(duration)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
            }
        }
    }

    @ViewBuilder
    private func checkIcon(_ rank: PrCheck.Rank) -> some View {
        switch rank {
        case .success:
            Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
        case .failure:
            Image(systemName: "xmark.circle.fill").foregroundStyle(.red)
        case .pending:
            Image(systemName: "clock.fill").foregroundStyle(.orange)
        case .neutral:
            Image(systemName: "minus.circle").foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private func reviewersSection(_ pr: PrDetails) -> some View {
        if let reviewers = pr.reviewers, !reviewers.isEmpty {
            Section("Reviewers") {
                ForEach(Array(reviewers.enumerated()), id: \.offset) { _, reviewer in
                    HStack {
                        Text(reviewer.isTeam == true ? "@\(reviewer.login) (team)" : reviewer.login)
                            .font(.subheadline)
                        Spacer()
                        if let state = reviewerBadge(reviewer.state) {
                            Text(state.label)
                                .font(.caption)
                                .foregroundStyle(state.color)
                        }
                    }
                }
            }
        }
    }

    // MARK: - Small pieces

    private func badge(_ text: String, color: Color) -> some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.14), in: Capsule())
            .foregroundStyle(color)
    }

    private func metaText(_ text: String) -> some View {
        Text(text)
            .font(.footnote)
            .foregroundStyle(.secondary)
    }

    private func reviewBadge(_ decision: String?) -> (label: String, color: Color)? {
        switch decision ?? "" {
        case "APPROVED": ("Approved", .green)
        case "CHANGES_REQUESTED": ("Changes requested", .red)
        case "REVIEW_REQUIRED": ("Review required", .orange)
        default: nil
        }
    }

    private func reviewerBadge(_ state: String?) -> (label: String, color: Color)? {
        switch state ?? "" {
        case "APPROVED": ("Approved", .green)
        case "CHANGES_REQUESTED": ("Changes requested", .red)
        case "COMMENTED": ("Commented", .secondary)
        case "DISMISSED": ("Dismissed", .secondary)
        case "PENDING": ("Requested", .orange)
        default: nil
        }
    }

    private func checkDuration(_ check: PrCheck) -> String? {
        guard let started = Session.parseISO(check.startedAt),
              let completed = Session.parseISO(check.completedAt) else { return nil }
        let secs = Int(completed.timeIntervalSince(started).rounded())
        guard secs > 0 else { return nil }
        if secs < 60 { return "\(secs)s" }
        return "\(Int((Double(secs) / 60).rounded()))m"
    }
}

/// Submit a review: the event, an optional summary, and — approving — the web
/// panel's "merge right after" shortcut, which is what a phone review usually
/// wants (approve and land it, without a second trip into the panel).
///
/// A failure keeps the sheet open with the text intact; only a success
/// dismisses, since a review body is real typing to lose.
private struct PrReviewSheet: View {
    /// False once the PR can no longer be merged — hides the shortcut.
    var canMerge: Bool
    var submit: (String, String, Bool) async throws -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var event = "APPROVE"
    @State private var summary = ""
    @State private var mergeAfter = false
    @State private var submitting = false
    @State private var errorText: String?
    @FocusState private var summaryFocused: Bool

    /// GitHub takes a bare approval, but a comment or a change request with no
    /// body is nothing to post — the server refuses it too.
    private var canSubmit: Bool {
        event == "APPROVE"
            || !summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Review", selection: $event) {
                        Text("Approve").tag("APPROVE")
                        Text("Request changes").tag("REQUEST_CHANGES")
                        Text("Comment").tag("COMMENT")
                    }
                    .pickerStyle(.segmented)
                    .labelsHidden()
                }
                Section("Summary") {
                    TextEditor(text: $summary)
                        .frame(minHeight: 120)
                        .focused($summaryFocused)
                        .overlay(alignment: .topLeading) {
                            if summary.isEmpty {
                                Text(event == "APPROVE" ? "Optional" : "Required")
                                    .foregroundStyle(.tertiary)
                                    .padding(.top, 8)
                                    .allowsHitTesting(false)
                            }
                        }
                }
                if canMerge && event == "APPROVE" {
                    Section {
                        Toggle("Squash and merge after approving", isOn: $mergeAfter)
                    }
                }
                if let errorText {
                    Section {
                        Text(errorText).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Review")
            .inlineTitleBarCompat()
            .toolbar {
                ToolbarItem(placement: .topLeadingCompat) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topTrailingCompat) {
                    if submitting {
                        ProgressView().controlSize(.small)
                    } else {
                        Button("Submit") { send() }
                            .disabled(!canSubmit)
                    }
                }
            }
            .disabled(submitting)
        }
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 420)
        #endif
    }

    private func send() {
        guard !submitting else { return }
        // On the tap, not on the result: the sheet dismisses itself the moment
        // the submit returns, and a review that fails says so in words.
        Haptics.play(.send)
        submitting = true
        errorText = nil
        summaryFocused = false
        let payload = (event, summary, mergeAfter && event == "APPROVE" && canMerge)
        Task {
            do {
                try await submit(payload.0, payload.1, payload.2)
                dismiss()
            } catch {
                errorText = (error as? LocalizedError)?.errorDescription
                    ?? error.localizedDescription
            }
            submitting = false
        }
    }
}
