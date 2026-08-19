import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Settings → General: workspace identity shared by everyone on the server.
struct GeneralSettingsView: View {
    @State private var settings: OrganizationSettings?
    @State private var name: String
    @State private var loading = true
    @State private var saving = false
    @State private var error: String?
    @State private var pickerItem: PhotosPickerItem?
    @State private var importing = false
    @State private var iconHovered = false
    @FocusState private var nameFocused: Bool

    init() {
        let cached: OrganizationSettings? = SettingsCache.value("organization-settings")
        _settings = State(initialValue: cached)
        _name = State(initialValue: cached?.organizationName ?? "")
    }

    var body: some View {
        List {
            if loading, settings == nil {
                settingsLoadingRow
            } else {
                if let error { settingsErrorRow(error) { Task { await load() } } }
                Section {
                    LabeledContent {
                        HStack(spacing: 12) {
                            VStack(alignment: .trailing, spacing: 4) {
                                if settings?.organizationIconUrl != nil {
                                    Button("Remove icon", role: .destructive) {
                                        Task { await removeIcon() }
                                    }
                                    .disabled(saving)
                                }
                            }
                            organizationIconPicker
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Organization icon")
                            Text("Choose a square image that represents your organization.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    LabeledContent("Organization name") {
                        TextField("Open Session", text: $name)
                            .multilineTextAlignment(.trailing)
                            .disableAutocorrection(true)
                            .focused($nameFocused)
                            .disabled(saving)
                            .onSubmit { nameFocused = false }
                    }
                } footer: {
                    Text("Shared by everyone in this workspace. Clearing the name restores the product name.")
                }
            }
        }
        .insetGroupedListCompat()
        .navigationTitle("General")
        .task { await load() }
        .refreshable { await load() }
        .onChange(of: nameFocused) { wasFocused, isFocused in
            guard wasFocused, !isFocused else { return }
            Task { await commitName() }
        }
    }

    private var organizationIcon: some View {
        Group {
            if let url = iconURL,
               let image = RepoImageCache.shared.images[url.absoluteString] {
                image
                    .resizable()
                    .scaledToFill()
            } else {
                Text(organizationInitials)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(RepoTilePalette.ink)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(RepoTilePalette.shared.fill(for: organizationName))
            }
        }
        .frame(width: 56, height: 56)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay {
            ZStack {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(OS1VisualStyle.border, lineWidth: 0.5)
                if iconHovered {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(.black.opacity(0.5))
                    Image(systemName: "arrow.up.to.line")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white)
                }
            }
        }
        .onHover { iconHovered = $0 }
        .task(id: iconURL?.absoluteString) {
            if let iconURL { RepoImageCache.shared.ensureLoaded(iconURL) }
        }
    }

    private var organizationName: String {
        let name = settings?.organizationName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? "Organization" : name
    }

    private var organizationInitials: String {
        let parts = organizationName.split(whereSeparator: \.isWhitespace)
        guard let first = parts.first else { return "O" }
        if let last = parts.dropFirst().last {
            return "\(first.prefix(1))\(last.prefix(1))".uppercased()
        }
        return String(first.prefix(2)).uppercased()
    }

    @ViewBuilder
    private var organizationIconPicker: some View {
        #if os(iOS)
        PhotosPicker(selection: $pickerItem, matching: .images) {
            organizationIcon
        }
        .buttonStyle(.plain)
        .accessibilityLabel(settings?.organizationIconUrl == nil ? "Choose icon" : "Choose another icon")
        .disabled(saving)
        .onChange(of: pickerItem) {
            guard let item = pickerItem else { return }
            pickerItem = nil
            Task {
                guard let data = try? await item.loadTransferable(type: Data.self) else { return }
                await upload(data)
            }
        }
        #else
        Button {
            importing = true
        } label: {
            organizationIcon
        }
        .buttonStyle(.plain)
        .accessibilityLabel(settings?.organizationIconUrl == nil ? "Choose icon" : "Choose another icon")
        .disabled(saving)
        .fileImporter(isPresented: $importing, allowedContentTypes: [.image]) { result in
            guard case .success(let url) = result else { return }
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            guard let data = try? Data(contentsOf: url) else { return }
            Task { await upload(data) }
        }
        #endif
    }

    private var iconURL: URL? {
        SettingsAPI.organizationIconURL(settings?.organizationIconUrl)
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            apply(try await SettingsAPI.organizationSettings())
            error = nil
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func apply(_ next: OrganizationSettings) {
        settings = next
        if !nameFocused { name = next.organizationName ?? "" }
        SettingsCache.save("organization-settings", next)
    }

    private func commitName() async {
        let value = name.trimmingCharacters(in: .whitespaces)
        guard value != (settings?.organizationName ?? ""), !saving else { return }
        await save { try await SettingsAPI.saveOrganizationSettings(["organizationName": value]) }
    }

    private func upload(_ raw: Data) async {
        guard let png = SettingsIconImage.squarePNG(raw) else {
            error = "That image couldn’t be read."
            return
        }
        await save { try await SettingsAPI.uploadOrganizationIcon(png) }
    }

    private func removeIcon() async {
        await save { try await SettingsAPI.removeOrganizationIcon() }
    }

    private func save(_ work: () async throws -> OrganizationSettings) async {
        guard !saving else { return }
        saving = true
        defer { saving = false }
        do {
            apply(try await work())
            error = nil
        } catch {
            self.error = error.localizedDescription
            name = settings?.organizationName ?? ""
        }
    }
}
