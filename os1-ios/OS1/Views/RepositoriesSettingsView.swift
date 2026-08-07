import SwiftUI

/// Settings → Repositories: what each repo's tile looks like.
///
/// A repo shows a colored letter unless someone gives it art of its own. The
/// color is assigned across the registered set so no two repos match — this is
/// where that gets overridden by hand, and where a repo can be handed its
/// owner's GitHub avatar. Mirrors the web's Settings → Setup → Repositories
/// (src/frontend/components/SetupRepos.tsx); both drive the same endpoint, so
/// a tile changed on the phone is the tile the sidebar paints.
struct RepositoriesSettingsView: View {
    @State private var repos: [OS1API.RepoInfo] = []
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        List {
            if let error {
                Section { Text(error).foregroundStyle(.red) }
            }
            if repos.isEmpty {
                Section {
                    if loading {
                        ProgressView("Loading repositories…")
                    } else {
                        Text("No repositories registered.")
                            .foregroundStyle(.secondary)
                    }
                }
            } else {
                Section {
                    ForEach(repos, id: \.id) { repo in
                        NavigationLink {
                            RepoTileEditorView(repo: repo, onChanged: load)
                        } label: {
                            HStack(spacing: 11) {
                                RepoTile(name: repo.id, size: 28)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(RepoTile.label(for: repo.id))
                                    if let ghRepo = repo.ghRepo, !ghRepo.isEmpty {
                                        Text(ghRepo)
                                            .font(.footnote)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                            }
                        }
                    }
                } footer: {
                    Text(
                        "A repo without an icon of its own wears a colored letter. Colors are assigned so no two repos match; pick one to override that."
                    )
                }
            }
        }
        .insetGroupedListCompat()
        .navigationTitle("Repositories")
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            repos = try await OS1API.repos()
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }
}

/// One repo's tile: the palette, and where its art comes from.
private struct RepoTileEditorView: View {
    let repo: OS1API.RepoInfo
    let onChanged: () async -> Void

    @State private var color: String?
    @State private var colorChosen: Bool
    @State private var hasIcon: Bool
    @State private var busy = false
    @State private var error: String?

    init(repo: OS1API.RepoInfo, onChanged: @escaping () async -> Void) {
        self.repo = repo
        self.onChanged = onChanged
        _color = State(initialValue: repo.color)
        _colorChosen = State(initialValue: repo.colorChosen ?? false)
        _hasIcon = State(initialValue: repo.hasIcon ?? false)
    }

    private let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 8)

    var body: some View {
        List {
            Section {
                HStack {
                    Spacer()
                    RepoTile(name: repo.id, size: 64, round: false)
                    Spacer()
                }
                .listRowBackground(Color.clear)
            }

            Section("Color") {
                LazyVGrid(columns: columns, spacing: 10) {
                    ForEach(RepoTilePalette.colors, id: \.self) { rgb in
                        let hex = String(format: "#%06x", rgb)
                        Button {
                            Task { await apply(color: .some(hex)) }
                        } label: {
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .fill(Color(rgb: rgb))
                                .frame(height: 30)
                                .overlay {
                                    if color?.lowercased() == hex {
                                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                                            .strokeBorder(OS1VisualStyle.text, lineWidth: 2)
                                            .padding(-3)
                                    }
                                }
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(hex)
                        .accessibilityAddTraits(color?.lowercased() == hex ? [.isSelected] : [])
                    }
                }
                .padding(.vertical, 4)
                .disabled(busy)
                if colorChosen {
                    Button("Use the assigned color") {
                        Task { await apply(color: .some(nil)) }
                    }
                    .disabled(busy)
                }
            }

            Section {
                Button(busy ? "Working…" : "Fetch icon from GitHub") {
                    Task { await apply(icon: .some("github")) }
                }
                .disabled(busy || (repo.ghRepo ?? "").isEmpty)
                if hasIcon {
                    Button("Remove icon", role: .destructive) {
                        Task { await apply(icon: .some(nil)) }
                    }
                    .disabled(busy)
                }
            } header: {
                Text("Icon")
            } footer: {
                // Worth saying out loud: this is why the icon isn't automatic.
                // GitHub has no per-repo art, so taking the owner's avatar for
                // every repo put one tile on all of them.
                Text(
                    (repo.ghRepo ?? "").isEmpty
                        ? "No GitHub repository configured, so there's no avatar to take."
                        : "Takes \(String((repo.ghRepo ?? "").split(separator: "/").first ?? ""))'s avatar — the same picture for every repo that owner has, so it suits the one that IS the product."
                )
            }

            if let error {
                Section { Text(error).foregroundStyle(.red) }
            }
        }
        .insetGroupedListCompat()
        .navigationTitle(RepoTile.label(for: repo.id))
        .inlineTitleBarCompat()
    }

    private func apply(color: String?? = nil, icon: String?? = nil) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            let result = try await OS1API.setRepoAppearance(
                id: repo.id,
                color: color,
                icon: icon
            )
            self.color = result.color ?? self.color
            colorChosen = result.color != nil
            hasIcon = result.hasIcon
            error = nil
            // Refresh the list behind this screen: the palette store learns the
            // new color and icon revision there, which is what repaints every
            // other tile in the app.
            await onChanged()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
