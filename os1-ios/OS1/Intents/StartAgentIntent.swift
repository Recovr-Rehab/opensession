import AppIntents
import SwiftUI

/// "Start an Agent" — one press, one idea, an agent already working on it.
///
/// This exists for the iPhone's Action Button: hold it, say the idea, and a
/// session is created on the server and starts running before the phone is
/// back in your pocket. That is why the intent runs in the BACKGROUND
/// (`openAppWhenRun = false`) — launching the app, waiting for the sessions
/// list to load and driving the composer sheet is the thing being replaced.
/// Everything the composer would ask for that isn't the idea itself falls back
/// to what you last used (repo, model), so the only required input is the
/// sentence you speak.
///
/// Binding it: Settings > Action Button > Shortcut > "Start an Agent", or —
/// for a dictation-first flow with no keyboard at all — a shortcut of
/// [Dictate Text] → [Start an Agent], passing the dictated text as Idea.
struct StartAgentIntent: AppIntent {
    static let title: LocalizedStringResource = "Start an Agent"

    static let description = IntentDescription(
        "Fire off an idea: creates a new session and starts an agent working on it.",
        categoryName: "Sessions",
        searchKeywords: ["session", "agent", "idea", "prompt", "task"]
    )

    /// The whole point is not to wait for the app. The dialog reports back.
    static let openAppWhenRun = false

    @Parameter(
        title: "Idea",
        description: "What the agent should work on.",
        inputOptions: String.IntentInputOptions(
            capitalizationType: .sentences,
            multiline: true,
            smartQuotes: false,
            smartDashes: false
        ),
        requestValueDialog: "What should the agent work on?"
    )
    var prompt: String

    /// Optional: leave it unset and the session lands on the repo the app's
    /// composer last used, which is the right default for a one-press capture.
    @Parameter(
        title: "Repo",
        description: "Which repo the agent works in. Defaults to the one you used last."
    )
    var repo: RepoEntity?

    @Parameter(
        title: "Mode",
        description: "Code can edit files and open a PR; Ask is read-only.",
        default: .code
    )
    var mode: AgentModeAppEnum

    static var parameterSummary: some ParameterSummary {
        Summary("Start an agent on \(\.$prompt)") {
            \.$repo
            \.$mode
        }
    }

    @MainActor
    func perform() async throws -> some IntentResult & ReturnsValue<URL>
        & ProvidesDialog & ShowsSnippetView
    {
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw StartAgentError.emptyIdea }
        guard ServerConfig.shared.isConfigured else { throw StartAgentError.notConfigured }

        // The composer's own remembered choices, so a session started from the
        // Action Button is the same session the "+" would have made.
        let defaults = UserDefaults.standard
        let repoId = repo?.id ?? defaults.string(forKey: "os1.newSession.repo") ?? ""
        let model = defaults.string(forKey: "os1.composer.defaultModel") ?? ""

        let id: String
        do {
            id = try await OS1API.createSession(
                prompt: text,
                repo: repoId,
                mode: mode.rawValue,
                model: model.isEmpty ? nil : model
            )
        } catch {
            throw StartAgentError.createFailed(error.localizedDescription)
        }

        let title = String((text.components(separatedBy: "\n").first ?? text).prefix(80))
        let repoLabel = repo?.label ?? (repoId.isEmpty ? nil : repoId)
        // Returned so a shortcut can chain — "Open URLs" lands on the session
        // in the web app, and the id is readable inside it.
        let link = ServerConfig.shared.baseURL?
            .appendingPathComponent("session")
            .appendingPathComponent(id)
        return .result(
            value: link ?? URL(string: "os1session:\(id)")!,
            dialog: IntentDialog("Started \(title)"),
            view: StartedAgentSnippet(
                title: title,
                repoLabel: repoLabel,
                mode: mode,
                sessionId: id
            )
        )
    }
}

/// What the phone shows after the press: enough to confirm the idea landed
/// intact (dictation mishears) without opening anything.
struct StartedAgentSnippet: View {
    let title: String
    let repoLabel: String?
    let mode: AgentModeAppEnum
    let sessionId: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Agent started", systemImage: "sparkles")
                .font(.headline)
                .foregroundStyle(.secondary)
            Text(title)
                .font(.title3.weight(.medium))
                .lineLimit(4)
            HStack(spacing: 6) {
                if let repoLabel {
                    tag(repoLabel, systemImage: "shippingbox")
                }
                tag(
                    mode == .code ? "Code" : "Ask",
                    systemImage: mode == .code ? "arrow.branch" : "text.magnifyingglass"
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func tag(_ text: String, systemImage: String) -> some View {
        Label(text, systemImage: systemImage)
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(.quaternary, in: Capsule())
    }
}

enum AgentModeAppEnum: String, AppEnum {
    case code
    case ask

    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Session Mode")

    static let caseDisplayRepresentations: [AgentModeAppEnum: DisplayRepresentation] = [
        .code: DisplayRepresentation(title: "Code", subtitle: "Can edit files and open a PR"),
        .ask: DisplayRepresentation(title: "Ask", subtitle: "Read-only"),
    ]
}

/// A repo you can pick in the Shortcuts editor; the list comes from the server
/// the app is signed in to.
struct RepoEntity: AppEntity {
    let id: String
    let label: String

    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Repo")
    static let defaultQuery = RepoEntityQuery()

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: "\(label)", subtitle: label == id ? "" : "\(id)")
    }
}

struct RepoEntityQuery: EntityQuery {
    @MainActor
    func entities(for identifiers: [String]) async throws -> [RepoEntity] {
        let all = try await allRepos()
        return identifiers.compactMap { id in all.first { $0.id == id } }
    }

    @MainActor
    func suggestedEntities() async throws -> [RepoEntity] {
        try await allRepos()
    }

    @MainActor
    private func allRepos() async throws -> [RepoEntity] {
        guard ServerConfig.shared.isConfigured else { return [] }
        let repos = try await OS1API.repos()
        return repos.map { RepoEntity(id: $0.id, label: $0.label ?? $0.id) }
    }
}

enum StartAgentError: Error, CustomLocalizedStringResourceConvertible {
    case emptyIdea
    case notConfigured
    case createFailed(String)

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .emptyIdea:
            "There was nothing to work on — say or type an idea first."
        case .notConfigured:
            "OS1 isn't connected to a server yet. Open the app and sign in first."
        case .createFailed(let message):
            "Couldn't start the agent: \(message)"
        }
    }
}

/// The other half of the Action Button story: instead of the system's plain
/// "enter text" dialog, open OUR composer with the mic already listening.
///
/// `StartAgentIntent` is the one-press, never-see-the-app path; this one is for
/// when the idea needs shaping — you can watch the words land, fix the one the
/// recogniser got wrong, swap the repo or the model, attach a screenshot, and
/// only then send. Both are bindable to the Action Button; which you pick is
/// taste, so both are offered.
struct CaptureIdeaIntent: AppIntent {
    static let title: LocalizedStringResource = "New Idea"

    static let description = IntentDescription(
        "Opens the composer with the mic already listening, so you can speak an idea and send it.",
        categoryName: "Sessions",
        searchKeywords: ["idea", "dictate", "voice", "session", "compose"]
    )

    /// The point of this one — the app comes forward and the sheet is the
    /// first thing you see.
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        QuickCapture.shared.ask(dictate: true)
        return .result()
    }
}

/// The hand-off between the intent and the sessions list. The intent can run
/// before any view exists (cold launch), so the request is PARKED here rather
/// than posted — the list picks it up whenever it appears.
@MainActor
@Observable
final class QuickCapture {
    static let shared = QuickCapture()

    struct Request: Identifiable {
        let id = UUID()
        var dictate: Bool
    }

    private(set) var request: Request?

    func ask(dictate: Bool) {
        request = Request(dictate: dictate)
    }

    /// Read once and clear: reopening the sheet on every later appearance
    /// would trap you in the composer.
    func take() -> Request? {
        defer { request = nil }
        return request
    }
}

/// Makes the intents show up without any setup: in Spotlight, in the Action
/// Button's shortcut picker, and as Siri phrases.
struct AgentShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: StartAgentIntent(),
            phrases: [
                "Start an agent in \(.applicationName)",
                "New \(.applicationName) session",
                "Fire up an \(.applicationName) agent",
            ],
            shortTitle: "Start an Agent",
            systemImageName: "sparkles"
        )
        AppShortcut(
            intent: CaptureIdeaIntent(),
            phrases: [
                "New idea in \(.applicationName)",
                "Capture an idea in \(.applicationName)",
            ],
            shortTitle: "New Idea",
            systemImageName: "mic"
        )
    }
}
