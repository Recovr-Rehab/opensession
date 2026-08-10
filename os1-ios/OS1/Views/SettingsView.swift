import SwiftUI

struct SettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL

    @State private var config = ServerConfig.shared
    @State private var showingConnection = !ServerConfig.shared.isConfigured
    @State private var serverURL = ServerConfig.shared.baseURLString
    @State private var userName = ServerConfig.shared.userName
    @State private var token = ServerConfig.shared.token
    @State private var checkResult: String?
    @State private var copiedCode = false
    @State private var confirmingSignOut = false

    private var signIn: GitHubSignIn { .shared }

    private var signedInLogin: String? {
        let login = config.githubLogin
        return login.isEmpty || token.isEmpty ? nil : login
    }

    var body: some View {
        NavigationStack {
            Group {
                if showingConnection || !config.isConfigured {
                    connectionForm
                } else {
                    settingsHome
                }
            }
            .navigationTitle(showingConnection || !config.isConfigured ? "Connection" : "Settings")
            .inlineTitleBarCompat()
            #if os(macOS)
            .frame(minWidth: 620, minHeight: 640)
            #endif
            .toolbar { toolbar }
            .onAppear { signIn.nudge() }
            .onChange(of: signIn.flow?.deviceCode) { _, deviceCode in
                copiedCode = false
                if deviceCode == nil, config.token != token {
                    token = config.token
                    userName = config.userName
                    checkResult = nil
                    if config.isConfigured { showingConnection = false }
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .settingsAuthenticationExpired)) { _ in
                config.token = ""
                token = ""
                SettingsCache.clear()
                checkResult = "Your session expired. Sign in again to continue."
                showingConnection = true
            }
        }
    }

    private var settingsHome: some View {
        List {
            // Groups mirror the web nav (src/frontend/components/Settings.tsx):
            // what one person owns first, then what the whole instance does.
            Section("Personal") {
                settingsLink("My accounts", icon: "person.crop.circle") {
                    MyAccountsSettingsView()
                }
                settingsLink("Preferences", icon: "slider.horizontal.3") {
                    PreferencesSettingsView()
                }
                settingsLink("Notifications", icon: "bell") {
                    NotificationsSettingsView()
                }
                settingsLink("Shortcuts", icon: "sparkles") {
                    ShortcutsSettingsView()
                }
                settingsLink("Appearance", icon: "circle.lefthalf.filled") {
                    AppearanceSettingsView()
                }
            }

            Section("Workspace") {
                settingsLink("Models", icon: "square.grid.2x2") {
                    ModelsSettingsView()
                }
                settingsLink("Connections", icon: "point.3.connected.trianglepath.dotted") {
                    ConnectionsSettingsView()
                }
                settingsLink("Memory", icon: "brain") {
                    MemorySettingsView()
                }
                settingsLink("Setup", icon: "checklist") {
                    SetupSettingsView()
                }
                settingsLink("Repositories", icon: "shippingbox") {
                    RepositoriesSettingsView()
                }
            }

            Section("Automation") {
                settingsLink("Automations", icon: "clock.arrow.circlepath") {
                    AutomationSettingsView()
                }
                settingsLink("Goals", icon: "target") {
                    GoalSettingsView()
                }
                settingsLink("Actions", icon: "bolt") {
                    ActionSettingsView()
                }
                settingsLink("Security", icon: "checkmark.shield") {
                    SecuritySettingsView()
                }
            }

            Section("Infrastructure") {
                settingsLink("Prewarming", icon: "flame") {
                    PrewarmingSettingsView()
                }
            }

            Section("Activity") {
                settingsLink("Papercuts", icon: "bandage") {
                    PapercutsSettingsView()
                }
                settingsLink("Audit log", icon: "list.bullet.rectangle") {
                    AuditLogSettingsView()
                }
            }

            // Last card, as in the web settings sheet: who your sessions act
            // as, and the way out.
            Section("Account") {
                // Tappable, not a label: the two things people come here to
                // change — which GitHub account they are signed in as, and the
                // name their prompts carry — both live in the connection form,
                // and an inert identity row reads as "this can't be changed".
                Button {
                    showingConnection = true
                } label: {
                    HStack(spacing: 12) {
                        UserAvatar(size: 34)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(config.userName)
                                .font(.body.weight(.medium))
                                .foregroundStyle(OS1VisualStyle.text)
                            Text(accountSubtitle)
                                .font(.footnote)
                                .foregroundStyle(Color.secondary)
                        }
                        Spacer(minLength: 12)
                        Image(systemName: "chevron.forward")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Color.secondary.opacity(0.55))
                    }
                }
                .padding(.vertical, 2)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Account, \(config.userName), \(accountSubtitle)")
                .accessibilityHint("Change your name or GitHub account")

                // The connection form used to hang off a toolbar button in the
                // top-left corner, which read as navigation rather than as a
                // setting. It is one: a row, next to the identity it belongs to.
                Button {
                    showingConnection = true
                } label: {
                    HStack {
                        Label {
                            Text("Server")
                                .foregroundStyle(OS1VisualStyle.text)
                        } icon: {
                            Image(systemName: "server.rack")
                                .symbolRenderingMode(.monochrome)
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundStyle(OS1VisualStyle.iconTint)
                                .frame(width: 28, height: 28)
                        }
                        Spacer(minLength: 12)
                        // Explicit colours, not `.secondary`: inside a button
                        // the hierarchical styles resolve against the tint,
                        // and the value would read as a teal link rather than
                        // as the detail text every other settings app uses.
                        Text(serverHost)
                            .font(.subheadline)
                            .foregroundStyle(Color.secondary)
                            .lineLimit(1)
                            .truncationMode(.head)
                        // A plain button gets no disclosure of its own, and
                        // without one the row doesn't look like it goes
                        // anywhere — the rest of this list does.
                        Image(systemName: "chevron.forward")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(Color.secondary.opacity(0.55))
                    }
                }

                Button(role: .destructive) {
                    confirmingSignOut = true
                } label: {
                    Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right")
                }
                // On the button, not the list: the popover form of a
                // confirmation dialog points at whatever it is attached to.
                .confirmationDialog(
                    "Sign out?",
                    isPresented: $confirmingSignOut,
                    titleVisibility: .visible
                ) {
                    Button("Sign out", role: .destructive) { signOut() }
                    Button("Cancel", role: .cancel) {}
                } message: {
                    Text("This device forgets its token. Your sessions keep running on the server.")
                }
            }
        }
        .insetGroupedListCompat()
    }

    /// How the current identity was decided — the same two modes the web
    /// account card distinguishes.
    private var accountSubtitle: String {
        if let signedInLogin {
            return "Signed in with GitHub · @\(signedInLogin)"
        }
        return "Signed in with a session token"
    }

    /// The host alone: the row is narrow, and the scheme is the least
    /// interesting part of "which server am I talking to".
    private var serverHost: String {
        let raw = config.baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
        if let host = URL(string: raw)?.host, !host.isEmpty { return host }
        return raw.isEmpty ? "Not set" : raw
    }

    private func settingsLink<Destination: View>(
        _ title: String,
        icon: String,
        @ViewBuilder destination: () -> Destination
    ) -> some View {
        NavigationLink {
            destination()
        } label: {
            Label {
                Text(title)
                    .foregroundStyle(OS1VisualStyle.text)
            } icon: {
                // Without the tile the glyph carries the row on its own, so it
                // trades size for weight — smaller than the title beside it,
                // heavier than it — which lets the icon column stay neutral
                // (see `iconTint`) and still read as a column rather than as
                // dimmer text.
                Image(systemName: icon)
                    .symbolRenderingMode(.monochrome)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(OS1VisualStyle.iconTint)
                    .frame(width: 28, height: 28)
            }
        }
    }

    private var connectionForm: some View {
        Form {
            Section("Server") {
                TextField("https://sessions.example.com", text: $serverURL)
                    .urlFieldCompat()
                    .autocorrectionDisabled()
            }

            Section {
                if let flow = signIn.flow {
                    signInFlow(flow)
                } else if let signedInLogin {
                    HStack {
                        Label("Signed in as @\(signedInLogin)", systemImage: "checkmark.seal")
                        Spacer()
                        Button("Sign out", role: .destructive) { signOut() }
                    }
                    // Signing in again replaces the token outright, so
                    // switching accounts needs no sign-out first — and asking
                    // for one is what made "change my account" feel like a
                    // dead end.
                    Button {
                        startSignIn()
                    } label: {
                        Label(
                            signIn.starting ? "Starting…" : "Switch GitHub account",
                            systemImage: "arrow.trianglehead.2.clockwise.rotate.90"
                        )
                    }
                    .disabled(signIn.starting)
                } else {
                    Button {
                        startSignIn()
                    } label: {
                        Label(
                            signIn.starting ? "Starting…" : "Sign in with GitHub",
                            systemImage: "person.badge.key"
                        )
                    }
                    .disabled(signIn.starting)
                }
                if let signInError = signIn.error {
                    Text(signInError)
                        .font(.footnote)
                        .foregroundStyle(.red)
                }
                SecureField("Bearer token (or paste one manually)", text: $token)
                    .autocorrectionDisabled()
                    .noAutocapitalizationCompat()
            } header: {
                Text("Authentication")
            } footer: {
                Text("Sign in with GitHub, or paste a session token. The token is stored in the keychain.")
            }

            if !signIn.diagnostics.isEmpty {
                Section("Sign-in log") {
                    ForEach(
                        Array(signIn.diagnostics.suffix(15).reversed().enumerated()),
                        id: \.offset
                    ) { _, line in
                        Text(line)
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                    }
                }
            }

            Section("Identity") {
                TextField("Name shown on your prompts", text: $userName)
                    .autocorrectionDisabled()
            }

            Section {
                Button("Test connection") {
                    Task { await testConnection() }
                }
                if let checkResult {
                    Text(checkResult)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
        }
        #if os(iOS)
        .scrollContentBackground(.hidden)
        .background(OS1VisualStyle.background)
        #else
        .formStyle(.grouped)
        #endif
    }

    @ViewBuilder
    private func signInFlow(_ flow: GitHubAuth.DeviceFlowStart) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Enter this code on GitHub:")
                .font(.footnote)
                .foregroundStyle(.secondary)
            Button {
                copyToPasteboard(flow.userCode)
                copiedCode = true
            } label: {
                Text(flow.userCode)
                    .font(.system(.title, design: .monospaced).bold())
                    .foregroundStyle(.primary)
                    .frame(maxWidth: .infinity)
            }
            Text(copiedCode ? "Copied — paste it on GitHub." : "Tap the code to copy it.")
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .frame(maxWidth: .infinity)
            if let url = URL(string: flow.verificationUri) {
                Button("Copy code and open GitHub") {
                    copyToPasteboard(flow.userCode)
                    copiedCode = true
                    openURL(url)
                }
            }
            HStack(spacing: 8) {
                ProgressView()
                Text("Waiting for approval…")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Spacer()
                Button("Cancel", role: .cancel) { signIn.cancel() }
            }
            if let at = signIn.lastPollAt {
                Text("Checked \(at.formatted(date: .omitted, time: .standard)) — \(signIn.lastPollNote ?? "")")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(.vertical, 4)
        .buttonStyle(.borderless)
    }

    @ToolbarContentBuilder
    private var toolbar: some ToolbarContent {
        if showingConnection || !config.isConfigured {
            ToolbarItem(placement: .confirmationAction) {
                Button("Save") {
                    save()
                    if config.isConfigured { showingConnection = false }
                }
            }
            ToolbarItem(placement: .cancellationAction) {
                Button(config.isConfigured ? "Back" : "Cancel") {
                    if config.isConfigured {
                        showingConnection = false
                    } else {
                        dismiss()
                    }
                }
            }
        } else {
            ToolbarItem(placement: .confirmationAction) {
                #if os(iOS)
                    // A glyph, not the word: the sheet's only exit reads faster
                    // as a checkmark, and the accent tint is what marks it as
                    // the confirming action.
                    Button {
                        dismiss()
                    } label: {
                        Label("Done", systemImage: "checkmark")
                            .labelStyle(.iconOnly)
                            .font(.body.weight(.semibold))
                    }
                    .tint(OS1VisualStyle.accent)
                #else
                    Button("Done") { dismiss() }
                #endif
            }
        }
    }

    private func startSignIn() {
        config.baseURLString = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        signIn.start()
    }

    private func signOut() {
        Task {
            try? await OS1API.logout()
            config.token = ""
            token = ""
            // Nothing cached outlives the account it was fetched for.
            SettingsCache.clear()
            showingConnection = true
        }
    }

    private func save() {
        config.baseURLString = serverURL.trimmingCharacters(in: .whitespacesAndNewlines)
        config.userName = userName.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmedToken != config.token { config.githubLogin = "" }
        config.token = trimmedToken
    }

    private func testConnection() async {
        save()
        do {
            _ = try await OS1API.health()
            _ = try await OS1API.sessions()
            checkResult = "Connected — auth OK."
        } catch {
            checkResult = await Reachability.describe(error)
        }
    }
}
