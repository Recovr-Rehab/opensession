import SwiftUI
#if canImport(UIKit)
import UIKit
#endif
#if canImport(AppKit)
import AppKit
#endif

/// Plain — the support queue — on the phone.
///
/// Two screens: the Todo queue in priority lanes, and one ticket's timeline
/// with the composer. The triage loop is the whole point of carrying this in a
/// pocket: read what the customer said, answer it or leave the team a note,
/// then move it out of the queue.
///
/// What the web has and this deliberately doesn't (yet): assign, labels,
/// priority, rename, mark-spam, and the triage hand-off that spawns a session.
/// Each needs its own picker; spam is customer-wide and destructive enough to
/// deserve a considered flow rather than a v1 sheet.
struct SupportSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model = SupportQueueModel()
    @State private var path: [SupportThreadSummary] = []

    var body: some View {
        NavigationStack(path: $path) {
            queue
                .navigationTitle("Support")
                .inlineTitleBarCompat()
                .navigationDestination(for: SupportThreadSummary.self) { row in
                    SupportThreadView(row: row) { model.forget(id: row.id) }
                }
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
        }
        .task { await model.load() }
    }

    @ViewBuilder
    private var queue: some View {
        if model.isLoading {
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if model.threads.isEmpty {
            ListPlaceholder(
                symbol: "tray",
                title: model.errorText == nil ? "Inbox zero" : "Couldn't load the queue",
                message: model.errorText ?? "No tickets are waiting in Plain."
            ) {
                Button("Refresh") { Task { await model.load() } }
                    .buttonStyle(PlaceholderActionStyle())
            }
        } else {
            List {
                ForEach(model.lanes, id: \.priority) { lane in
                    Section {
                        ForEach(lane.threads) { row in
                            NavigationLink(value: row) { SupportRow(row: row) }
                        }
                    } header: {
                        HStack(spacing: 6) {
                            Text(lane.priority.label)
                            Text("\(lane.threads.count)")
                                .foregroundStyle(OS1VisualStyle.textFaint)
                        }
                    }
                }
            }
            #if os(iOS)
            .scrollContentBackground(.hidden)
            .background(OS1VisualStyle.background)
            #endif
            .refreshable { await model.load() }
        }
    }
}

private struct SupportRow: View {
    let row: SupportThreadSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                if row.lane == .urgent {
                    Circle()
                        .fill(OS1VisualStyle.red)
                        .frame(width: 6, height: 6)
                }
                Text(row.customerLabel)
                    .font(.body.weight(.medium))
                    .lineLimit(1)
                Spacer(minLength: 6)
                if let assignee = row.assignee?.name?.nilIfBlank {
                    Text(assignee)
                        .font(.caption2)
                        .foregroundStyle(OS1VisualStyle.textFaint)
                        .lineLimit(1)
                }
            }
            Text(row.displayTitle)
                .font(.subheadline)
                .foregroundStyle(OS1VisualStyle.textDim)
                .lineLimit(2)
            if let labels = row.labels, !labels.isEmpty {
                Text(labels.compactMap { $0.name?.nilIfBlank }.joined(separator: " · "))
                    .font(.caption2)
                    .foregroundStyle(OS1VisualStyle.textFaint)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 2)
    }
}

/// One ticket: the conversation, then the composer.
struct SupportThreadView: View {
    let row: SupportThreadSummary
    /// Called when the ticket leaves the queue, so the list can drop the row
    /// instead of showing it for the length of the server's cache.
    var onLeftQueue: () -> Void = {}

    @State private var model: SupportThreadModel
    @Environment(\.dismiss) private var dismiss

    init(row: SupportThreadSummary, onLeftQueue: @escaping () -> Void = {}) {
        self.row = row
        self.onLeftQueue = onLeftQueue
        _model = State(initialValue: SupportThreadModel(threadId: row.id))
    }

    var body: some View {
        VStack(spacing: 0) {
            if model.isLoading {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                timeline
            }
            SupportComposer(model: model)
        }
        .background(OS1VisualStyle.background)
        .navigationTitle(model.thread?.customerLabel ?? row.customerLabel)
        .inlineTitleBarCompat()
        .toolbar {
            ToolbarItem(placement: .topTrailingCompat) { statusMenu }
        }
        .task {
            await model.load()
            model.startPolling()
        }
        .onDisappear {
            model.stopPolling()
            if model.statusChanged { onLeftQueue() }
        }
    }

    private var timeline: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if let thread = model.thread {
                        header(thread)
                        ForEach(thread.entries ?? []) { entry in
                            SupportEntryRow(entry: entry)
                                .id(entry.id)
                        }
                    } else if let error = model.errorText {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(OS1VisualStyle.red)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .onChange(of: model.thread?.entries?.count ?? 0) {
                // Newest last, and a poll that lands while you're reading
                // shouldn't move you — only jump for arrivals at the bottom.
                if let last = model.thread?.entries?.last?.id {
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo(last, anchor: .bottom)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func header(_ thread: SupportThread) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let title = thread.title?.nilIfBlank {
                Text(title)
                    .font(.headline)
            }
            HStack(spacing: 6) {
                if let email = thread.customer?.email?.nilIfBlank {
                    Text(email)
                }
                if let status = thread.status?.nilIfBlank {
                    Text("· \(status.capitalized)")
                }
            }
            .font(.footnote)
            .foregroundStyle(OS1VisualStyle.textDim)
            if thread.awaitingFirstResponse == true {
                Text("Waiting for a first reply")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(OS1VisualStyle.yellow)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var statusMenu: some View {
        Menu {
            if model.thread?.isDone == true {
                Button("Reopen") { Task { await model.setStatus("todo") } }
            } else {
                Button("Mark done") { Task { await model.setStatus("done") } }
                if model.thread?.isSnoozed == true {
                    Button("Unsnooze") { Task { await model.setStatus("todo") } }
                }
                Menu("Snooze") {
                    // The web's own set, in the same order.
                    snooze("1 hour", 3600)
                    snooze("4 hours", 4 * 3600)
                    snooze("1 day", 24 * 3600)
                    snooze("3 days", 3 * 24 * 3600)
                    snooze("1 week", 7 * 24 * 3600)
                }
            }
        } label: {
            Image(systemName: "ellipsis.circle")
                .foregroundStyle(OS1VisualStyle.text)
        }
        .accessibilityLabel("Ticket actions")
    }

    private func snooze(_ label: String, _ seconds: Int) -> some View {
        Button(label) {
            Task { await model.setStatus("snoozed", durationSeconds: seconds) }
        }
    }
}

/// One timeline entry: the customer on the left, us on the right, and a note
/// full-width in between — a note is the team talking to itself, not a side of
/// the conversation.
private struct SupportEntryRow: View {
    let entry: SupportEntry

    var body: some View {
        if entry.isNote {
            note
        } else {
            message
        }
    }

    private var note: some View {
        let unpicked = SupportNote.unpick(entry.text)
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Text("Note")
                    .font(.caption2.weight(.semibold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(
                        OS1VisualStyle.yellow.opacity(0.22),
                        in: Capsule()
                    )
                // The server posts every note under the machine user with the
                // author's name glued to the front, so the name here comes out
                // of the text rather than off the entry.
                Text(unpicked.author ?? entry.actorName ?? "Someone")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(OS1VisualStyle.textDim)
                Spacer(minLength: 4)
                timestamp
            }
            // Notes are the one entry kind written in markdown; the rest are
            // plain text, including email (the server only ever fetches an
            // email's text part).
            MarkdownBody(unpicked.body)
            SupportAttachments(attachments: entry.attachments ?? [])
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            OS1VisualStyle.yellow.opacity(0.10),
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
    }

    private var message: some View {
        HStack {
            if !entry.isFromCustomer { Spacer(minLength: 40) }
            VStack(alignment: entry.isFromCustomer ? .leading : .trailing, spacing: 4) {
                HStack(spacing: 6) {
                    Text(entry.actorName ?? (entry.isFromCustomer ? "Customer" : "Support"))
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(OS1VisualStyle.textDim)
                    timestamp
                }
                if let subject = entry.subject?.nilIfBlank {
                    Text(subject)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(OS1VisualStyle.textDim)
                }
                if !entry.text.isEmpty {
                    Text(entry.text)
                        .font(.body)
                        .textSelection(.enabled)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 9)
                        .background(
                            entry.isFromCustomer
                                ? OS1VisualStyle.panel
                                : OS1VisualStyle.userMessage,
                            in: RoundedRectangle(cornerRadius: 14, style: .continuous)
                        )
                }
                SupportAttachments(attachments: entry.attachments ?? [])
            }
            if entry.isFromCustomer { Spacer(minLength: 40) }
        }
    }

    @ViewBuilder
    private var timestamp: some View {
        if let date = entry.date {
            Text(date, format: .relative(presentation: .named))
                .font(.caption2)
                .foregroundStyle(OS1VisualStyle.textFaint)
        }
    }
}

/// Attachments, inline where they're pictures. A support message is sometimes
/// nothing but a screenshot — dropping those would render the report empty.
private struct SupportAttachments: View {
    let attachments: [SupportEntry.Attachment]

    var body: some View {
        if !attachments.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(attachments) { attachment in
                    if attachment.isImage {
                        SupportImage(attachment: attachment)
                    } else {
                        Label(
                            [attachment.fileName?.nilIfBlank ?? "Attachment",
                             attachment.sizeLabel]
                                .compactMap { $0 }
                                .joined(separator: " · "),
                            systemImage: "paperclip"
                        )
                        .font(.caption)
                        .foregroundStyle(OS1VisualStyle.textDim)
                    }
                }
            }
        }
    }
}

/// One image attachment.
///
/// Fetched by hand rather than through `AsyncImage`: the proxy needs the app's
/// bearer token, and an image view's own subresource load doesn't carry it —
/// the same reason the assets viewer fetches its bytes itself.
private struct SupportImage: View {
    let attachment: SupportEntry.Attachment
    @State private var data: Data?
    @State private var failed = false

    var body: some View {
        Group {
            if let data, let image = decoded(data) {
                image
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 220)
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            } else if failed {
                Label(
                    attachment.fileName?.nilIfBlank ?? "Attachment",
                    systemImage: "photo"
                )
                .font(.caption)
                .foregroundStyle(OS1VisualStyle.textDim)
            } else {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(OS1VisualStyle.hover)
                    .frame(height: 120)
            }
        }
        .task {
            guard data == nil else { return }
            do {
                data = try await OS1API.supportAttachment(id: attachment.id)
            } catch {
                failed = true
            }
        }
    }

    private func decoded(_ data: Data) -> Image? {
        #if canImport(UIKit)
        UIImage(data: data).map(Image.init(uiImage:))
        #else
        NSImage(data: data).map(Image.init(nsImage:))
        #endif
    }
}

/// Reply or note, and the send.
///
/// Its own view struct because the draft is per-keystroke state: read here and
/// nowhere else, so typing doesn't re-evaluate the timeline above it.
private struct SupportComposer: View {
    @Bindable var model: SupportThreadModel
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Picker("Kind", selection: $model.isNoteMode) {
                Text("Reply").tag(false)
                Text("Internal note").tag(true)
            }
            .pickerStyle(.segmented)

            HStack(alignment: .bottom, spacing: 8) {
                TextField(placeholder, text: $model.draft, axis: .vertical)
                    .lineLimit(1...6)
                    .textFieldStyle(.plain)
                    .focused($focused)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .background(
                        OS1VisualStyle.panel,
                        in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                    )
                Button {
                    Task { await model.send() }
                } label: {
                    if model.sending == .sending {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "arrow.up")
                            .foregroundStyle(OS1VisualStyle.onAccent)
                    }
                }
                .frame(width: 34, height: 34)
                .background(
                    model.canSend ? OS1VisualStyle.accent : OS1VisualStyle.hover,
                    in: Circle()
                )
                // One send at a time, and never an automatic retry: a reply is
                // an email to a customer and the route has no idempotency key,
                // so a second attempt is a second email.
                .disabled(!model.canSend)
                .buttonStyle(.plain)
                .accessibilityLabel(model.isNoteMode ? "Add note" : "Send reply")
            }

            Text(footnote)
                .font(.caption2)
                .foregroundStyle(footnoteColor)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(.bar)
    }

    private var placeholder: String {
        model.isNoteMode
            ? "Internal note for the team (English)…"
            : "Reply to \(model.thread?.customerLabel ?? "the customer") — sent via Plain…"
    }

    /// Says who the customer will see it from, and afterwards what actually
    /// happened: a reply falls back to the workspace bot when the sender has
    /// no Plain grant of their own, and that changes the name on the email.
    private var footnote: String {
        switch model.sending {
        case .failed(let message):
            return "Not sent: \(message). Check Plain before sending again."
        case .sent(let asUser, let wasNote):
            if wasNote { return "Note added." }
            return asUser
                ? "Sent as you."
                : "Sent — as the workspace bot, not your Plain account."
        case .sending:
            return model.isNoteMode ? "Adding note…" : "Sending…"
        case .idle:
            let me = ServerConfig.shared.userName
            if model.isNoteMode {
                return "Only the team sees this."
            }
            return me.isEmpty
                ? "Sent via Plain."
                : "Sent via Plain, signed \"\(me)\"."
        }
    }

    private var footnoteColor: Color {
        if case .failed = model.sending { return OS1VisualStyle.red }
        return OS1VisualStyle.textFaint
    }
}
