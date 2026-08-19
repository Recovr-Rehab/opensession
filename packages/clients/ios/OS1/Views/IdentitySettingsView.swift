import SwiftUI

/// Settings → Identity: the two names this instance answers to.
///
/// Workspace-wide rather than per device, so what is typed here is what
/// everyone signed into this server reads. Each field therefore saves on its
/// own, at the moment editing ends, rather than behind a Save button that can
/// be left half-pressed on a screen someone walked away from.
///
/// Clearing a field restores the built-in default, and the server answers
/// with the default it fell back to — which is why the reply replaces the
/// draft instead of the draft being kept as the truth.
struct IdentitySettingsView: View {
    @State private var identity: InstanceIdentitySettings? = SettingsCache.value("instance-identity")
    @State private var persona = ""
    @State private var product = ""
    @State private var loading = true
    @State private var saving = false
    @State private var error: String?
    @FocusState private var focused: NameField?

    private enum NameField: Hashable { case persona, product }

    var body: some View {
        List {
            // With a cached answer the fields stay up and a failed refresh
            // adds its row above them; the spinner is only for having nothing
            // to show at all.
            if loading, identity == nil {
                settingsLoadingRow
            } else {
                if let error { settingsErrorRow(error) { Task { await load() } } }
                Section {
                    nameRow(
                        "Agent name",
                        text: $persona,
                        placeholder: "Assistant",
                        field: .persona
                    )
                    nameRow(
                        "Product name",
                        text: $product,
                        placeholder: "Open Session",
                        field: .product
                    )
                } footer: {
                    Text(footer)
                }
            }
        }
        .insetGroupedListCompat()
        .navigationTitle("Identity")
        .task { await load() }
        .refreshable { await load() }
        // Editing ends when focus moves on — to the other field, to the
        // keyboard's Done, or by leaving the screen. That is the same moment
        // the web commits, and it is the only one a phone reliably gets: a
        // settings row has no Save of its own to press.
        .onChange(of: focused) { previous, _ in
            guard let previous else { return }
            Task { await commit(previous) }
        }
    }

    private var footer: String {
        let base = "Shared by everyone on this instance. Clearing a name restores the built-in default."
        guard let path = identity?.configPath, !path.isEmpty else { return base }
        return "\(base) Stored in \(path) on the server."
    }

    private func nameRow(
        _ title: String,
        text: Binding<String>,
        placeholder: String,
        field: NameField
    ) -> some View {
        LabeledContent {
            TextField(placeholder, text: text)
                .multilineTextAlignment(.trailing)
                .disableAutocorrection(true)
                .focused($focused, equals: field)
                .disabled(saving)
                .onSubmit { focused = nil }
        } label: {
            Text(title)
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let fetched = try await SettingsAPI.instanceIdentity()
            apply(fetched)
            SettingsCache.save("instance-identity", fetched)
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Adopt the server's names — but never over a field being typed in, or a
    /// refresh landing mid-edit would swallow what was half written.
    private func apply(_ fetched: InstanceIdentitySettings) {
        identity = fetched
        if focused != .persona { persona = fetched.personaName ?? "" }
        if focused != .product { product = fetched.productName ?? "" }
    }

    private func commit(_ field: NameField) async {
        let value = (field == .persona ? persona : product)
            .trimmingCharacters(in: .whitespaces)
        let stored = (field == .persona ? identity?.personaName : identity?.productName) ?? ""
        guard value != stored, !saving else { return }
        saving = true
        defer { saving = false }
        do {
            let key = field == .persona ? "personaName" : "productName"
            apply(try await SettingsAPI.saveInstanceIdentity([key: value]))
            if let identity { SettingsCache.save("instance-identity", identity) }
            error = nil
        } catch {
            // Put the stored name back: a rejected value left in the field
            // reads as saved.
            self.error = error.localizedDescription
            if field == .persona { persona = identity?.personaName ?? "" }
            else { product = identity?.productName ?? "" }
        }
    }
}
