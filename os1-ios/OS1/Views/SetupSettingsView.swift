import SwiftUI

/// Settings → Setup: what's wired up on this instance.
///
/// The phone counterpart of the web's Settings → Setup
/// (src/frontend/components/Setup.tsx), reading the same read-only
/// `/api/setup/status` snapshot and computing the same three states from it —
/// so a row that reads "Enabled — missing credentials" here says exactly that
/// on the desktop too. The state rules are ported from `setup-shared.tsx`
/// rather than sent by the server, which returns facts (`enabled`,
/// `missingRequired`) and leaves the wording to each client.
///
/// Read-only on purpose. The write half of that page enters credentials and
/// restarts the server; a phone is the wrong place to type an API key you
/// can't see afterwards, and the one piece of it worth having on a phone —
/// a repo's tile — already has its own screen (RepositoriesSettingsView).
struct SetupSettingsView: View {
    @State private var status: OS1API.SetupStatus? = SettingsCache.value("setup-status")
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        List {
            if let error {
                Section { Text(error).foregroundStyle(.red) }
            }
            if let status {
                gettingStarted(status)
                repositories(status)
                team(status)
                integrations(status)
            } else if loading {
                Section { ProgressView("Loading setup…") }
            } else if error == nil {
                Section {
                    Text("No setup status.").foregroundStyle(.secondary)
                }
            }
        }
        .insetGroupedListCompat()
        .navigationTitle("Setup")
        .task { await load() }
        .refreshable { await load() }
    }

    // ── Getting started ──────────────────────────────────────────────────

    @ViewBuilder
    private func gettingStarted(_ s: OS1API.SetupStatus) -> some View {
        let repos = s.repos ?? []
        Section {
            engineRow(s.engine)

            StatusRow(
                title: "Repositories",
                detail: repos.isEmpty
                    ? "Register the repos sessions work in."
                    : repos.map { $0.label ?? $0.id }.joined(separator: ", "),
                tone: repos.isEmpty ? .warn : .on,
                label: repos.isEmpty ? "None" : "\(repos.count) registered"
            )

            if !repos.isEmpty {
                let bootable = repos.filter { lifecycleState($0.lifecycle).tone == .on }
                StatusRow(
                    title: "Local dev setup",
                    detail: bootable.count == repos.count
                        ? "Every repo boots its own dev server, so previews work and agents can check their UI changes in a browser."
                        : "Repos without a boot script keep the Preview button disabled — add .opensession/start.sh (docs/repo-lifecycle.md).",
                    tone: bootable.count == repos.count
                        ? .on : (bootable.isEmpty ? .off : .warn),
                    label: "\(bootable.count)/\(repos.count) bootable"
                )
            }

            let team = s.team
            let count = team?.count ?? 0
            StatusRow(
                title: "Team roster",
                detail: count > 0
                    ? (team?.names ?? []).joined(separator: ", ")
                    : "Add teammates so commits and sessions attribute to real people.",
                tone: count > 0 ? .on : .warn,
                label: count > 0 ? "\(count) \(count == 1 ? "member" : "members")" : "Empty"
            )

            if let github = s.github {
                let state = githubState(github)
                StatusRow(
                    title: "GitHub sign-in",
                    detail: (github.userPrAuth ?? false) && (github.clientIdConfigured ?? false)
                        ? "Teammates sign in with GitHub and open PRs as themselves."
                        : "Off — the UI uses the name picker and PRs come from the bot account.",
                    tone: state.tone,
                    label: state.label
                )
            }
        } header: {
            Text("Getting started")
        }
    }

    @ViewBuilder
    private func engineRow(_ engine: OS1API.SetupStatus.Engine?) -> some View {
        if let engine {
            let ready = engine.ready ?? false
            // The one non-optional component: an instance that can't run a
            // turn is broken however green everything under it reads.
            StatusRow(
                title: "Engine",
                detail: ready
                    ? [engine.defaultModel, accountsSummary(engine)]
                        .compactMap { $0 }.joined(separator: " · ")
                    : [engine.blocker, engine.fix].compactMap { $0 }.joined(separator: " "),
                tone: ready ? .on : .off,
                label: ready ? "Ready" : "Not ready"
            )
        }
    }

    private func accountsSummary(_ engine: OS1API.SetupStatus.Engine) -> String? {
        var parts: [String] = []
        if let n = engine.claudeAccounts, n > 0 { parts.append("\(n) Claude") }
        if let n = engine.codexAccounts, n > 0 { parts.append("\(n) OpenAI") }
        guard !parts.isEmpty else { return nil }
        return parts.joined(separator: ", ") + " accounts"
    }

    // ── The lists behind the checklist ───────────────────────────────────

    @ViewBuilder
    private func repositories(_ s: OS1API.SetupStatus) -> some View {
        let repos = s.repos ?? []
        if !repos.isEmpty {
            Section {
                ForEach(repos, id: \.id) { repo in
                    let state = lifecycleState(repo.lifecycle)
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 8) {
                            RepoTile(name: repo.id, size: 22)
                            Text(repo.label ?? repo.id)
                            Spacer(minLength: 8)
                            StateChip(tone: state.tone, label: state.label)
                        }
                        Text(state.detail)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 2)
                }
            } header: {
                Text("Repositories")
            } footer: {
                Text("A repo that commits .opensession/setup.sh and start.sh provisions its own worktrees and boots its dev server.")
            }
        }
    }

    @ViewBuilder
    private func team(_ s: OS1API.SetupStatus) -> some View {
        let names = s.team?.names ?? []
        if !names.isEmpty {
            Section("Team") {
                ForEach(names, id: \.self) { name in
                    Text(name)
                }
            }
        }
    }

    @ViewBuilder
    private func integrations(_ s: OS1API.SetupStatus) -> some View {
        let items = s.integrations ?? []
        if !items.isEmpty {
            Section {
                ForEach(items, id: \.id) { item in
                    let state = integrationState(item)
                    HStack(spacing: 8) {
                        Text(item.label ?? item.id)
                        Spacer(minLength: 8)
                        StateChip(tone: state.tone, label: state.label)
                    }
                }
            } header: {
                Text("Integrations")
            } footer: {
                Text("Enter credentials on the web. This screen only shows their status.")
            }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let fetched = try await OS1API.setupStatus()
            status = fetched
            SettingsCache.save("setup-status", fetched)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// ── The three states, ported from the web's setup-shared.tsx ─────────────

enum SetupTone {
    case on, warn, off

    var color: Color {
        switch self {
        case .on: OS1VisualStyle.green
        case .warn: OS1VisualStyle.yellow
        case .off: OS1VisualStyle.textFaint
        }
    }
}

private func integrationState(
    _ i: OS1API.SetupStatus.Integration
) -> (tone: SetupTone, label: String) {
    let enabled = i.enabled ?? false
    let missing = i.missingRequired ?? []
    if enabled && missing.isEmpty { return (.on, "On") }
    if enabled { return (.warn, "Missing credentials") }
    return (.off, "Off")
}

private func githubState(
    _ g: OS1API.SetupStatus.Github
) -> (tone: SetupTone, label: String) {
    let userPrAuth = g.userPrAuth ?? false
    if userPrAuth && (g.clientIdConfigured ?? false) {
        return (.on, (g.redirectFlowAvailable ?? false) ? "Active" : "Device flow only")
    }
    if userPrAuth { return (.warn, "Missing client id") }
    return (.off, "Off")
}

/// `start.sh` (or an instance `previewCommand`) is the load-bearing half —
/// without it the Preview button has nothing to run. `setup.sh` alone still
/// provisions worktrees, but nothing boots.
private func lifecycleState(
    _ lifecycle: OS1API.SetupStatus.Lifecycle?
) -> (tone: SetupTone, label: String, detail: String) {
    let dir = lifecycle?.dir ?? ".opensession"
    let setup = lifecycle?.setup ?? false
    let start = lifecycle?.start ?? false
    if start {
        return (
            .on, setup ? "Ready" : "Boots",
            setup
                ? "\(dir)/ provisions each worktree and boots the dev server."
                : "\(dir)/start.sh boots the dev server — add setup.sh to provision worktrees."
        )
    }
    if lifecycle?.previewCommand ?? false {
        return (
            .on, "Instance command",
            "Boots through this instance's previewCommand — commit \(dir)/start.sh to keep the recipe with the code."
        )
    }
    if setup {
        return (
            .warn, "Setup only",
            "\(dir)/setup.sh provisions worktrees — add start.sh to enable previews."
        )
    }
    return (.off, "None", "No \(dir)/ scripts — previews stay disabled.")
}

/// The web's `StateChip`: a tone dot and its word, sized to sit at the end of
/// a row without competing with the row's own title.
private struct StateChip: View {
    let tone: SetupTone
    let label: String

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(tone.color)
                .frame(width: 6, height: 6)
            Text(label)
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A checklist line: what it is, where it stands, and a sentence saying why.
private struct StatusRow: View {
    let title: String
    let detail: String
    let tone: SetupTone
    let label: String

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 8) {
                Text(title)
                Spacer(minLength: 8)
                StateChip(tone: tone, label: label)
            }
            if !detail.isEmpty {
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}
