import AppIntents
import SwiftUI

// Native personal settings use the same server preference keys as the web app
// where a preference follows a person between devices. Device alerts stay local.

struct NotificationsSettingsView: View {
    @AppStorage("os1.notifications.pushAlerts") private var pushAlerts = false
    @AppStorage("os1.notifications.completionSound") private var completionSound = "default"
    @AppStorage("os1.notifications.whenToNotify") private var whenToNotify = "background"
    @AppStorage("os1.notifications.needsInput") private var needsInputAlerts = true
    @AppStorage("os1.notifications.runComplete") private var runCompleteAlerts = true

    var body: some View {
        Form {
            Section {
                Toggle("Push alerts on this device", isOn: $pushAlerts)
                Picker("Completion sound", selection: $completionSound) {
                    Text("Default").tag("default")
                    Text("None").tag("none")
                }
                Picker("When to notify", selection: $whenToNotify) {
                    Text("Always").tag("always")
                    Text("When OS1 is in the background").tag("background")
                    Text("Never").tag("never")
                }
            } header: {
                Text("Alerts")
            } footer: {
                Text("These alert preferences apply only to this native OS1 app and device.")
            }

            Section("Events") {
                Toggle("Session needs input", isOn: $needsInputAlerts)
                Toggle("Session run completes", isOn: $runCompleteAlerts)
            }
        }
        .navigationTitle("Notifications")
        .onChange(of: pushAlerts) { _, enabled in
            guard enabled else { return }
            Task {
                if !(await NativeNotifications.requestAuthorization()) {
                    pushAlerts = false
                }
            }
        }
    }
}

/// Everything about how you work with a session: the message box, what a
/// follow-up does mid-run, how much of a turn the transcript shows, voice, and
/// the standing prompt. All server-side per-user prefs, so it matches the web
/// (Settings → Preferences). Appearance next door is only what this device
/// looks like. The `os1.*` AppStorage keys stay under their original names —
/// they are the offline cache, not a user-facing label.
struct PreferencesSettingsView: View {
    @AppStorage("os1.composer.defaultModel") private var nativeDefaultModel = ""
    @AppStorage("os1.composer.sendKey") private var nativeSendKey = "enter"
    @AppStorage("os1.composer.busySend") private var nativeBusySend = "queue"
    @AppStorage("os1.composer.busySendMod") private var nativeBusySendMod = "steer"
    @AppStorage("os1.appearance.turnActivity") private var nativeTurnActivity = "messages"
    @AppStorage("os1.desk.voice") private var deskVoice = "off"

    @State private var models: [SettingsModelOption]
    @State private var defaultModel: String
    @State private var sendKey: String
    @State private var busySend: String
    @State private var busySendMod: String
    @State private var turnActivity: String
    @State private var loading = true
    @State private var saving = false
    @State private var resaveNeeded = false
    @State private var error: String?
    @State private var savedPrefs: [String: String] = [:]
    @State private var prefsLoaded = false
    /// What the controls were seeded with. A control still sitting on its seed
    /// when the fetch lands adopts the server's value; one the reader has
    /// already moved keeps their choice, and `commit()` pushes it.
    @State private var seededPrefs: [String: String]

    /// Opens on the values this device already holds — the same `os1.*`
    /// mirrors the composer reads, kept current by `NativePreferences` — so
    /// the screen is the settings rather than a spinner in front of them. The
    /// fetch still runs; it corrects rather than reveals. Writing back is
    /// unaffected: `commit()` waits for `prefsLoaded`, so nothing is saved
    /// against a baseline the server has not confirmed.
    init() {
        let defaults = UserDefaults.standard
        let seeded: [String: String] = [
            "default-model": defaults.string(forKey: "os1.composer.defaultModel") ?? "",
            "send-key": defaults.string(forKey: "os1.composer.sendKey") ?? "enter",
            "busy-send": defaults.string(forKey: "os1.composer.busySend") ?? "queue",
            "busy-send-mod": defaults.string(forKey: "os1.composer.busySendMod") ?? "steer",
            "turn-activity": defaults.string(forKey: "os1.appearance.turnActivity") ?? "messages",
        ]
        _seededPrefs = State(initialValue: seeded)
        _defaultModel = State(initialValue: seeded["default-model"] ?? "")
        _sendKey = State(initialValue: seeded["send-key"] ?? "enter")
        _busySend = State(initialValue: seeded["busy-send"] ?? "queue")
        _busySendMod = State(initialValue: seeded["busy-send-mod"] ?? "steer")
        _turnActivity = State(initialValue: seeded["turn-activity"] ?? "messages")
        _models = State(initialValue: SettingsCache.value("model-catalog", as: ModelCatalogSettings.self)?.models ?? [])
    }

    private var selectableModels: [SettingsModelOption] {
        models.filter { $0.id?.isEmpty == false }
    }

    var body: some View {
        Form {
            if let error {
                Section {
                    Text(error)
                        .foregroundStyle(.red)
                    Button("Try again") { Task { await load() } }
                }
            }

            Section {
                // The catalog is the one thing here with no local mirror to
                // open on, so on a first visit this row waits and the rest of
                // the screen does not.
                if selectableModels.isEmpty, loading {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Loading models…").foregroundStyle(.secondary)
                    }
                } else {
                    Picker("Default model", selection: $defaultModel) {
                        Text("No preference").tag("")
                        ForEach(selectableModels, id: \.id) { model in
                            Text(model.label ?? model.id ?? "Model").tag(model.id ?? "")
                        }
                    }
                }
            } header: {
                Text("New sessions")
            } footer: {
                Text("New sessions use this model when available. No preference uses the workspace default.")
            }

            Section {
                #if os(macOS)
                Picker("Send messages with", selection: $sendKey) {
                    Text("Enter").tag("enter")
                    Text("Command/Control-Enter").tag("mod-enter")
                }
                #else
                LabeledContent("Send messages with", value: "Return")
                #endif
                Picker("Send button while busy", selection: $busySend) {
                    Text("Queue for later").tag("queue")
                    Text("Steer the current run").tag("steer")
                }
                #if os(macOS)
                if sendKey == "enter" {
                    Picker("Command/Control-Enter while busy", selection: $busySendMod) {
                        Text("Queue for later").tag("queue")
                        Text("Steer the current run").tag("steer")
                    }
                }
                #endif
            } header: {
                Text("Sending")
            } footer: {
                // The setting is only the default: the other verb is
                // always one gesture away, and this is the only place
                // that says so.
                #if os(macOS)
                Text("Queued messages wait until the agent has fully finished; steering folds them into the running turn at its next step. Hold the send button to use the other one for a single message.")
                #else
                Text("Queued messages wait until the agent has fully finished; steering folds them into the running turn at its next step. Touch and hold the send button to use the other one for a single message.")
                #endif
            }

            Section {
                Picker("Tool calls and messages", selection: $turnActivity) {
                    Text("Fold tool calls").tag("messages")
                    Text("Fold everything").tag("collapsed")
                    Text("Expand while running").tag("auto")
                    Text("Always expanded").tag("expanded")
                }
            } header: {
                Text("Transcript")
            } footer: {
                Text("How each turn's working folds in a session. By default the turn's in-between messages read as normal transcript and only its tool calls fold away. Expanding a turn does not open its individual tool inputs.")
            }

            Section {
                Toggle("Desk voice", isOn: Binding(
                    get: { deskVoice == "on" },
                    set: { enabled in
                        deskVoice = enabled ? "on" : "off"
                        pushDeskVoice(enabled)
                    }
                ))
            } footer: {
                Text("Talk to your Desk with a live voice call. Uses the server's OpenAI key.")
            }
            PersonalPromptSection()
        }
        .navigationTitle("Preferences")
        .task { await load() }
        .onChange(of: defaultModel) { _, _ in commit() }
        .onChange(of: sendKey) { _, _ in commit() }
        .onChange(of: busySend) { _, _ in commit() }
        .onChange(of: busySendMod) { _, _ in commit() }
        .onChange(of: turnActivity) { _, _ in commit() }
        .onDisappear { commit() }
    }

    /// Fire-and-forget: the toggle already reflects locally via `@AppStorage`,
    /// this just lets other devices pick it up.
    private func pushDeskVoice(_ enabled: Bool) {
        let user = NativePreferences.context().user
        Task {
            _ = try? await SettingsAPI.updateUiPrefs(
                user: user,
                prefs: ["desk-voice": enabled ? "on" : "off"]
            )
        }
    }

    /// Every control writes through on change — there is no Save button, so
    /// leaving the screen is only a backstop for a request still in flight.
    /// A change made mid-save queues behind it rather than racing it.
    private func commit() {
        guard prefsLoaded, !loading, currentPrefs != savedPrefs else { return }
        guard !saving else { resaveNeeded = true; return }
        Task { await save() }
    }

    private func load() async {
        loading = true
        error = nil
        prefsLoaded = false
        do {
            let requestContext = NativePreferences.context()
            let prefs = try await SettingsAPI.uiPrefs(user: requestContext.user)
            guard NativePreferences.context() == requestContext else { loading = false; return }
            let server: [String: String] = [
                "default-model": prefs["default-model"] ?? nativeDefaultModel,
                "send-key": prefs["send-key"] == "mod-enter" ? "mod-enter" : "enter",
                "busy-send": prefs["busy-send"] == "steer" ? "steer" : "queue",
                "busy-send-mod": prefs["busy-send-mod"] == "queue" ? "queue" : "steer",
                // Unset (or an unknown value from a newer client) keeps
                // whatever this device last saw rather than snapping the
                // picker to a default the account never chose.
                "turn-activity": Self.validTurnActivity(prefs["turn-activity"]) ?? nativeTurnActivity,
            ]
            // The screen was already usable while this was in flight, so a
            // control the reader moved in the meantime keeps their choice —
            // only the ones still sitting on their seed adopt the server's.
            // The `commit()` below then pushes whatever they changed.
            if defaultModel == seededPrefs["default-model"] { defaultModel = server["default-model"] ?? defaultModel }
            if sendKey == seededPrefs["send-key"] { sendKey = server["send-key"] ?? sendKey }
            if busySend == seededPrefs["busy-send"] { busySend = server["busy-send"] ?? busySend }
            if busySendMod == seededPrefs["busy-send-mod"] { busySendMod = server["busy-send-mod"] ?? busySendMod }
            if turnActivity == seededPrefs["turn-activity"] { turnActivity = server["turn-activity"] ?? turnActivity }
            seededPrefs = server
            #if os(macOS)
            nativeSendKey = sendKey
            #endif
            nativeBusySend = busySend
            nativeBusySendMod = busySendMod
            nativeTurnActivity = turnActivity
            savedPrefs = server
            prefsLoaded = true
        } catch {
            self.error = error.localizedDescription
        }
        do {
            let catalog = try await SettingsAPI.modelCatalog()
            models = catalog.models ?? []
            SettingsCache.save("model-catalog", catalog)
        } catch {
            if self.error == nil { self.error = error.localizedDescription }
        }
        loading = false
        commit()
    }

    private func save() async {
        saving = true
        error = nil
        do {
            let current = currentPrefs
            var patch: [String: String?] = [:]
            for (key, value) in current where savedPrefs[key] != value {
                patch[key] = value
            }
            guard !patch.isEmpty else { saving = false; resaveNeeded = false; return }
            let requestContext = NativePreferences.context()
            let response = try await SettingsAPI.updateUiPrefs(user: requestContext.user, prefs: patch)
            var confirmed = savedPrefs
            for (key, value) in current where patch.keys.contains(key) { confirmed[key] = value }
            confirmed.merge(response) { _, server in server }
            guard NativePreferences.apply(confirmed, for: requestContext) else {
                self.error = "Connection changed before preferences finished saving."
                saving = false
                return
            }
            defaultModel = confirmed["default-model"] ?? defaultModel
            sendKey = confirmed["send-key"] == "mod-enter" ? "mod-enter" : "enter"
            busySend = confirmed["busy-send"] == "steer" ? "steer" : "queue"
            busySendMod = confirmed["busy-send-mod"] == "queue" ? "queue" : "steer"
            turnActivity = Self.validTurnActivity(confirmed["turn-activity"]) ?? turnActivity
            nativeDefaultModel = defaultModel
            #if os(macOS)
            nativeSendKey = sendKey
            #endif
            nativeBusySend = busySend
            nativeBusySendMod = busySendMod
            nativeTurnActivity = turnActivity
            savedPrefs = confirmed
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
        if resaveNeeded {
            resaveNeeded = false
            commit()
        }
    }

    private var currentPrefs: [String: String] {
        [
            "default-model": defaultModel,
            "send-key": sendKey,
            "busy-send": busySend,
            "busy-send-mod": busySendMod,
            "turn-activity": turnActivity,
        ]
    }

    private static func validTurnActivity(_ value: String?) -> String? {
        ["messages", "auto", "expanded", "collapsed"].contains(value) ? value : nil
    }
}

/// Only what this device looks like. How much of a session you see, and every
/// other per-account choice, lives in Preferences — same split as the web.
struct AppearanceSettingsView: View {
    @AppStorage("os1.appearance") private var appearance = "system"

    var body: some View {
        Form {
            Section {
                Picker("Appearance", selection: $appearance) {
                    Text("System").tag("system")
                    Text("Light").tag("light")
                    Text("Dark").tag("dark")
                }
            } header: {
                Text("Theme")
            } footer: {
                Text("The selected native appearance is stored on this device.")
            }
        }
        .navigationTitle("Appearance")
    }
}

/// The standing prompt, shown inside Preferences. There is no Save button: it
/// commits when the box loses focus and again when the screen goes away, so
/// leaving keeps your edit — same contract as the web.
struct PersonalPromptSection: View {
    @State private var prompt: String
    @State private var savedPrompt: String
    @State private var loading: Bool
    @State private var error: String?
    @FocusState private var editing: Bool

    private let user = ServerConfig.shared.userName

    /// Opens on the last prompt this device fetched, so the box holds text
    /// immediately instead of a spinner. `savedPrompt` starts at the same
    /// value, so a screen that is only looked at never sends anything.
    init() {
        let cached: String? = SettingsCache.value("personal-prompt")
        _prompt = State(initialValue: cached ?? "")
        _savedPrompt = State(initialValue: cached ?? "")
        _loading = State(initialValue: cached == nil)
    }

    var body: some View {
        Section {
            if loading {
                ProgressView()
            } else if let error {
                Text(error).foregroundStyle(.red)
                Button("Try again") { Task { await load() } }
            } else {
                TextEditor(text: $prompt)
                    .frame(minHeight: 140)
                    .focused($editing)
            }
        } header: {
            Text("Personal prompt")
        } footer: {
            Text("Standing instructions added to every session you start, on top of the built-in ones. Saved when you leave this screen; empty turns it off.")
        }
        .task { await load() }
        .onChange(of: editing) { _, focused in if !focused { commit() } }
        .onDisappear { commit() }
    }

    /// Fire-and-forget — by the time this runs the view may already be gone,
    /// so there is nothing to report a result to. `savedPrompt` moves first so
    /// a blur followed by a disappear doesn't send the same body twice.
    private func commit() {
        guard !loading, prompt != savedPrompt else { return }
        let pending = prompt
        savedPrompt = pending
        SettingsCache.save("personal-prompt", pending)
        Task { _ = try? await SettingsAPI.setPersonalPrompt(user: user, prompt: pending) }
    }

    private func load() async {
        error = nil
        do {
            let result = try await SettingsAPI.personalPrompt(user: user)
            // An edit made while this was in flight wins — the cached text it
            // was typed over is what `savedPrompt` still holds, so `commit()`
            // sends it when the box loses focus.
            if prompt == savedPrompt { prompt = result }
            savedPrompt = result
            SettingsCache.save("personal-prompt", result)
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }
}

/// Where "Start an Agent" is explained and handed over to the system.
///
/// It needs no setup — an `AppShortcutsProvider` registers it the moment the
/// app is installed (see `AgentShortcuts`), and the widgets ship with it — but
/// nothing in the app ever SAYS that, and the steps that are a person's to
/// take (placing a widget, binding the Action Button, which only iOS Settings
/// can do) happen outside OS1 entirely. So this page is mostly signposting:
/// what the shortcut does, where its widgets live, a `ShortcutsLink` into the
/// Shortcuts app, and the paths Apple gives no deep link for.
struct ShortcutsSettingsView: View {
    var body: some View {
        Form {
            Section {
                shortcut(
                    icon: "mic",
                    title: "Start an Agent",
                    detail: """
                    Opens the composer with the mic listening, so you can speak \
                    the idea and still change repo, mode or model before sending.
                    """
                )
            } footer: {
                // No section header: the navigation title above already says
                // "Shortcuts", and repeating it just pushed the first row down.
                Text("Installed with the app — no setup needed. Ask Siri for it by name, or find it under OS1 in the Shortcuts app.")
            }

            #if os(iOS)
            Section {
                shortcut(
                    icon: "square.grid.2x2",
                    title: "Home Screen and Lock Screen",
                    detail: """
                    Add the OS1 widget and the whole tile becomes the same \
                    press.
                    """
                )
                shortcut(
                    icon: "switch.2",
                    title: "Control Centre",
                    detail: """
                    Swipe down, +, Add a Control, then OS1 — and the Action \
                    Button's picker lists it under Controls too.
                    """
                )
            } header: {
                Text("Widgets")
            } footer: {
                Text("The widgets run the same shortcut, so they open the composer with the mic listening. They show no session data and work offline.")
            }
            #endif

            Section {
                #if os(iOS)
                // The system's own button into the Shortcuts app, opened on
                // this app's shortcuts. macOS has no such view, so it gets an
                // ordinary button on the Shortcuts app's URL scheme.
                ShortcutsLink()
                    .shortcutsLinkStyle(.automaticOutline)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .listRowBackground(Color.clear)
                #else
                Button("Open Shortcuts") {
                    if let url = URL(string: "shortcuts://") {
                        NSWorkspace.shared.open(url)
                    }
                }
                #endif
            } footer: {
                #if os(iOS)
                Text("To put it on the Action Button: iPhone Settings → Action Button → swipe to Shortcut → Choose a Shortcut → OS1 → Start an Agent.")
                #else
                Text("Run it from Spotlight, or say it to Siri.")
                #endif
            }
        }
        .navigationTitle("Shortcuts")
        #if os(iOS)
        .scrollContentBackground(.hidden)
        .background(OS1VisualStyle.background)
        #else
        .formStyle(.grouped)
        #endif
    }

    private func shortcut(icon: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(OS1VisualStyle.accent)
                .frame(width: 26, height: 26)
                .background(OS1VisualStyle.hover, in: Circle())
                // Optically centred on the title's cap height rather than the
                // text block, which the multi-line detail below would drag down.
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                Text(detail)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.vertical, 2)
    }
}

/// Settings → Personal → My accounts: every per-user sign-in in one place.
///
/// The web has had this page since per-user grants landed; the native app
/// shipped without it, so a phone could see which tools the workspace was
/// wired into but not connect its own account to any of them. Same two halves
/// as the web (src/frontend/components/MyAccounts.tsx): OAuth-capable MCP
/// servers, and the per-user GitHub auth that opens PRs under your own name.
///
/// A row states what the tool is authenticated as and nothing more — the
/// sentence about what connecting changes is identical on every unconnected
/// row, so it lives once in the section footer.
struct MyAccountsSettingsView: View {
    @State private var connections: ConnectionsResponse? = SettingsCache.value("connections")
    @State private var oauth: [String: MCPOauthStatus] = [:]
    @State private var github: GitHubConnectionStatus? = SettingsCache.value("github-connection")
    @State private var loading = true
    @State private var error: String?
    @State private var busyServer: String?
    @State private var disconnecting: String?
    @State private var githubFlow: GitHubDeviceFlow?
    @State private var githubTask: Task<Void, Never>?
    @State private var pollTask: Task<Void, Never>?
    #if os(iOS)
    @State private var consent: SafariLink?
    #endif
    @Environment(\.openURL) private var openURL

    var body: some View {
        List {
            if loading, connections == nil {
                HStack { Spacer(); ProgressView("Loading…"); Spacer() }
            }
            if let error {
                VStack(alignment: .leading, spacing: 8) {
                    Text(error).foregroundStyle(.red)
                    Button("Retry") { Task { await load() } }
                }
            }

            Section {
                if oauthServers.isEmpty, !loading {
                    Text("No OAuth-capable MCP servers yet.").foregroundStyle(.secondary)
                }
                ForEach(oauthServers, id: \.id) { server in
                    accountRow(server)
                }
            } header: {
                Text("MCP accounts — tools as yourself")
            } footer: {
                Text("Connect one and your sessions use your own account for that tool. Anything you leave unconnected keeps running on the workspace credential.")
            }

            Section {
                githubRows
            } header: {
                Text("GitHub — PRs as yourself")
            } footer: {
                Text("Interactive sessions of a connected teammate open PRs as their own GitHub account. Everyone else, and every automation, keeps the bot.")
            }
        }
        .insetGroupedListCompat()
        .navigationTitle("My accounts")
        .task { await load() }
        .refreshable { await load() }
        .onDisappear { pollTask?.cancel(); githubTask?.cancel() }
        #if os(iOS)
        // The provider's consent page opens over the app: coming back is a
        // swipe, and the poll below flips the row the moment the grant lands.
        .sheet(item: $consent) { link in SafariSheet(url: link.url) }
        #endif
        .sheet(isPresented: Binding(
            get: { githubFlow != nil },
            set: { if !$0 { cancelGitHubConnect() } }
        )) {
            if let githubFlow {
                GitHubConnectionFlowView(flow: githubFlow, onCancel: cancelGitHubConnect)
            }
        }
    }

    // MARK: - Rows

    private func accountRow(_ server: MCPConnection) -> some View {
        let name = server.name ?? ""
        let status = oauth[name]
        let mine = isMine(status)
        return HStack(spacing: 12) {
            BrandTile(name: name, size: 30)
            VStack(alignment: .leading, spacing: 2) {
                Text(Brand.displayName(name))
                Text(statusText(status, mine: mine))
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            if busyServer == name {
                ProgressView()
            } else if mine {
                Button("Disconnect") { disconnecting = name }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .confirmationDialog(
                        "Disconnect \(Brand.displayName(name))?",
                        isPresented: Binding(
                            get: { disconnecting == name },
                            set: { if !$0, disconnecting == name { disconnecting = nil } }
                        ),
                        titleVisibility: .visible
                    ) {
                        Button("Disconnect", role: .destructive) { Task { await disconnect(name) } }
                        Button("Cancel", role: .cancel) { disconnecting = nil }
                    } message: {
                        Text("Your sessions go back to the workspace credential for \(Brand.displayName(name)).")
                    }
            } else {
                Button("Connect") { Task { await connect(name) } }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
            }
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder private var githubRows: some View {
        if github?.enabled == true {
            if let account = myGitHubAccount {
                HStack(spacing: 12) {
                    BrandTile(name: "github", size: 30)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("@\(account.login ?? "")")
                        Text("Connected as you").font(.footnote).foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    Button("Disconnect") { Task { await disconnectGitHub(account) } }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                }
                .padding(.vertical, 2)
            } else {
                Button { Task { await connectGitHub() } } label: {
                    Label("Connect GitHub account", systemImage: "person.badge.key")
                }
            }
        } else {
            Text("Per-user GitHub auth is off for this workspace — sessions open PRs as the bot.")
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - Identity

    /// Who "you" are to the server — BOTH names, because a grant is stored
    /// under whichever one made it: the server keys MCP grants by display name
    /// ("Michiel") while GitHub accounts are the login ("happylinks"). Matching
    /// only the login left every one of this account's own grants reading as
    /// "Using the workspace key". Prefix-matched like the web's `isMe`, since a
    /// grant may carry a first name against a full one.
    private var myNames: [String] {
        [ServerConfig.shared.githubLogin, ServerConfig.shared.userName]
            .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }
            .filter { !$0.isEmpty }
    }

    private func isMine(_ status: MCPOauthStatus?) -> Bool {
        guard let users = status?.users else { return false }
        let names = myNames
        guard !names.isEmpty else { return false }
        return users.contains { user in
            let other = user.lowercased()
            return names.contains { $0 == other || other.hasPrefix($0) || $0.hasPrefix(other) }
        }
    }

    private var myGitHubAccount: GitHubConnectedAccount? {
        // The login only: a GitHub account row IS a login, so a loose match
        // here would claim a teammate's account.
        let login = ServerConfig.shared.githubLogin.lowercased()
        guard !login.isEmpty else { return nil }
        return (github?.accounts ?? []).first { ($0.login ?? "").lowercased() == login }
    }

    private func statusText(_ status: MCPOauthStatus?, mine: Bool) -> String {
        if mine { return "Connected as you" }
        if status?.shared != nil { return "Using the workspace account" }
        if status?.capable == true { return "Using the workspace key" }
        return "Not connected"
    }

    /// The servers this page is about: anything that can hold a per-user grant,
    /// or already holds one.
    private var oauthServers: [MCPConnection] {
        (connections?.mcpServers ?? []).filter { server in
            guard let name = server.name, !name.isEmpty else { return false }
            let status = oauth[name]
            return server.status == "needs-auth"
                || status?.capable == true
                || status?.shared != nil
                || !(status?.users ?? []).isEmpty
        }
    }

    // MARK: - Loading and actions

    private func load() async {
        loading = true
        error = nil
        do {
            async let connectionsCall = SettingsAPI.connections()
            async let githubCall = SettingsAPI.githubConnection()
            let (loaded, gh) = try await (connectionsCall, githubCall)
            connections = loaded
            github = gh
            SettingsCache.save("connections", loaded)
            SettingsCache.save("github-connection", gh)
            await loadOauth()
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    /// One status call per server. They are independent, and a server that
    /// cannot answer should leave the others' rows alone rather than fail the
    /// page — hence the per-name catch.
    private func loadOauth() async {
        let names = (connections?.mcpServers ?? []).compactMap { $0.name }.filter { !$0.isEmpty }
        var next: [String: MCPOauthStatus] = [:]
        for name in names {
            if let status = try? await SettingsAPI.mcpOauth(name: name) { next[name] = status }
        }
        oauth = next
    }

    private func connect(_ name: String) async {
        busyServer = name
        defer { busyServer = nil }
        do {
            let started = try await SettingsAPI.startMcpOauth(name: name)
            guard let raw = started.url, let url = URL(string: raw) else {
                error = "The server did not return a consent URL."
                return
            }
            #if os(iOS)
            if SafariLink.isWeb(url) { consent = SafariLink(url: url) } else { openURL(url) }
            #else
            openURL(url)
            #endif
            pollForGrant(name)
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// The grant lands on the SERVER when the provider redirects back, so the
    /// app learns about it by asking — two minutes of polling covers a consent
    /// screen with a login in it, and pulling to refresh covers the rest.
    private func pollForGrant(_ name: String) {
        pollTask?.cancel()
        pollTask = Task {
            for _ in 0..<24 {
                try? await Task.sleep(for: .seconds(5))
                if Task.isCancelled { return }
                guard let status = try? await SettingsAPI.mcpOauth(name: name) else { continue }
                oauth[name] = status
                if isMine(status) {
                    #if os(iOS)
                    consent = nil
                    #endif
                    return
                }
            }
        }
    }

    private func disconnect(_ name: String) async {
        disconnecting = nil
        busyServer = name
        defer { busyServer = nil }
        do {
            _ = try await SettingsAPI.disconnectMcpOauth(name: name)
            if let status = try? await SettingsAPI.mcpOauth(name: name) { oauth[name] = status }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func disconnectGitHub(_ account: GitHubConnectedAccount) async {
        guard let login = account.login else { return }
        do {
            _ = try await SettingsAPI.disconnectGitHub(login: login)
            github = try await SettingsAPI.githubConnection()
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func connectGitHub() async {
        do {
            let started = try await SettingsAPI.startGitHubDeviceFlow()
            githubFlow = started
            githubTask?.cancel()
            githubTask = Task {
                var interval = max(started.interval ?? 5, 1)
                while !Task.isCancelled, let code = started.deviceCode {
                    try? await Task.sleep(for: .seconds(interval))
                    if Task.isCancelled { return }
                    do {
                        let result = try await SettingsAPI.pollGitHubDeviceFlow(deviceCode: code)
                        if result.status == "ok" {
                            githubFlow = nil
                            github = try? await SettingsAPI.githubConnection()
                            return
                        }
                        if result.status == "slow_down" { interval += 5 }
                        if result.status == "error" {
                            error = result.error ?? "GitHub connection failed."
                            githubFlow = nil
                            return
                        }
                    } catch {
                        self.error = error.localizedDescription
                        githubFlow = nil
                        return
                    }
                }
            }
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func cancelGitHubConnect() {
        githubTask?.cancel()
        githubTask = nil
        githubFlow = nil
    }
}
