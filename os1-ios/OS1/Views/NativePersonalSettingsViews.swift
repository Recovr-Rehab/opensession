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

struct ComposerSettingsView: View {
    @AppStorage("os1.composer.defaultModel") private var nativeDefaultModel = ""
    @AppStorage("os1.composer.sendKey") private var nativeSendKey = "enter"
    @AppStorage("os1.composer.busySend") private var nativeBusySend = "queue"
    @AppStorage("os1.composer.busySendMod") private var nativeBusySendMod = "steer"

    @State private var models: [SettingsModelOption] = []
    @State private var defaultModel = ""
    @State private var sendKey = "enter"
    @State private var busySend = "queue"
    @State private var busySendMod = "steer"
    @State private var loading = true
    @State private var saving = false
    @State private var resaveNeeded = false
    @State private var error: String?
    @State private var savedPrefs: [String: String] = [:]
    @State private var prefsLoaded = false

    var body: some View {
        Form {
            if loading {
                Section { ProgressView("Loading composer preferences…") }
            } else {
                if let error {
                    Section {
                        Text(error)
                            .foregroundStyle(.red)
                        Button("Try again") { Task { await load() } }
                    }
                }

                Section {
                    Picker("Default model", selection: $defaultModel) {
                        Text("No preference").tag("")
                        ForEach(models.filter { $0.id?.isEmpty == false }, id: \.id) { model in
                            Text(model.label ?? model.id ?? "Model").tag(model.id ?? "")
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
            }
            PersonalPromptSection()
        }
        .navigationTitle("Composer")
        .task { await load() }
        .onChange(of: defaultModel) { _, _ in commit() }
        .onChange(of: sendKey) { _, _ in commit() }
        .onChange(of: busySend) { _, _ in commit() }
        .onChange(of: busySendMod) { _, _ in commit() }
        .onDisappear { commit() }
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
            defaultModel = prefs["default-model"] ?? nativeDefaultModel
            sendKey = prefs["send-key"] == "mod-enter" ? "mod-enter" : "enter"
            busySend = prefs["busy-send"] == "steer" ? "steer" : "queue"
            busySendMod = prefs["busy-send-mod"] == "queue" ? "queue" : "steer"
            #if os(macOS)
            nativeSendKey = sendKey
            #endif
            nativeBusySend = busySend
            nativeBusySendMod = busySendMod
            savedPrefs = currentPrefs
            prefsLoaded = true
        } catch {
            self.error = error.localizedDescription
        }
        do {
            models = try await SettingsAPI.modelCatalog().models ?? []
        } catch {
            if self.error == nil { self.error = error.localizedDescription }
        }
        loading = false
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
            nativeDefaultModel = defaultModel
            #if os(macOS)
            nativeSendKey = sendKey
            #endif
            nativeBusySend = busySend
            nativeBusySendMod = busySendMod
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
        ]
    }
}

struct AppearanceSettingsView: View {
    @AppStorage("os1.appearance") private var appearance = "system"
    @AppStorage("os1.appearance.turnActivity") private var nativeTurnActivity = "collapsed"
    @AppStorage("os1.desk.voice") private var deskVoice = "off"

    @State private var turnActivity = "collapsed"
    @State private var loading = true
    @State private var saving = false
    @State private var error: String?
    @State private var savedTurnActivity = "auto"
    @State private var prefsLoaded = false

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

            Section {
                if loading {
                    ProgressView("Loading session preferences…")
                } else {
                    Picker("Tool calls and messages", selection: $turnActivity) {
                        Text("Expand while running").tag("auto")
                        Text("Always expanded").tag("expanded")
                        Text("Always collapsed").tag("collapsed")
                    }
                }
            } header: {
                Text("Session")
            } footer: {
                Text("Controls how a turn's working activity is folded in a session. Sidebar settings are not shown because the native app has no web sidebar.")
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

            if let error {
                Section {
                    Text(error).foregroundStyle(.red)
                    Button("Try again") { Task { await load() } }
                }
            }
        }
        .navigationTitle("Appearance")
        .task { await load() }
        .onChange(of: turnActivity) { _, _ in
            guard prefsLoaded, !saving, turnActivity != savedTurnActivity else { return }
            Task { await saveTurnActivity() }
        }
    }

    /// Fire-and-forget: the toggle is already reflected locally via
    /// `@AppStorage`, this just lets other devices pick it up.
    private func pushDeskVoice(_ enabled: Bool) {
        let user = NativePreferences.context().user
        Task {
            _ = try? await SettingsAPI.updateUiPrefs(
                user: user,
                prefs: ["desk-voice": enabled ? "on" : "off"]
            )
        }
    }

    private func load() async {
        loading = true
        error = nil
        prefsLoaded = false
        do {
            let requestContext = NativePreferences.context()
            let prefs = try await SettingsAPI.uiPrefs(user: requestContext.user)
            guard NativePreferences.context() == requestContext else { loading = false; return }
            if ["auto", "expanded", "collapsed"].contains(prefs["turn-activity"]) {
                turnActivity = prefs["turn-activity"] ?? "collapsed"
                nativeTurnActivity = turnActivity
            } else {
                turnActivity = nativeTurnActivity
            }
            savedTurnActivity = turnActivity
            prefsLoaded = true
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }

    /// Writes through on selection, like the Desk voice toggle above it.
    private func saveTurnActivity() async {
        saving = true
        error = nil
        do {
            let requestContext = NativePreferences.context()
            let selected = turnActivity
            let response = try await SettingsAPI.updateUiPrefs(
                user: requestContext.user,
                prefs: ["turn-activity": selected]
            )
            var confirmed = response
            confirmed["turn-activity"] = response["turn-activity"] ?? selected
            guard NativePreferences.apply(confirmed, for: requestContext) else {
                self.error = "Connection changed before preferences finished saving."
                saving = false
                return
            }
            turnActivity = confirmed["turn-activity"] ?? selected
            nativeTurnActivity = turnActivity
            savedTurnActivity = turnActivity
        } catch {
            self.error = error.localizedDescription
        }
        saving = false
    }
}

/// The standing prompt, shown inside Composer. There is no Save button: it
/// commits when the box loses focus and again when the screen goes away, so
/// leaving keeps your edit — same contract as the web.
struct PersonalPromptSection: View {
    @State private var prompt = ""
    @State private var savedPrompt = ""
    @State private var loading = true
    @State private var error: String?
    @FocusState private var editing: Bool

    private let user = ServerConfig.shared.userName

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
        Task { _ = try? await SettingsAPI.setPersonalPrompt(user: user, prompt: pending) }
    }

    private func load() async {
        loading = true
        error = nil
        do {
            let result = try await SettingsAPI.personalPrompt(user: user)
            prompt = result
            savedPrompt = result
        } catch {
            self.error = error.localizedDescription
        }
        loading = false
    }
}

/// Where the two App Intents are explained and handed over to the system.
///
/// The shortcuts themselves need no setup — an `AppShortcutsProvider` registers
/// them the moment the app is installed (see `AgentShortcuts`) — but nothing in
/// the app ever SAYS that, and the one step that is a person's to take (binding
/// one to the Action Button, which only iOS Settings can do) happens outside
/// OS1 entirely. So this page is mostly signposting: what each one does, a
/// `ShortcutsLink` into the Shortcuts app where they live, and the path to the
/// setting that Apple gives no deep link for.
struct ShortcutsSettingsView: View {
    var body: some View {
        Form {
            Section {
                shortcut(
                    icon: "sparkles",
                    title: "Start an Agent",
                    detail: """
                    Asks for the idea and starts a session on it without opening \
                    OS1. Repo and model come from what the composer used last.
                    """
                )
                shortcut(
                    icon: "mic",
                    title: "New Idea",
                    detail: """
                    Opens the composer with the mic listening, so you can speak \
                    the idea and still change repo, mode or model before sending.
                    """
                )
            } footer: {
                // No section header: the navigation title above already says
                // "Shortcuts", and repeating it just pushed the first row down.
                Text("Both are installed with the app — no setup needed. Ask Siri for either by name, or find them under OS1 in the Shortcuts app.")
            }

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
                Text("To put one on the Action Button: iPhone Settings → Action Button → swipe to Shortcut → Choose a Shortcut → OS1. For dictation straight into a background session, make a shortcut of Dictate Text → Start an Agent and choose that instead.")
                #else
                Text("Run either from Spotlight, or say it to Siri.")
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
