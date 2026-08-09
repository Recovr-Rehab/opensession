import SwiftUI

/// The Desk: a summonable sheet onto the user's standing concierge session
/// (`OS1API.ensureDesk`), plus its optional live voice mode. Presented as a
/// full-height sheet from the sessions list, on both platforms.
struct DeskSheet: View {
    private enum LoadState {
        case loading
        case failed(String)
        case ready(SessionViewModel)
    }

    /// Two hours: long enough that stepping away mid-thought keeps the thread,
    /// short enough that yesterday's chat never owns the surface you summoned
    /// for today's work. Frozen when the sheet opens, so nothing said in this
    /// sitting can age out from under you.
    private static let staleAfter: TimeInterval = 2 * 60 * 60

    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("os1.desk.voice") private var deskVoice = "off"

    @State private var loadState: LoadState = .loading
    @State private var engine = DeskVoiceEngine()
    /// A session opened from the board, presented on top of the Desk rather
    /// than replacing it — you're triaging, and closing it should put you back
    /// on the board with the rest of the list intact.
    @State private var openSession: OpenedSession?

    private struct OpenedSession: Identifiable {
        let id: String
    }

    var body: some View {
        @Bindable var engine = engine
        return VStack(spacing: 0) {
            header
            Divider()
            content
        }
        .task {
            #if DEBUG
            // Dev loop: start the call on open (`OS1_VOICE_AUTOSTART=1`) so
            // simulator voice runs need no UI driving.
            if ProcessInfo.processInfo.environment["OS1_VOICE_AUTOSTART"] != nil {
                engine.open()
            }
            #endif
            await load()
        }
        .onDisappear {
            // A full-screen cover takes its presenter off screen, so this
            // fires when the CALL opens — hanging up the call it just
            // presented. Only a sheet that is really going away stops it.
            if !engine.callPresented { engine.stop() }
        }
        .onChange(of: scenePhase) { _, phase in
            // A backgrounded app must never hold the mic open. `.inactive` is
            // not backgrounded — it's the app switcher, a notification banner,
            // Control Center — and killing a live call for those is how a
            // glance at the notification shade silently ends a conversation.
            if phase == .background { engine.stop() }
        }
        .fullScreenCoverCompat(isPresented: $engine.callPresented) {
            DeskVoiceCallView(engine: engine)
        }
        .sheet(item: $openSession) { opened in
            NavigationStack {
                SessionView(session: Session(id: opened.id))
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Close") { openSession = nil }
                        }
                    }
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch loadState {
        case .loading:
            VStack(spacing: 10) {
                ProgressView()
                Text("Opening…")
                    .font(.footnote)
                    .foregroundStyle(OS1VisualStyle.textDim)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            Text(message)
                .font(.footnote)
                .foregroundStyle(OS1VisualStyle.textDim)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .ready(let model):
            SessionView(viewModel: model, tabs: [model.session])
                .emptyContent {
                    DeskBoardView(
                        onAnswer: { item, option in answer(model: model, item: item, option: option) },
                        onOpen: { openSession = OpenedSession(id: $0) },
                        earlierCount: model.hiddenEarlierCount,
                        onShowEarlier: { model.hideBefore = nil }
                    )
                }
        }
    }

    /// Inline answers take the transport the question came in on: an
    /// ask_human addressed to this user resolves over REST (and lands back in
    /// whichever Slack thread posed it), a session's own AskUserQuestion goes
    /// back over the Desk's socket.
    private func answer(model: SessionViewModel, item: DeskState.WorkItem, option: String) {
        guard let question = item.question else { return }
        if question.kind == "human" {
            Task { try? await OS1API.answerHumanAsk(id: question.questionId, answer: option) }
        } else {
            model.answerOtherSession(
                sessionId: item.sessionId,
                questionId: question.questionId,
                questionText: question.text,
                option: option
            )
        }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "lamp.desk")
                .foregroundStyle(OS1VisualStyle.text)
            Text("Desk")
                .font(.headline.weight(.semibold))
                .foregroundStyle(OS1VisualStyle.text)
            Spacer()
            voiceStatusLabel
            if deskVoice == "on" {
                micButton
            }
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .foregroundStyle(OS1VisualStyle.textDim)
            }
            .accessibilityLabel("Close")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    @ViewBuilder
    private var voiceStatusLabel: some View {
        if engine.state != .idle {
            Text(voiceStatusText)
                .font(.footnote)
                .foregroundStyle(engine.state == .error ? .red : OS1VisualStyle.textDim)
                .lineLimit(1)
                .frame(maxWidth: 160, alignment: .trailing)
        }
    }

    private var voiceStatusText: String {
        engine.state == .error
            ? (engine.errorMessage ?? engine.state.label)
            : engine.state.label
    }

    /// Starts a call, or returns to one that is already running — a minimized
    /// call stays live, so this button is the way back to it. Hanging up
    /// happens on the call screen.
    private var micButton: some View {
        Button {
            engine.open()
        } label: {
            Image(systemName: engine.active ? "mic.fill" : "mic")
                .foregroundStyle(engine.active ? OS1VisualStyle.accent : OS1VisualStyle.textDim)
        }
        .accessibilityLabel(engine.active ? "Return to the voice call" : "Start a voice call")
    }

    private func load() async {
        loadState = .loading
        do {
            let ensure = try await OS1API.ensureDesk()
            let model = SessionViewModel(session: Session(id: ensure.sessionId))
            // The server's "Clear" marker and the staleness cutoff are the same
            // kind of thing — hide everything before the later of the two.
            let cleared = ensure.clearedAt.flatMap(Session.parseISO)
            let stale = Date().addingTimeInterval(-Self.staleAfter)
            model.hideBefore = max(cleared ?? stale, stale)
            loadState = .ready(model)
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }
}
