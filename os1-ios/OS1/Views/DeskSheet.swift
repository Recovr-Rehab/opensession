import SwiftUI

/// The Desk: a summonable sheet onto the user's standing concierge session
/// (`OS1API.ensureDesk`), plus its optional live voice mode. Presented as a
/// full-height sheet from the sessions list, on both platforms.
struct DeskSheet: View {
    private enum LoadState {
        case loading
        case failed(String)
        case ready(String)
    }

    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("os1.desk.voice") private var deskVoice = "off"

    @State private var loadState: LoadState = .loading
    @State private var engine = DeskVoiceEngine()

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()
            content
        }
        .task {
            await load()
        }
        .onDisappear { engine.stop() }
        .onChange(of: scenePhase) { _, phase in
            // A backgrounded app must never hold the mic open.
            if phase != .active { engine.stop() }
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
        case .ready(let sessionId):
            SessionView(session: Session(id: sessionId))
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
        switch engine.state {
        case .idle: ""
        case .connecting: "Connecting…"
        case .listening: "Listening"
        case .thinking: "Thinking…"
        case .speaking: "Speaking"
        case .action: "Working…"
        case .error: engine.errorMessage ?? "Voice call failed"
        }
    }

    private var micButton: some View {
        Button {
            if engine.active {
                engine.stop()
            } else {
                Task { await engine.start() }
            }
        } label: {
            Image(systemName: engine.active ? "mic.fill" : "mic")
                .foregroundStyle(engine.active ? OS1VisualStyle.accent : OS1VisualStyle.textDim)
        }
        .accessibilityLabel(engine.active ? "End voice call" : "Start voice call")
    }

    private func load() async {
        loadState = .loading
        do {
            let ensure = try await OS1API.ensureDesk()
            loadState = .ready(ensure.sessionId)
        } catch {
            loadState = .failed(error.localizedDescription)
        }
    }
}
