import SwiftUI
#if os(iOS)

/// What the team shipped.
///
/// One row per merged pull request and per commit on a repo that ships
/// without them, in one list, newest first. The page answers "what shipped"
/// rather than "what merged", which is why both kinds sit together and sort
/// together instead of living in two lists.
///
/// The web puts a row of faces above this to narrow it to one person, and
/// picking one also turns the sidebar to them. That second half has no meaning
/// here, since this screen is pushed over the list rather than beside it, so
/// the phone keeps the repo filter and leaves people to the sidebar's own
/// filter panel.
struct FeedView: View {
    /// Opens the session behind a row. Handed up, because this screen rides
    /// the sessions list's navigation stack.
    let onOpenSession: (String) -> Void

    @Environment(\.openURL) private var openURL

    @State private var rows: [FeedRow] = []
    @State private var repo = FeedView.allRepos
    @State private var days = FeedView.daySteps[0]
    @State private var hasMore = false
    @State private var loading = true
    @State private var loadFailed = false

    /// How far back the feed reaches, in days, and the steps "Show more"
    /// walks. A window rather than a row count: on a repo that ships a hundred
    /// times a day a flat cap is spent before the first day ends, so the list
    /// reads as "the feed only shows today" and no amount of scrolling reaches
    /// yesterday.
    private static let daySteps = [3, 7, 14, 45]
    private static let allRepos = "all"

    /// A ceiling on rendered rows, so a very wide window cannot stall the
    /// screen. It sits far above a busy fortnight; the window is what normally
    /// binds.
    private static let renderCeiling = 600

    var body: some View {
        Group {
            if loading && rows.isEmpty {
                ProgressView()
                    .controlSize(.large)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if loadFailed && rows.isEmpty {
                failedPlaceholder
            } else if rows.isEmpty {
                emptyPlaceholder
            } else {
                list
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(OS1VisualStyle.background)
        .navigationTitle("Feed")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if repos.count > 1 {
                ToolbarItem(placement: .topBarTrailing) { repoMenu }
            }
        }
        .task { await load() }
    }

    private var repoMenu: some View {
        Menu {
            Picker("Project", selection: $repo) {
                Text("All projects").tag(Self.allRepos)
                ForEach(repos, id: \.self) { name in
                    Text(name).tag(name)
                }
            }
        } label: {
            Image(systemName: repo == Self.allRepos
                ? "line.3.horizontal.decrease.circle"
                : "line.3.horizontal.decrease.circle.fill")
                .foregroundStyle(repo == Self.allRepos
                    ? OS1VisualStyle.text
                    : OS1VisualStyle.accentInk)
        }
        .accessibilityLabel(
            repo == Self.allRepos ? "Filter by project" : "Filtered to \(repo)"
        )
    }

    private var list: some View {
        List {
            ForEach(groups, id: \.title) { group in
                Section {
                    ForEach(group.rows) { row in
                        FeedRowView(row: row) { open(row) }
                    }
                } header: {
                    Text(group.title)
                }
            }

            if hasMore, let next = Self.daySteps.first(where: { $0 > days }) {
                Section {
                    Button {
                        Task { await load(days: next) }
                    } label: {
                        HStack {
                            Spacer()
                            Text("Show the last \(next) days")
                                .font(.callout.weight(.medium))
                                .foregroundStyle(OS1VisualStyle.accentInk)
                            Spacer()
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(loading)
                }
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(OS1VisualStyle.background)
        .refreshable { await load(days: days) }
    }

    private var emptyPlaceholder: some View {
        ListPlaceholder(
            symbol: "shippingbox",
            title: "Nothing shipped yet",
            message: "Merged pull requests and commits collect here as the team lands work."
        ) {
            EmptyView()
        }
    }

    private var failedPlaceholder: some View {
        ListPlaceholder(
            symbol: "exclamationmark.triangle",
            title: "Couldn't load the feed",
            message: "The server didn't answer for recent work."
        ) {
            Button("Try again") { Task { await load(days: days) } }
                .buttonStyle(PlaceholderActionStyle())
        }
    }

    /// Every project with something in the window, so the filter never offers
    /// a project the current feed cannot show.
    private var repos: [String] {
        Array(Set(rows.map(\.repo))).sorted()
    }

    private var visibleRows: [FeedRow] {
        let cutoff = Date().addingTimeInterval(-Double(days) * 86_400)
        let recent = rows.filter { ($0.shippedAt ?? .distantPast) >= cutoff }
        let scoped = repo == Self.allRepos ? recent : recent.filter { $0.repo == repo }
        return Array(scoped.prefix(Self.renderCeiling))
    }

    private struct DayGroup {
        let title: String
        let rows: [FeedRow]
    }

    /// Banded by day, in the order the rows already carry. Built once per
    /// render pass rather than per row, and every date it needs was resolved
    /// when the rows were built.
    private var groups: [DayGroup] {
        var groups: [DayGroup] = []
        var currentTitle: String?
        var current: [FeedRow] = []
        for row in visibleRows {
            let title = Self.dayTitle(row.shippedAt)
            if title != currentTitle {
                if let currentTitle, !current.isEmpty {
                    groups.append(DayGroup(title: currentTitle, rows: current))
                }
                currentTitle = title
                current = []
            }
            current.append(row)
        }
        if let currentTitle, !current.isEmpty {
            groups.append(DayGroup(title: currentTitle, rows: current))
        }
        return groups
    }

    private static func dayTitle(_ date: Date?) -> String {
        guard let date else { return "Earlier" }
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Today" }
        if calendar.isDateInYesterday(date) { return "Yesterday" }
        return date.formatted(.dateTime.weekday(.wide).month(.abbreviated).day())
    }

    /// The session if there is one, the pull request or commit on the host if
    /// there is not. A shipped commit's session is usually archived, which is
    /// exactly the case the row keeps an id for.
    private func open(_ row: FeedRow) {
        if let sessionId = row.sessionId {
            onOpenSession(sessionId)
            return
        }
        if let url = row.url.flatMap(URL.init(string:)) { openURL(url) }
    }

    private func load(days next: Int? = nil) async {
        let window = next ?? days
        loading = true
        defer { loading = false }
        // Both at once: they are independent reads, and the feed is the sum
        // of them rather than one after the other.
        async let prsTask = try? OS1API.recentPrs()
        async let commitsTask = try? OS1API.recentCommits(days: window)
        let (prs, page) = await (prsTask, commitsTask)
        guard !Task.isCancelled else { return }
        // Both halves failing is a failure; one is a thinner feed, which is
        // still the honest answer for an instance where only one of them
        // exists at all.
        if prs == nil && page == nil {
            if rows.isEmpty { loadFailed = true }
            return
        }
        // The PR cache can hold thousands of rows. Parse and sort them away
        // from the main actor so opening Feed never stalls the navigation
        // transition while ICU resolves their timestamps.
        let built = await Task.detached(priority: .userInitiated) {
            FeedRows.build(prs: prs ?? [], commits: page?.commits ?? [])
        }.value
        guard !Task.isCancelled else { return }
        let servedDays = page?.days ?? window
        let cutoff = Date().addingTimeInterval(-Double(servedDays) * 86_400)
        rows = built
        days = servedDays
        hasMore = (page?.hasMore ?? false)
            || built.contains { ($0.shippedAt ?? .distantPast) < cutoff }
        loadFailed = false
    }
}

/// One shipped thing: what it was, where it landed, and how big it was.
private struct FeedRowView: View {
    let row: FeedRow
    let onOpen: () -> Void

    var body: some View {
        Button(action: onOpen) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: row.kind == .pullRequest
                    ? "arrow.triangle.pull"
                    : "point.3.connected.trianglepath.dotted")
                    .font(.callout)
                    .foregroundStyle(OS1VisualStyle.textDim)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: 3) {
                    Text(row.title)
                        .font(.callout.weight(.medium))
                        .foregroundStyle(OS1VisualStyle.text)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Text(verbatim: metaLine)
                        .font(.caption)
                        .foregroundStyle(OS1VisualStyle.textFaint)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                if let diff = diffLabel {
                    Text(verbatim: diff)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(OS1VisualStyle.textFaint)
                        .padding(.top, 2)
                }
            }
            .padding(.vertical, 3)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel)
    }

    /// Who, where and which one, on the line the title does not need.
    private var metaLine: String {
        var parts = [row.repo, row.ref]
        if let owner = row.owner, !owner.isEmpty { parts.append(owner) }
        if let shippedAt = row.shippedAt {
            parts.append(shippedAt.formatted(date: .omitted, time: .shortened))
        }
        return parts.joined(separator: " · ")
    }

    /// Absent rather than "+0 -0" when the server did not count: a real
    /// zero-line change does not exist, so a zero here means unknown.
    private var diffLabel: String? {
        let additions = row.additions ?? 0
        let deletions = row.deletions ?? 0
        guard additions > 0 || deletions > 0 else { return nil }
        return "+\(additions) −\(deletions)"
    }

    private var accessibilityLabel: String {
        let kind = row.kind == .pullRequest ? "Pull request" : "Commit"
        return "\(kind) \(row.ref) in \(row.repo): \(row.title)"
    }
}
#endif
