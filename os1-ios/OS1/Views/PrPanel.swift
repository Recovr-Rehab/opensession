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
    @State private var slackShare: PrSlackShareRequest?
    /// Which of the canvas's two pages is showing. Two, not the six tabs this
    /// had before: everything countable about a pull request answers a
    /// question ("is it green?", "what landed?") rather than being a place you
    /// go, so it rolls up on the overview and the code gets a page of its own.
    @State private var page: Page = .overview
    /// Owned here because the tab row draws its control, beside the pages.
    @State private var lens: PrReviewCanvas.Lens = .all
    /// The rollups start closed: the overview is meant to be readable in one
    /// screen, and each of these is a question with a one-line answer.
    @State private var checksExpanded = false
    @State private var commitsExpanded = false
    @State private var filesExpanded = false

    enum Chrome { case sheet, pushed }

    enum PrAction { case merge, close }

    /// Overview is the conversation, the way the web's is: the description
    /// and every comment under each other. What the web keeps in the rail
    /// beside it has a page of its own here, because a phone has no beside.
    enum Page: Hashable, CaseIterable {
        case overview, files, info

        var label: String {
            switch self {
            case .overview: "Overview"
            case .files: "Files"
            case .info: "Info"
            }
        }
    }

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
        .sheet(item: $slackShare) { request in
            PrSlackShareSheet(request: request)
        }
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
            .navigationTitle(Text(verbatim: navigationTitle))
            .inlineTitleBarCompat()
    }

    /// The repo, so the bar and the identity row below it read as one
    /// breadcrumb rather than saying the PR's number twice.
    private var navigationTitle: String {
        viewModel.session.repo ?? "Pull request"
    }

    @ViewBuilder
    private var content: some View {
        if let pr = viewModel.prDetails {
            VStack(spacing: 0) {
                identity(pr)
                pageTabs(pr)
                Divider()
                switch page {
                case .overview: overviewPage(pr)
                case .files: PrReviewCanvas(viewModel: viewModel, lens: $lens)
                case .info: infoPage(pr)
                }
            }
            .toolbar {
                ToolbarItem(placement: .topTrailingCompat) { actionsMenu(pr) }
            }
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

    // MARK: - Identity

    /// One line of identity, edge to edge above the pages: what state it is
    /// in, whose it is, and what it is called. Everything countable belongs to
    /// the overview below, so this never grows a second row of stats.
    private func identity(_ pr: PrDetails) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                statePlate(pr)
                if let author = pr.author, !author.isEmpty {
                    UserAvatar(person: author, size: 20)
                    Text(author)
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(OS1VisualStyle.textDim)
                        .lineLimit(1)
                }
                Spacer(minLength: 4)
                if let preview = pr.staging?.url.flatMap(URL.init) {
                    Link(destination: preview) {
                        Image(systemName: "globe")
                            .font(.system(size: 15))
                            .foregroundStyle(OS1VisualStyle.textDim)
                    }
                    .accessibilityLabel("Open the preview environment")
                }
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(pr.title ?? "Untitled")
                    .font(.headline)
                    .foregroundStyle(OS1VisualStyle.text)
                    .lineLimit(2)
                // The number is the reference the rest of the app uses, and
                // it is the way out to GitHub. The title is the page you are
                // already on, so it stays inert.
                if let url = pr.url.flatMap(URL.init) {
                    Link(destination: url) {
                        Text(verbatim: "#\(pr.number)")
                            .font(.subheadline)
                            .foregroundStyle(OS1VisualStyle.textDim)
                    }
                } else {
                    Text(verbatim: "#\(pr.number)")
                        .font(.subheadline)
                        .foregroundStyle(OS1VisualStyle.textDim)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 10)
    }

    /// The state, filled rather than outlined: the tone washes the plate and
    /// the glyph and the word share its ink.
    private func statePlate(_ pr: PrDetails) -> some View {
        let tone = pr.summary.color
        return HStack(spacing: 4) {
            Image(systemName: stateSymbol(pr))
                .font(.system(size: 11, weight: .semibold))
            Text(stateLabel(pr))
                .font(.caption.weight(.semibold))
        }
        .foregroundStyle(tone)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(tone.opacity(0.14), in: Capsule())
    }

    private func stateSymbol(_ pr: PrDetails) -> String {
        switch pr.state ?? "" {
        case "MERGED": "arrow.triangle.merge"
        case "CLOSED": "xmark"
        default: pr.isDraft == true ? "circle.dashed" : "arrow.triangle.pull"
        }
    }

    private func stateLabel(_ pr: PrDetails) -> String {
        switch pr.state ?? "" {
        case "MERGED": "Merged"
        case "CLOSED": "Closed"
        default: pr.isDraft == true ? "Draft" : "Open"
        }
    }

    // MARK: - The two pages

    /// The pages, and the code page's own controls beside them. A tab is
    /// marked with a line on the edge it shares with the content below, not a
    /// filled plate: a plate there reads as a pressed button.
    private func pageTabs(_ pr: PrDetails) -> some View {
        HStack(spacing: 0) {
            tab(.overview, count: conversation(pr).count)
            tab(.files, count: pr.changedFiles ?? pr.files?.count)
            tab(.info, count: nil)
            Spacer(minLength: 8)
            if page == .files {
                // Icon only: the row belongs to the pages, and the control is
                // a glyph beside them rather than a second label competing
                // with the tab names.
                PrViewOptionsMenu(lens: $lens, showsDiffDisplay: lens != .flow)
                    .labelStyle(.iconOnly)
                    .padding(.trailing, 16)
            }
        }
        .padding(.leading, 8)
    }

    private func tab(_ target: Page, count: Int?) -> some View {
        let selected = page == target
        return Button {
            guard page != target else { return }
            page = target
            Haptics.play(.selection)
        } label: {
            HStack(spacing: 5) {
                Text(target.label)
                    .font(.subheadline.weight(selected ? .semibold : .regular))
                if let count, count > 0 {
                    Text("\(count)")
                        .font(.caption2.weight(.semibold))
                        .monospacedDigit()
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(
                            selected
                                ? Color.accentColor.opacity(0.16)
                                : OS1VisualStyle.border.opacity(0.35),
                            in: Capsule()
                        )
                }
            }
            .foregroundStyle(selected ? Color.accentColor : OS1VisualStyle.textDim)
            .padding(.horizontal, 8)
            .padding(.vertical, 10)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(selected ? Color.accentColor : .clear)
                    .frame(height: 2)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
    }

    /// How the pull request stands: who is on it, what ran, what landed, what
    /// changed. On the web this is the rail beside the conversation; a phone
    /// has no beside, so it is the page you go to for the numbers.
    private func infoPage(_ pr: PrDetails) -> some View {
        List {
            statusSection(pr)
            reviewersSection(pr)
            checksSection(pr)
            commitsSection(pr)
            filesSection(pr)
        }
        .insetGroupedListCompat()
        #if os(iOS)
        .scrollContentBackground(.hidden)
        .background(OS1VisualStyle.background)
        #endif
        .refreshable { await viewModel.refreshPr() }
    }

    @ViewBuilder
    private func statusSection(_ pr: PrDetails) -> some View {
        Section("Status") {
            if let head = pr.headRefName, let base = pr.baseRefName {
                LabeledContent {
                    Text("\(head) → \(base)")
                        .font(.footnote)
                        .foregroundStyle(OS1VisualStyle.textDim)
                        .lineLimit(2)
                        .multilineTextAlignment(.trailing)
                } label: {
                    Label("Branch", systemImage: "arrow.triangle.branch")
                }
            }
            if let decision = reviewBadge(pr.reviewDecision) {
                Label(decision.label, systemImage: "checkmark.bubble")
                    .foregroundStyle(decision.color)
                    .font(.subheadline)
            }
            if pr.mergeable == "CONFLICTING" {
                Label(
                    "Has conflicts with \(pr.baseRefName ?? "the base branch")",
                    systemImage: "exclamationmark.triangle.fill"
                )
                .font(.subheadline)
                .foregroundStyle(OS1VisualStyle.yellowInk)
            }
            if let error = actionError {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(OS1VisualStyle.redInk)
            }
        }
    }

    @ViewBuilder
    private func commitsSection(_ pr: PrDetails) -> some View {
        if let commits = pr.commits, !commits.isEmpty {
            Section {
                DisclosureGroup(isExpanded: $commitsExpanded) {
                ForEach(commits) { commit in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(commit.messageHeadline ?? commit.shortOid)
                                .font(.subheadline)
                                .lineLimit(2)
                            if let author = commit.author, !author.isEmpty {
                                Text(author)
                                    .font(.caption2)
                                    .foregroundStyle(OS1VisualStyle.textDim)
                            }
                        }
                        Spacer(minLength: 8)
                        Text(commit.shortOid)
                            .font(.caption.monospaced())
                            .foregroundStyle(OS1VisualStyle.textDim)
                    }
                }
                } label: {
                    Label(
                        "\(commits.count) commit\(commits.count == 1 ? "" : "s")",
                        systemImage: "point.3.filled.connected.trianglepath.dotted"
                    )
                    .font(.subheadline)
                }
            }
        }
    }

    /// What changed, by size. Tapping one crosses to the code page, where the
    /// same list opens the diff — the overview never loads a patch of its own.
    @ViewBuilder
    private func filesSection(_ pr: PrDetails) -> some View {
        if let files = pr.files, !files.isEmpty {
            Section {
                DisclosureGroup(isExpanded: $filesExpanded) {
                ForEach(files) { file in
                    Button {
                        page = .files
                        Haptics.play(.selection)
                    } label: {
                        HStack(spacing: 8) {
                            Text(file.path)
                                .font(.footnote)
                                .foregroundStyle(OS1VisualStyle.text)
                                .lineLimit(1)
                                .truncationMode(.head)
                            Spacer(minLength: 8)
                            Text("+\(file.additions ?? 0)")
                                .font(.caption2.monospaced())
                                .foregroundStyle(OS1VisualStyle.greenInk)
                            Text("−\(file.deletions ?? 0)")
                                .font(.caption2.monospaced())
                                .foregroundStyle(OS1VisualStyle.redInk)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                } label: {
                    HStack(spacing: 8) {
                        Label(
                            "\(files.count) file\(files.count == 1 ? "" : "s")",
                            systemImage: "doc.on.doc"
                        )
                        .font(.subheadline)
                        Spacer(minLength: 8)
                        Text("+\(pr.additions ?? 0)")
                            .font(.caption2.monospaced())
                            .foregroundStyle(OS1VisualStyle.greenInk)
                        Text("−\(pr.deletions ?? 0)")
                            .font(.caption2.monospaced())
                            .foregroundStyle(OS1VisualStyle.redInk)
                    }
                }
            }
        }
    }

    /// The description, then the discussion. Machine bookkeeping (a comment
    /// that is only a hidden marker, a superseded automated review) is not
    /// discussion, so it never reaches the list.
    private func conversation(_ pr: PrDetails) -> [PrComment] {
        (pr.comments ?? []).filter(\.isDiscussion)
    }

    /// The conversation, and nothing else: the description, then every comment
    /// under it. This is the page the web's Overview is — a feed you read from
    /// the top — rather than a summary of counts, which is what Info holds.
    private func overviewPage(_ pr: PrDetails) -> some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                descriptionCard(pr)
                let comments = conversation(pr)
                if comments.isEmpty {
                    Text("No comments yet.")
                        .font(.footnote)
                        .foregroundStyle(OS1VisualStyle.textDim)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, 24)
                } else {
                    ForEach(Array(comments.enumerated()), id: \.offset) { _, comment in
                        commentCard(comment)
                    }
                }
            }
            .padding(16)
        }
        .background(OS1VisualStyle.background)
        .refreshable { await viewModel.refreshPr() }
    }

    @ViewBuilder
    private func descriptionCard(_ pr: PrDetails) -> some View {
        let body = (pr.body ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        conversationCard(
            author: pr.author,
            subtitle: "Opened this pull request",
            when: nil
        ) {
            if body.isEmpty {
                Text("This pull request has no description.")
                    .font(.footnote)
                    .foregroundStyle(OS1VisualStyle.textDim)
            } else {
                MarkdownBody(body)
            }
        }
    }

    private func commentCard(_ comment: PrComment) -> some View {
        conversationCard(
            author: comment.author,
            subtitle: nil,
            when: Session.parseISO(comment.createdAt)
        ) {
            MarkdownBody(comment.discussionBody)
        }
    }

    /// One card in the feed: who wrote it, when, and what they said.
    private func conversationCard(
        author: String?,
        subtitle: String?,
        when: Date?,
        @ViewBuilder content: () -> some View
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                UserAvatar(person: author ?? "?", size: 24)
                VStack(alignment: .leading, spacing: 1) {
                    Text(author ?? "Unknown")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(OS1VisualStyle.text)
                        .lineLimit(1)
                    if let subtitle {
                        Text(subtitle)
                            .font(.caption2)
                            .foregroundStyle(OS1VisualStyle.textDim)
                    }
                }
                Spacer(minLength: 8)
                if let when {
                    Text(when.formatted(.relative(presentation: .numeric)))
                        .font(.caption2)
                        .foregroundStyle(OS1VisualStyle.textDim)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            Divider()
            content()
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(14)
        }
        .background(
            OS1VisualStyle.raised,
            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
        )
    }

    /// Review, merge, close and the ways out, on one control. The web keeps
    /// the same set behind the header's caret.
    @ViewBuilder
    private func actionsMenu(_ pr: PrDetails) -> some View {
        Menu {
            if pr.isOpen {
                Button {
                    actionError = nil
                    reviewing = true
                } label: {
                    Label("Review", systemImage: "checkmark.bubble")
                }
                Menu {
                    Button("Squash and merge") { pendingMerge = "squash" }
                    Button("Create a merge commit") { pendingMerge = "merge" }
                    Button("Rebase and merge") { pendingMerge = "rebase" }
                } label: {
                    Label("Merge", systemImage: "arrow.triangle.merge")
                }
            }
            if let url = pr.url.flatMap(URL.init) {
                Section {
                    Link(destination: url) {
                        Label("Open on GitHub", systemImage: "arrow.up.right")
                    }
                    Button {
                        copyToPasteboard(url.absoluteString)
                        Haptics.play(.selection)
                    } label: {
                        Label("Copy GitHub link", systemImage: "doc.on.doc")
                    }
                    Button {
                        slackShare = PrSlackShareRequest(
                            title: pr.title ?? "PR #\(pr.number)",
                            url: url,
                            sessionId: viewModel.session.id,
                            repo: viewModel.session.repo,
                            branch: viewModel.session.branch,
                            merged: pr.state == "MERGED",
                            walkthroughSummary: viewModel.session.walkthrough?.summary,
                            suggestedScreenshot: viewModel.session.walkthrough?.shots?
                                .first { $0.after != nil }?.after
                                ?? ShippedChangeMedia.latestScreenshot(in: viewModel.entries)
                        )
                    } label: {
                        Label("Share to Slack", systemImage: "paperplane")
                    }
                }
            }
            if pr.isOpen {
                Section {
                    Button(role: .destructive) {
                        actionError = nil
                        confirmingClose = true
                    } label: {
                        Label("Close pull request", systemImage: "xmark.circle")
                    }
                }
            }
        } label: {
            if busy != nil {
                ProgressView().controlSize(.small)
            } else {
                Label("Pull request actions", systemImage: "ellipsis.circle")
            }
        }
        .disabled(busy != nil)
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

    /// Checks roll up rather than filling the page: they answer "is it
    /// green?", which is one line, and the run-by-run list is what you open
    /// when the answer is no. Fifty rows of CI is not an overview.
    @ViewBuilder
    private func checksSection(_ pr: PrDetails) -> some View {
        let checks = pr.checks ?? []
        if !checks.isEmpty {
            Section {
                DisclosureGroup(isExpanded: $checksExpanded) {
                    ForEach(Array(checks.enumerated()), id: \.offset) { _, check in
                        Group {
                            if let url = check.url.flatMap(URL.init) {
                                Link(destination: url) { checkRow(check) }
                                    .foregroundStyle(.primary)
                            } else {
                                checkRow(check)
                            }
                        }
                        .listRowBackground(checkRowTint(check.rank))
                    }
                } label: {
                    HStack(spacing: 10) {
                        checkIcon(checksRank(checks))
                        Text(checksHeader(checks))
                            .font(.subheadline)
                            .foregroundStyle(OS1VisualStyle.text)
                        Spacer(minLength: 8)
                    }
                }
            }
        }
    }

    private func checksRank(_ checks: [PrCheck]) -> PrCheck.Rank {
        let ranks = checks.map(\.rank)
        if ranks.contains(.failure) { return .failure }
        if ranks.contains(.pending) { return .pending }
        return .success
    }

    private func checksHeader(_ checks: [PrCheck]) -> String {
        guard !checks.isEmpty else { return "Checks" }
        let passed = checks.filter { $0.rank == .success }.count
        if checks.contains(where: { $0.rank == .failure }) {
            let failed = checks.filter { $0.rank == .failure }.count
            return "\(failed) check\(failed == 1 ? "" : "s") failed"
        }
        if checks.contains(where: { $0.rank == .pending }) { return "Checks running" }
        // Not "all \(passed) passed": the rest are skipped or neutral, so a
        // count here would disagree with the list it opens.
        return passed == checks.count ? "All \(passed) checks passed" : "All checks passed"
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

    /// Nil for a check that is fine. See `OS1VisualStyle.checkRowFailure` for
    /// why only the rows that want something are painted.
    private func checkRowTint(_ rank: PrCheck.Rank) -> Color? {
        switch rank {
        case .failure: OS1VisualStyle.checkRowFailure
        case .pending: OS1VisualStyle.checkRowPending
        case .success, .neutral: nil
        }
    }

    @ViewBuilder
    private func checkIcon(_ rank: PrCheck.Rank) -> some View {
        // The app's own status palette, not SwiftUI's stock green/red/orange:
        // the same five colours mean the same five things everywhere else in
        // both apps, and the stock ones render a different hue per platform.
        switch rank {
        case .success:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(OS1VisualStyle.green)
        case .failure:
            Image(systemName: "xmark.circle.fill")
                .foregroundStyle(OS1VisualStyle.red)
        case .pending:
            Image(systemName: "clock.fill")
                .foregroundStyle(OS1VisualStyle.yellow)
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
