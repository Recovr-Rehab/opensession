import SwiftUI

struct PrSlackShareRequest: Identifiable {
    let id = UUID()
    let title: String
    let url: URL
}

/// A deliberate Slack post: the description stays editable while the pull
/// request URL is fixed, so the shared message cannot lose its destination.
struct PrSlackShareSheet: View {
    let request: PrSlackShareRequest

    @Environment(\.dismiss) private var dismiss
    @State private var description: String
    @State private var channels: [SlackAPI.Channel] = []
    @State private var selectedChannel = ""
    @State private var loading = true
    @State private var sending = false
    @State private var errorText: String?
    @FocusState private var descriptionFocused: Bool

    init(request: PrSlackShareRequest) {
        self.request = request
        _description = State(initialValue: request.title)
    }

    private var trimmedDescription: String {
        description.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canSend: Bool {
        !sending && !selectedChannel.isEmpty && !trimmedDescription.isEmpty
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextEditor(text: $description)
                        .frame(minHeight: 110)
                        .focused($descriptionFocused)
                } header: {
                    Text("Description")
                } footer: {
                    Text("The GitHub link is added automatically.")
                }

                Section("Channel") {
                    if loading {
                        HStack {
                            ProgressView().controlSize(.small)
                            Text("Loading channels")
                                .foregroundStyle(.secondary)
                        }
                    } else if channels.isEmpty {
                        Text("No Slack channels are configured.")
                            .foregroundStyle(.secondary)
                    } else {
                        Picker("Send to", selection: $selectedChannel) {
                            ForEach(channels) { channel in
                                Text("#\(channel.name)").tag(channel.id)
                            }
                        }
                    }
                }

                Section("Pull request") {
                    Link(destination: request.url) {
                        Text(request.url.absoluteString)
                            .lineLimit(2)
                    }
                }

                if let errorText {
                    Section {
                        Text(errorText).foregroundStyle(.red)
                    }
                }
            }
            .navigationTitle("Share to Slack")
            .inlineTitleBarCompat()
            .toolbar {
                ToolbarItem(placement: .topLeadingCompat) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .topTrailingCompat) {
                    if sending {
                        ProgressView().controlSize(.small)
                    } else {
                        Button("Send") { send() }
                            .disabled(!canSend)
                    }
                }
            }
            .disabled(sending)
            .task { await loadChannels() }
        }
        .interactiveDismissDisabled(sending)
        #if os(macOS)
        .frame(minWidth: 420, minHeight: 440)
        #endif
    }

    private func loadChannels() async {
        do {
            let response = try await SlackAPI.channels()
            channels = response.channels
            selectedChannel = response.channels.contains { $0.id == response.defaultChannel }
                ? response.defaultChannel ?? ""
                : response.channels.first?.id ?? ""
            descriptionFocused = true
        } catch {
            errorText = (error as? LocalizedError)?.errorDescription
                ?? error.localizedDescription
        }
        loading = false
    }

    private func send() {
        guard canSend else { return }
        Haptics.play(.send)
        sending = true
        errorText = nil
        descriptionFocused = false
        let message = "\(trimmedDescription)\n\(request.url.absoluteString)"
        Task {
            do {
                try await SlackAPI.post(
                    channelId: selectedChannel,
                    text: message
                )
                Haptics.play(.commit)
                dismiss()
            } catch {
                errorText = (error as? LocalizedError)?.errorDescription
                    ?? error.localizedDescription
                Haptics.play(.warn)
            }
            sending = false
        }
    }
}
