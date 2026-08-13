import SwiftUI

#if os(iOS)
/// Native counterpart of mobile web's title-opened workspace info page.
struct WorktreeInfoView: View {
    @Bindable var viewModel: SessionViewModel
    let sessions: [Session]
    let catalog: ModelCatalog?

    @Environment(\.dismiss) private var dismiss
    /// A detail of this session opened one level deeper INSIDE this sheet —
    /// its assets, one of those files, its pull request. Pushed on the sheet's
    /// own stack rather than the session's: this page is where you are, so
    /// the chevron comes back here and the sheet never has to be dismissed.
    @State private var panel: SessionPanel?
    @State private var gitStatus: OS1API.GitStatus?
    @State private var diff: OS1API.SessionDiff?
    @State private var assets: [OS1API.SessionAsset] = []
    @State private var overview: OS1API.WorkspaceOverview?
    @State private var sandboxStatus: SessionSandboxStatus?
    @State private var sandboxLoading = false
    @State private var sandboxAction: SessionSandboxAction?
    @State private var sandboxError: String?
    @State private var confirmingSandboxRecreate = false
    @State private var loading = true
    @State private var loadFailed = false

    var body: some View {
        NavigationStack {
            ScrollView {
                // Ordered by what the sheet is opened to find out: what this
                // workspace is doing and what came out of it. The worktree's
                // own metadata — branch, path, mode — changes once and is
                // reference material, so it sits below the answer rather than
                // filling the first screen with it.
                LazyVStack(alignment: .leading, spacing: 22) {
                    hero
                    overviewSection
                    pullRequestSection
                    workSection
                    assetsSection
                    worktreeSection
                    sandboxSection
                    runnerSection
                    runSettingsSection
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 28)
            }
            .background(OS1VisualStyle.background)
            .navigationTitle("Workspace")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .task(id: loadIdentity) { await load() }
            .refreshable { await load() }
            .onChange(of: viewModel.isRunning) { wasRunning, isRunning in
                if wasRunning && !isRunning {
                    Task { await loadGitDetails() }
                }
            }
            .navigationDestination(item: $panel) { panel in
                SessionPanelView(panel: panel, viewModel: viewModel)
            }
            .confirmationDialog(
                "Recreate this sandbox?",
                isPresented: $confirmingSandboxRecreate,
                titleVisibility: .visible
            ) {
                Button("Recreate sandbox", role: .destructive) {
                    Task { await performSandboxAction(.recreate) }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Unpushed files that exist only inside this sandbox will be deleted.")
            }
            .alert(
                "Couldn't update sandbox",
                isPresented: Binding(
                    get: { sandboxError != nil },
                    set: { if !$0 { sandboxError = nil } }
                )
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(sandboxError ?? "Please try again.")
            }
        }
    }

    private var hero: some View {
        VStack(spacing: 9) {
            RepoTile(name: currentSession.effectiveRepo, size: 52, round: true)
            Text(currentSession.displayTitle)
                .font(.title2.weight(.bold))
                .multilineTextAlignment(.center)
            Text(heroSubtitle)
                .font(.subheadline)
                .foregroundStyle(OS1VisualStyle.textDim)
                .multilineTextAlignment(.center)
            if let stateLabel {
                HStack(spacing: 5) {
                    Label(stateLabel.text, systemImage: stateLabel.icon)
                    // The state alone can't say whether this started a minute
                    // ago or has been going for an hour, which is the whole
                    // question when you open the sheet on a running workspace.
                    if viewModel.isRunning, let since = viewModel.runStartedAt {
                        Text("·").foregroundStyle(stateLabel.color.opacity(0.6))
                        RunElapsedLabel(since: since)
                    }
                }
                .font(.caption.weight(.semibold))
                .foregroundStyle(stateLabel.color)
                .padding(.horizontal, 10)
                .padding(.vertical, 5)
                .background(stateLabel.color.opacity(0.12), in: Capsule())
            }
            if let heroFooter {
                Text(heroFooter)
                    .font(.caption)
                    .foregroundStyle(OS1VisualStyle.textFaint)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 18)
    }

    /// The line under the state: how long ago this stopped, what is queued
    /// behind it, how many sessions share the worktree. Written as wrapping
    /// text rather than a row of pills on purpose — pills are intrinsically
    /// sized, and at accessibility type a row of them is wider than the
    /// scroll view, which centres the overflow and clips every sibling.
    private var heroFooter: String? {
        var parts: [String] = []
        if !viewModel.isRunning, let last = latestActivity {
            parts.append("Updated \(Self.ago(Date().timeIntervalSince(last)))")
        }
        let queued = max(viewModel.queuedCount, currentSession.queuedCount ?? 0)
        if queued > 0 { parts.append("\(queued) queued") }
        if sessions.count > 1 { parts.append("\(sessions.count) sessions") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private var latestActivity: Date? {
        (sessions.isEmpty ? [currentSession] : sessions)
            .compactMap(\.lastActivityDate)
            .max()
    }

    private static func ago(_ elapsed: TimeInterval) -> String {
        let total = max(0, Int(elapsed))
        if total < 60 { return "just now" }
        if total < 3_600 { return "\(total / 60)m ago" }
        if total < 86_400 { return "\(total / 3_600)h ago" }
        return "\(total / 86_400)d ago"
    }

    private var worktreeSection: some View {
        // No Repository row: the hero already reads "<repo> · <model>", and a
        // card that repeats the line above it is what pushed the worktree's
        // own details off the screen.
        InfoSection(title: "Worktree") {
            if let branch = gitStatus?.branch ?? currentSession.branch, !branch.isEmpty {
                InfoRow(label: "Branch", value: branch, icon: "arrow.triangle.branch")
            }
            if let path = currentSession.worktreeDir, !path.isEmpty {
                InfoRow(label: "Path", value: path, icon: "folder", monospaced: true)
            }
            InfoRow(
                label: "Mode",
                value: (currentSession.mode ?? "ask").capitalized,
                icon: "terminal"
            )
            if let startedBy = oldestSession?.startedBy, !startedBy.isEmpty {
                InfoRow(label: "Started by", value: startedBy, icon: "person")
            }
            ForEach(currentSession.attachedRepos ?? []) { repo in
                InfoRow(
                    label: "Attached",
                    value: "\(RepoTile.label(for: repo.repo)) · \(repo.branch)",
                    icon: "link"
                )
            }
        }
    }

    /// Remote sandboxes are separate compute workspaces; local sandboxes are
    /// the host worktree and add no useful lifecycle control here.
    @ViewBuilder
    private var sandboxSection: some View {
        if let sandbox = remoteSandbox {
            InfoSection(title: "Sandbox") {
                if sandboxLoading && sandboxStatus == nil {
                    HStack(spacing: 9) {
                        ProgressView().controlSize(.small)
                        Text("Checking sandbox…")
                            .font(.subheadline)
                            .foregroundStyle(OS1VisualStyle.textDim)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                } else {
                    InfoRow(
                        label: "Status",
                        value: sandboxStateLabel,
                        icon: sandboxStateIcon
                    )
                    Divider()
                    InfoRow(label: "Provider", value: sandboxStatus?.provider ?? sandbox.provider, icon: "shippingbox")
                    if let workspace = sandboxStatus?.workspace ?? sandbox.workspace,
                       !workspace.isEmpty {
                        Divider()
                        InfoRow(label: "Workspace", value: workspace.capitalized, icon: "externaldrive")
                    }
                    if let cwd = sandboxStatus?.cwd, !cwd.isEmpty {
                        Divider()
                        InfoRow(label: "Path", value: cwd, icon: "folder", monospaced: true)
                    }
                    if sandboxState == "awake", sandboxStatus?.canPause == true {
                        Divider()
                        sandboxActionButton(.pause, title: "Pause compute", icon: "pause.circle")
                    }
                    if sandboxState == "sleeping" || sandboxState == "needs_attention", sandboxStatus?.canResume == true {
                        Divider()
                        sandboxActionButton(.resume, title: "Wake sandbox", icon: "play.circle")
                    }
                    if canRecreateSandbox {
                        Divider()
                        Button {
                            confirmingSandboxRecreate = true
                        } label: {
                            HStack(spacing: 10) {
                                if sandboxAction == .recreate {
                                    ProgressView().controlSize(.small)
                                } else {
                                    Image(systemName: "arrow.clockwise")
                                }
                                Text(sandboxAction == .recreate ? "Recreating sandbox…" : "Recreate from clean image")
                                Spacer()
                            }
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(OS1VisualStyle.redInk)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 48)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(sandboxAction != nil || sandboxStatus?.busy == true)
                    }
                    if sandboxError != nil {
                        Divider()
                        Button("Retry") { Task { await reloadSandbox() } }
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(OS1VisualStyle.link)
                            .padding(.horizontal, 12)
                            .frame(minHeight: 44)
                            .disabled(sandboxLoading || sandboxAction != nil)
                    }
                    if let error = sandboxStatus?.lastLifecycleError
                        ?? currentSession.sandbox?.lastLifecycleError,
                       !error.isEmpty {
                        Divider()
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(OS1VisualStyle.redInk)
                            .padding(12)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var runnerSection: some View {
        if let runner = currentSession.runner {
            InfoSection(title: "Runner") {
                InfoRow(label: "Machine", value: runner.name, icon: "desktopcomputer")
                Divider()
                InfoRow(
                    label: "Status",
                    value: RunnerStatus(lifecycle: runner.lifecycle).label,
                    icon: RunnerStatus(lifecycle: runner.lifecycle).icon
                )
                Divider()
                InfoRow(label: "Workspace", value: runner.workspacePath, icon: "folder", monospaced: true)
                if let error = runner.lastLifecycleError, !error.isEmpty {
                    Divider()
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(OS1VisualStyle.redInk)
                        .padding(12)
                }
            }
        }
    }

    /// Git state and the diff in one card. They answer the same question —
    /// what this workspace did to the tree — and on most workspaces each is a
    /// line or two, so two titled cards for them cost a third of the first
    /// screen and pushed the PR and the overview below the fold.
    @ViewBuilder
    private var workSection: some View {
        let files = diff?.files ?? []
        InfoSection(
            title: files.isEmpty
                ? "Git status"
                : "\(files.count) file\(files.count == 1 ? "" : "s") changed",
            trailing: files.isEmpty ? nil : diff.map { AnyView(diffTotals($0)) }
        ) {
            gitStatusRow
            changedFileRows(files)
        }
    }

    @ViewBuilder
    private var gitStatusRow: some View {
        if loading && gitStatus == nil {
            HStack(spacing: 9) {
                ProgressView().controlSize(.small)
                Text("Checking worktree…")
                    .font(.subheadline)
                    .foregroundStyle(OS1VisualStyle.textDim)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
        } else if let gitStatus {
            FlowLayout(spacing: 7) {
                    if gitStatus.uncommittedFiles > 0 {
                        StatusPill(
                            text: "\(gitStatus.uncommittedFiles) uncommitted",
                            icon: "pencil",
                            color: OS1VisualStyle.yellow
                        )
                    }
                    if gitStatus.ahead > 0 {
                        StatusPill(
                            text: "\(gitStatus.ahead) ahead",
                            icon: "arrow.up",
                            color: OS1VisualStyle.blue
                        )
                    }
                    if gitStatus.behind > 0 {
                        StatusPill(
                            text: "\(gitStatus.behind) behind upstream",
                            icon: "arrow.down",
                            color: OS1VisualStyle.yellow
                        )
                    } else if gitStatus.behindBase > 0,
                              currentSession.prState != "MERGED" {
                        StatusPill(
                            text: "\(gitStatus.behindBase) behind \(gitStatus.baseBranch)",
                            icon: "arrow.down",
                            color: OS1VisualStyle.yellow
                        )
                    }
                    if gitStatus.uncommittedFiles == 0,
                       gitStatus.ahead == 0,
                       gitStatus.behind == 0,
                       (gitStatus.behindBase == 0 || currentSession.prState == "MERGED") {
                        StatusPill(
                            text: "Up to date",
                            icon: "checkmark",
                            color: OS1VisualStyle.green
                        )
                    }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
        }
    }

    @ViewBuilder
    private func changedFileRows(_ files: [OS1API.DiffFile]) -> some View {
        if !files.isEmpty {
            let shown = Array(files.prefix(8))
            Divider()
                ForEach(shown) { file in
                    Button {
                        panel = .changes(
                            sessionId: currentSession.id,
                            path: file.path
                        )
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: DiffFileStyle.icon(file.status))
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(DiffFileStyle.color(file.status))
                                .frame(width: 20)
                            Text(file.path)
                                .font(.footnote.monospaced())
                                .foregroundStyle(OS1VisualStyle.text)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Spacer(minLength: 8)
                            if file.additions > 0 {
                                Text(verbatim: "+\(file.additions)")
                                    .foregroundStyle(OS1VisualStyle.greenInk)
                            }
                            if file.deletions > 0 {
                                Text(verbatim: "−\(file.deletions)")
                                    .foregroundStyle(OS1VisualStyle.redInk)
                            }
                            Image(systemName: "chevron.right")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(OS1VisualStyle.textDim)
                        }
                        .font(.caption.monospacedDigit())
                        .padding(.horizontal, 12)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if file.id != shown.last?.id { Divider() }
                }
                Divider()
                Button {
                    panel = .changes(sessionId: currentSession.id)
                } label: {
                    HStack(spacing: 6) {
                        Text(
                            files.count > shown.count
                                ? "Show all \(files.count) files"
                                : "Open changes"
                        )
                        Image(systemName: "chevron.right")
                            .font(.caption2.weight(.semibold))
                    }
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(OS1VisualStyle.accentInk)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
        }
    }

    /// The session's scratch artifacts. Only ever shown when there are some —
    /// most sessions write none, and an empty section would be noise on every
    /// workspace page.
    @ViewBuilder
    private var assetsSection: some View {
        if !assets.isEmpty {
            InfoSection(title: "\(assets.count) asset\(assets.count == 1 ? "" : "s")") {
                let shown = Array(assets.prefix(8))
                ForEach(shown) { asset in
                    Button {
                        panel = .asset(sessionId: currentSession.id, path: asset.path)
                    } label: {
                        HStack(spacing: 10) {
                            Image(systemName: AssetKind.of(asset).symbol)
                                .symbolRenderingMode(.hierarchical)
                                .font(.system(size: 13))
                                .foregroundStyle(OS1VisualStyle.textDim)
                                .frame(width: 20)
                            Text(asset.path)
                                .font(.footnote.monospaced())
                                .foregroundStyle(OS1VisualStyle.text)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Spacer(minLength: 8)
                            Text(ByteCountFormatter.string(
                                fromByteCount: Int64(asset.size),
                                countStyle: .file
                            ))
                            .font(.caption.monospacedDigit())
                            .foregroundStyle(OS1VisualStyle.textDim)
                            Image(systemName: "chevron.right")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(OS1VisualStyle.textFaint)
                        }
                        .padding(.horizontal, 12)
                        .frame(minHeight: 44)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if asset.id != shown.last?.id { Divider() }
                }
                if assets.count > shown.count {
                    Text("\(assets.count - shown.count) more in the Assets tab.")
                        .font(.caption)
                        .foregroundStyle(OS1VisualStyle.textDim)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                }
            }
        }
    }

    @ViewBuilder
    private var pullRequestSection: some View {
        if let number = viewModel.prDetails?.number ?? currentSession.prNumber {
            InfoSection(
                title: "Pull request",
                trailing: viewModel.prDetails.map { AnyView(prNumberLabel(number, summary: $0.summary)) }
            ) {
                Button {
                    panel = .review(sessionId: currentSession.id)
                } label: {
                    if let pr = viewModel.prDetails {
                        prSummary(pr)
                    } else {
                        prLoadingSummary(number)
                    }
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func prNumberLabel(_ number: Int, summary: PrDetails.Summary) -> some View {
        HStack(spacing: 5) {
            Circle()
                .fill(summary.color)
                .frame(width: 7, height: 7)
            Text(verbatim: "#\(number)")
                .font(.caption.weight(.semibold))
                .monospacedDigit()
        }
        .foregroundStyle(OS1VisualStyle.textDim)
    }

    private func prSummary(_ pr: PrDetails) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 11) {
                Image(systemName: pr.state == "MERGED" ? "arrow.triangle.merge" : "arrow.triangle.pull")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(pr.summary.color)
                    .frame(width: 34, height: 34)
                    .background(pr.summary.color.opacity(0.14), in: Circle())
                VStack(alignment: .leading, spacing: 4) {
                    Text(pr.title ?? "Pull request")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(OS1VisualStyle.text)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                    if let head = pr.headRefName, let base = pr.baseRefName {
                        Text("\(head) → \(base)")
                            .font(.caption.monospaced())
                            .foregroundStyle(OS1VisualStyle.textDim)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(OS1VisualStyle.textFaint)
                    .padding(.top, 10)
            }

            FlowLayout(spacing: 7) {
                StatusPill(text: pr.summary.label, icon: prSummaryIcon(pr.summary), color: pr.summary.color)
                if let review = prReviewStatus(pr.reviewDecision) {
                    StatusPill(text: review.text, icon: review.icon, color: review.color)
                }
                if pr.mergeable == "CONFLICTING" {
                    StatusPill(text: "Merge conflict", icon: "exclamationmark.triangle.fill", color: OS1VisualStyle.red)
                }
            }

            HStack(spacing: 14) {
                Label(
                    "+\(pr.additions ?? 0)",
                    systemImage: "plus"
                )
                .foregroundStyle(OS1VisualStyle.greenInk)
                Label(
                    "−\(pr.deletions ?? 0)",
                    systemImage: "minus"
                )
                .foregroundStyle(OS1VisualStyle.redInk)
                Label(
                    "\(pr.changedFiles ?? 0) file\((pr.changedFiles ?? 0) == 1 ? "" : "s")",
                    systemImage: "doc.on.doc"
                )
                .foregroundStyle(OS1VisualStyle.textDim)
            }
            .font(.caption.weight(.medium).monospacedDigit())
        }
        .padding(12)
        .contentShape(Rectangle())
    }

    private func prLoadingSummary(_ number: Int) -> some View {
        HStack(spacing: 11) {
            ProgressView().controlSize(.small)
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: "Pull request #\(number)")
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(OS1VisualStyle.text)
                Text("Loading status and checks…")
                    .font(.caption)
                    .foregroundStyle(OS1VisualStyle.textDim)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(OS1VisualStyle.textFaint)
        }
        .padding(12)
        .frame(minHeight: 58)
        .contentShape(Rectangle())
    }

    private func prSummaryIcon(_ summary: PrDetails.Summary) -> String {
        switch summary {
        case .merged: "arrow.triangle.merge"
        case .closed, .failing: "xmark.circle.fill"
        case .draft: "pencil.circle.fill"
        case .pending: "clock.fill"
        case .passing: "checkmark.circle.fill"
        }
    }

    private func prReviewStatus(_ decision: String?) -> (text: String, icon: String, color: Color)? {
        switch decision ?? "" {
        case "APPROVED": ("Approved", "checkmark.seal.fill", OS1VisualStyle.green)
        case "CHANGES_REQUESTED": ("Changes requested", "exclamationmark.bubble.fill", OS1VisualStyle.red)
        case "REVIEW_REQUIRED": ("Review required", "eye.fill", OS1VisualStyle.yellow)
        default: nil
        }
    }

    @ViewBuilder
    private var overviewSection: some View {
        if let overview, overview.prompt != nil || overview.lastMessage != nil {
            // Latest first: on a workspace you already know the shape of, what
            // it just said is the news, and the original ask is the thing you
            // scroll back to.
            InfoSection(title: "Overview") {
                if let lastMessage = overview.lastMessage {
                    SummaryBlock(label: "Latest update", content: lastMessage.content)
                }
                if let prompt = overview.prompt {
                    if overview.lastMessage != nil { Divider() }
                    SummaryBlock(label: "Started with", content: prompt.content, lines: 4)
                }
            }
        } else if loading {
            // The overview is the slowest thing on the sheet (it reads every
            // session's transcript) and now the topmost, so it holds its place
            // instead of shoving the whole page down when it lands.
            InfoSection(title: "Overview") {
                HStack(spacing: 9) {
                    ProgressView().controlSize(.small)
                    Text("Reading the transcript…")
                        .font(.subheadline)
                        .foregroundStyle(OS1VisualStyle.textDim)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
            }
        } else if loadFailed {
            InfoSection(title: "Overview") {
                Text("Some worktree details could not be loaded. Pull down to retry.")
                    .font(.subheadline)
                    .foregroundStyle(OS1VisualStyle.textDim)
                    .padding(12)
            }
        }
    }

    private var runSettingsSection: some View {
        InfoSection(title: "Run settings") {
            Menu {
                // Same slot as the session's own model menu: the running cost
                // sits with the choice that drives it.
                UsageMenuSection(usage: viewModel.usage)
                if let catalog {
                    ForEach(catalog.presets + catalog.regular) { option in
                        Button {
                            viewModel.changeModel(to: option.id)
                        } label: {
                            if option.id == currentModel {
                                Label(option.displayLabel, systemImage: "checkmark")
                            } else {
                                Text(option.displayLabel)
                            }
                        }
                    }
                }
            } label: {
                SettingsRow(
                    label: "Model",
                    value: catalog?.label(for: currentModel) ?? currentModel,
                    icon: "cpu"
                )
            }
            .buttonStyle(.plain)

            if let efforts = catalog?.option(for: currentModel)?.efforts,
               !efforts.isEmpty {
                Divider()
                Menu {
                    ForEach(efforts, id: \.self) { effort in
                        Button {
                            viewModel.effort = effort
                        } label: {
                            if viewModel.effort == effort {
                                Label(EffortLevel.label(effort), systemImage: "checkmark")
                            } else {
                                Text(EffortLevel.label(effort))
                            }
                        }
                    }
                } label: {
                    SettingsRow(
                        label: "Reasoning",
                        value: EffortLevel.label(viewModel.effort),
                        icon: "brain"
                    )
                }
                .buttonStyle(.plain)
            }

            if catalog?.option(for: currentModel)?.fastModeSupported == true {
                Divider()
                Toggle(isOn: $viewModel.fastMode) {
                    Label("Fast mode", systemImage: "bolt")
                        .font(.subheadline)
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 48)
            }
        }
    }

    private var currentModel: String {
        viewModel.model.isEmpty ? (catalog?.defaultModel ?? "") : viewModel.model
    }

    private var remoteSandbox: (provider: String, sandboxId: String?, workspace: String?)? {
        guard let sandbox = currentSession.sandbox,
              let provider = sandbox.provider,
              !provider.isEmpty,
              provider != "local"
        else { return nil }
        return (provider, sandbox.sandboxId, sandbox.workspace)
    }

    private var sandboxState: String {
        sandboxStatus?.lifecycle
            ?? currentSession.sandbox?.lifecycle
            ?? (remoteSandbox?.sandboxId == nil ? "preparing" : "awake")
    }

    private var sandboxStateLabel: String {
        switch sandboxState {
        case "awake": "Awake"
        case "sleeping": "Sleeping"
        case "waking": "Waking"
        case "needs_attention": "Needs attention"
        default: "Preparing"
        }
    }

    private var sandboxStateIcon: String {
        switch sandboxState {
        case "awake": "checkmark.circle"
        case "sleeping": "pause.circle"
        case "waking": "arrow.clockwise"
        case "needs_attention": "exclamationmark.triangle"
        default: "questionmark.circle"
        }
    }

    private var canRecreateSandbox: Bool {
        let id = sandboxStatus?.sandboxId ?? remoteSandbox?.sandboxId
        return id?.isEmpty == false
    }

    private func sandboxActionButton(
        _ action: SessionSandboxAction,
        title: String,
        icon: String
    ) -> some View {
        Button {
            Task { await performSandboxAction(action) }
        } label: {
            HStack(spacing: 10) {
                if sandboxAction == action {
                    ProgressView().controlSize(.small)
                } else {
                    Image(systemName: icon)
                }
                Text(sandboxAction == action ? "\(title)…" : title)
                Spacer()
            }
            .font(.subheadline.weight(.medium))
            .foregroundStyle(OS1VisualStyle.link)
            .padding(.horizontal, 12)
            .frame(minHeight: 48)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(sandboxAction != nil || sandboxStatus?.busy == true)
    }

    private var oldestSession: Session? {
        sessions.min { ($0.createdAt ?? "") < ($1.createdAt ?? "") }
    }

    private var repoLabel: String {
        var label = RepoTile.label(for: viewModel.session.effectiveRepo)
        let attached = currentSession.attachedRepos?.count ?? 0
        if attached > 0 { label += " +\(attached)" }
        return label
    }

    private var heroSubtitle: String {
        [repoLabel, catalog?.label(for: currentModel) ?? currentModel]
            .filter { !$0.isEmpty }
            .joined(separator: " · ")
    }

    private var stateLabel: (text: String, icon: String, color: Color)? {
        if viewModel.pendingQuestion != nil {
            return ("Waiting for input", "questionmark", OS1VisualStyle.blue)
        }
        if viewModel.isRunning {
            return ("Working", "sparkles", OS1VisualStyle.green)
        }
        switch currentSession.prState {
        case "OPEN": return ("In review", "arrow.triangle.pull", OS1VisualStyle.yellow)
        case "MERGED": return ("Merged", "checkmark", OS1VisualStyle.purple)
        default: return nil
        }
    }

    private func load() async {
        loading = true
        loadFailed = false
        sandboxLoading = remoteSandbox != nil
        async let gitResult = try? OS1API.gitStatus(
            sessionId: currentSession.id,
            repo: currentSession.effectiveRepo
        )
        async let diffResult = try? OS1API.sessionDiff(sessionId: currentSession.id)
        async let assetsResult = try? OS1API.assets(sessionId: currentSession.id)
        async let overviewResult = loadOverview()
        async let sandboxResult = loadSandboxResult()
        let (nextGit, nextDiffResponse, nextAssets, nextOverview, nextSandbox) = await (
            gitResult,
            diffResult,
            assetsResult,
            overviewResult,
            sandboxResult
        )
        guard !Task.isCancelled else { return }
        if let nextGit { gitStatus = nextGit }
        if let nextDiffResponse {
            diff = nextDiffResponse.repos.first(where: \.primary)?.diff
        }
        // Newest first, like the tab lists them.
        assets = (nextAssets ?? []).sorted { $0.mtime > $1.mtime }
        if let nextOverview { overview = nextOverview }
        applySandboxResult(nextSandbox)
        sandboxLoading = false
        loadFailed = gitStatus == nil && diff == nil && overview == nil
        loading = false
    }

    private func loadSandboxResult() async -> Result<SessionSandboxStatus?, Error> {
        guard remoteSandbox != nil else { return .success(nil) }
        do {
            return .success(try await OS1API.sandbox(sessionId: currentSession.id))
        } catch {
            return .failure(error)
        }
    }

    private func applySandboxResult(_ result: Result<SessionSandboxStatus?, Error>) {
        switch result {
        case .success(let status):
            sandboxStatus = status
            sandboxError = nil
        case .failure(let error):
            sandboxError = error.localizedDescription
        }
    }

    private func reloadSandbox() async {
        guard remoteSandbox != nil, !sandboxLoading else { return }
        sandboxLoading = true
        defer { sandboxLoading = false }
        applySandboxResult(await loadSandboxResult())
    }

    private func performSandboxAction(_ action: SessionSandboxAction) async {
        guard sandboxAction == nil else { return }
        sandboxAction = action
        sandboxError = nil
        defer { sandboxAction = nil }
        do {
            sandboxStatus = try await OS1API.sandboxAction(
                sessionId: currentSession.id,
                action: action
            )
        } catch {
            sandboxError = error.localizedDescription
        }
    }

    private func loadOverview() async -> OS1API.WorkspaceOverview? {
        if let id = currentSession.workspaceId, !id.isEmpty {
            return try? await OS1API.workspaceOverview(workspaceId: id)
        }

        var transcripts: [(Session, [TranscriptEntry]?)] = []
        for session in sessions {
            transcripts.append((
                session,
                try? await OS1API.transcript(sessionId: session.id)
            ))
        }
        let ordered = transcripts.sorted {
            ($0.0.createdAt ?? "") < ($1.0.createdAt ?? "")
        }
        var prompt: OS1API.WorkspaceOverview.Message?
        var lastMessage: OS1API.WorkspaceOverview.Message?
        for (session, entries) in ordered {
            guard let entries else { continue }
            if prompt == nil,
               let entry = entries.first(where: {
                   $0.isUser && !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                       && !$0.text.hasPrefix("/")
               }) {
                prompt = .init(
                    content: entry.text,
                    sessionId: session.id,
                    at: entry.timestamp ?? session.createdAt ?? ""
                )
            }
            if let entry = entries.last(where: {
                $0.isAssistant && !$0.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }) {
                let candidate = OS1API.WorkspaceOverview.Message(
                    content: entry.text,
                    sessionId: session.id,
                    at: entry.timestamp ?? session.lastActivity ?? ""
                )
                if lastMessage == nil || candidate.at > lastMessage!.at {
                    lastMessage = candidate
                }
            }
        }
        return .init(prompt: prompt, lastMessage: lastMessage)
    }

    private func loadGitDetails() async {
        async let gitResult = try? OS1API.gitStatus(
            sessionId: currentSession.id,
            repo: currentSession.effectiveRepo
        )
        async let diffResult = try? OS1API.sessionDiff(sessionId: currentSession.id)
        let (nextGit, nextDiffResponse) = await (gitResult, diffResult)
        guard !Task.isCancelled else { return }
        if let nextGit { gitStatus = nextGit }
        if let nextDiffResponse {
            diff = nextDiffResponse.repos.first(where: \.primary)?.diff
        }
    }

    /// The navigation value is a snapshot. Prefer the latest polled row so an
    /// optimistic session gains its worktree metadata without being reopened.
    private var currentSession: Session {
        sessions.first(where: { $0.id == viewModel.session.id }) ?? viewModel.session
    }

    private var loadIdentity: String {
        [
            currentSession.id,
            currentSession.workspaceId ?? "",
            currentSession.worktreeDir ?? "",
            currentSession.branch ?? "",
            String(currentSession.attachedRepos?.count ?? 0),
        ].joined(separator: "|")
    }

    /// `verbatim:` on every count here and in the file rows: `Text("+\(n)")`
    /// goes through LocalizedStringKey, which formats the number for the
    /// device's locale — a 1174-line diff read "+1.174" on a Dutch phone.
    private func diffTotals(_ diff: OS1API.SessionDiff) -> some View {
        HStack(spacing: 6) {
            if diff.totalAdditions > 0 {
                Text(verbatim: "+\(diff.totalAdditions)").foregroundStyle(OS1VisualStyle.greenInk)
            }
            if diff.totalDeletions > 0 {
                Text(verbatim: "−\(diff.totalDeletions)").foregroundStyle(OS1VisualStyle.redInk)
            }
        }
        .font(.caption.weight(.semibold).monospacedDigit())
    }

}

/// Opens workspace details directly from a list-row context menu while still
/// giving its model controls the live session socket they use in SessionView.
struct WorktreeInfoSheet: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var viewModel: SessionViewModel
    @State private var catalog: ModelCatalog?
    @Bindable private var listViewModel: SessionsListViewModel
    private let fallbackWorkspace: SidebarWorkspace

    init(workspace: SidebarWorkspace, listViewModel: SessionsListViewModel) {
        _viewModel = State(initialValue: SessionViewModel(session: workspace.mainSession))
        self.listViewModel = listViewModel
        fallbackWorkspace = workspace
    }

    var body: some View {
        let workspace = SessionsListViewModel.sidebarWorkspaces(
            in: listViewModel.sessions,
            workspaceNames: listViewModel.workspaceNames
        ).first { workspace in
            workspace.sessions.contains { $0.id == viewModel.session.id }
        } ?? fallbackWorkspace

        WorktreeInfoView(viewModel: viewModel, sessions: workspace.sessions, catalog: catalog)
            .task {
                viewModel.start()
                if scenePhase != .active { viewModel.appDidEnterBackground() }
                catalog = try? await OS1API.models()
            }
            .onDisappear { viewModel.stop() }
            .onChange(of: scenePhase) { _, phase in
                switch phase {
                case .active: viewModel.appDidBecomeActive()
                case .inactive, .background: viewModel.appDidEnterBackground()
                @unknown default: viewModel.appDidEnterBackground()
                }
            }
    }
}

private struct InfoSection<Content: View>: View {
    let title: String
    var trailing: AnyView? = nil
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(title)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(OS1VisualStyle.textDim)
                Spacer()
                trailing
            }
            VStack(spacing: 0) { content }
                .background(
                    OS1VisualStyle.raised,
                    in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                )
        }
    }
}

private struct InfoRow: View {
    let label: String
    let value: String
    let icon: String
    var monospaced = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Label(label, systemImage: icon)
                .font(.subheadline)
                .foregroundStyle(OS1VisualStyle.textDim)
            Spacer(minLength: 12)
            Text(value)
                .font(monospaced ? .caption.monospaced() : .subheadline)
                .foregroundStyle(OS1VisualStyle.text)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 46)
    }
}

private struct SettingsRow: View {
    let label: String
    let value: String
    let icon: String

    var body: some View {
        HStack(spacing: 10) {
            Label(label, systemImage: icon)
                .font(.subheadline)
                .foregroundStyle(OS1VisualStyle.text)
            Spacer()
            Text(value)
                .font(.subheadline)
                .foregroundStyle(OS1VisualStyle.textDim)
                .lineLimit(1)
            Image(systemName: "chevron.up.chevron.down")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(OS1VisualStyle.textFaint)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 48)
        .contentShape(Rectangle())
    }
}

private struct StatusPill: View {
    let text: String
    let icon: String
    let color: Color

    var body: some View {
        Label(text, systemImage: icon)
            .font(.caption.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 9)
            .padding(.vertical, 6)
            .background(color.opacity(0.12), in: Capsule())
    }
}

private struct SummaryBlock: View {
    let label: String
    let content: String
    var lines = 5

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(label)
                .font(.caption.weight(.semibold))
                .foregroundStyle(OS1VisualStyle.textDim)
            Text(Self.inline(content))
                .font(.subheadline)
                .foregroundStyle(OS1VisualStyle.text)
                .lineLimit(lines)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
    }

    /// Agent messages are markdown, and a preview that prints the syntax —
    /// `**The rail was wrong**`, backticked shas — reads worse than no
    /// formatting at all. Inline-only: this is a few lines of a message, so
    /// headings and list markers have nowhere to go, and stripping their
    /// leading punctuation keeps the first line from starting on a "#".
    private static func inline(_ content: String) -> AttributedString {
        let stripped = content
            .split(separator: "\n", omittingEmptySubsequences: false)
            .map { line -> Substring in
                var line = line
                while let first = line.first, first == "#" || first == ">" {
                    line = line.dropFirst()
                    if line.first == " " { line = line.dropFirst() }
                }
                return line
            }
            .joined(separator: "\n")
        let parsed = try? AttributedString(
            markdown: stripped,
            options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)
        )
        return parsed ?? AttributedString(stripped)
    }
}

#endif
