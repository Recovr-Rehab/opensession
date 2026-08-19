import SwiftUI

/// The sessions list's view controls in one panel: how the list is grouped,
/// which project and person it is scoped to, what it hides, and how it is
/// sorted. The web's filter popover, minus the two controls with no native
/// surface behind them (session-less pull request rows, and the desktop
/// sidebar's row density).
///
/// A panel rather than a menu. Seven controls is where a `Menu` stops working:
/// every toggle inside one dismisses the whole stack, so turning two things
/// off means opening it twice and walking two levels down each time. This
/// stays open across every adjustment, which is what the web popover does.
/// A sheet on the phone, a popover on the Mac.
struct SessionsFilterPanel: View {
    @Binding var groupBy: String
    @Binding var repo: String
    @Binding var person: String
    @Binding var sort: String
    @Binding var showAutoCreated: Bool
    @Binding var hideEmptyProjects: Bool
    /// Projects with a band in the list right now, in its own order.
    let repos: [String]
    let currentUser: String
    /// Opens the archived list. Absent on the Mac, whose sidebar has its own
    /// Archived row under the list.
    var onArchived: (() -> Void)?

    @Environment(\.dismiss) private var dismiss

    /// The agent's own name, which is also the key its work files under.
    private var agentName: String { InstanceIdentity.shared.personaName }

    /// Teammates, minus whoever is signed in: "you" is the first row and must
    /// not appear twice under two spellings of the same name.
    private var teammates: [String] {
        TeamDirectory.shared.names.filter {
            !SidebarPersonLens.nameMatches($0, key: currentUser)
        }
    }

    var body: some View {
        panel
            .task { await TeamDirectory.shared.ensureLoaded() }
    }

    @ViewBuilder
    private var panel: some View {
        #if os(iOS)
        NavigationStack {
            form
                .navigationTitle("Filter")
                .navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
        }
        .presentationDetents([.medium, .large])
        #else
        form
            .formStyle(.grouped)
            .frame(width: 330, height: 460)
        #endif
    }

    private var form: some View {
        Form {
            Section {
                Picker("Group by", selection: $groupBy) {
                    ForEach(SidebarGroupBy.allCases, id: \.rawValue) { option in
                        Text(option.label).tag(option.rawValue)
                    }
                }
            } footer: {
                Text("Rows band by what they want from you and when they last moved. This is what sits above those bands.")
            }

            Section {
                Picker("Project", selection: $repo) {
                    Text("All projects").tag("all")
                    ForEach(repos, id: \.self) { name in
                        Label {
                            Text(RepoTile.label(for: name))
                        } icon: {
                            RepoTile(name: name, size: 16)
                        }
                        .tag(name)
                    }
                }
                // The one setting about the SET of projects rather than about
                // which one you are in, so it sits under the list of them.
                Toggle("Hide when empty", isOn: $hideEmptyProjects)
            } footer: {
                Text("A project you just connected keeps its heading until you turn this on.")
            }

            Section {
                Picker("Person", selection: $person) {
                    personOptions
                }
            }

            Section {
                Picker("Sort by", selection: $sort) {
                    ForEach(SidebarSortBy.allCases, id: \.rawValue) { option in
                        Text(option.label).tag(option.rawValue)
                    }
                }
                Toggle("Show auto created", isOn: $showAutoCreated)
            } header: {
                Text("Advanced")
            } footer: {
                Text("Auto created rows are workspaces an agent opened for itself, not automations you set up.")
            }

            if let onArchived {
                Section {
                    Button("Archived") {
                        dismiss()
                        onArchived()
                    }
                }
            }
        }
    }

    /// You first, then teammates and the agent, then the aggregate backlog,
    /// then everyone. The agent is one of the people in this list: it owns
    /// every workspace and automation nobody has taken.
    @ViewBuilder
    private var personOptions: some View {
        Text(currentUser.isEmpty ? "You" : "\(currentUser) (you)")
            .tag(SidebarPersonLens.me)
        ForEach(teammates, id: \.self) { name in
            Text(name).tag(name.lowercased())
        }
        Text(agentName).tag(agentName.lowercased())
        Text("Unassigned").tag(SidebarPersonLens.unassigned)
        Text("Everyone").tag(SidebarPersonLens.everyone)
    }
}
