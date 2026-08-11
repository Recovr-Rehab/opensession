import SwiftUI

/// A native committed-diff review surface. Inline notes remain local until the
/// reviewer submits one GitHub review, matching GitHub's pending-review model.
struct PrReviewCanvas: View {
    let viewModel: SessionViewModel

    @State private var diff: PrDiff?
    @State private var files: [PrPatchFile] = []
    @State private var viewed = Set<String>()
    @State private var viewedPrId: String?
    @State private var loading = true
    @State private var errorText: String?
    @State private var draftComments: [PrInlineComment] = []
    @State private var commentTarget: PrLineTarget?
    @State private var submitting = false
    @State private var reviewing = false

    var body: some View {
        Group {
            if loading && diff == nil {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let errorText, diff == nil {
                ListPlaceholder(
                    symbol: "exclamationmark.triangle",
                    title: "Couldn't load pull request files",
                    message: errorText
                ) {
                    Button("Try again") { Task { await load() } }
                        .buttonStyle(PlaceholderActionStyle())
                }
            } else if files.isEmpty {
                ListPlaceholder(
                    symbol: "doc.text",
                    title: "No committed changes",
                    message: "This pull request has no textual diff to review."
                ) { EmptyView() }
            } else {
                fileList
            }
        }
        .navigationTitle("Files changed")
        .inlineTitleBarCompat()
        .toolbar {
            ToolbarItem(placement: .topTrailingCompat) {
                if submitting {
                    ProgressView().controlSize(.small)
                } else if !draftComments.isEmpty {
                    Button("Review") { reviewing = true }
                } else {
                    Button { Task { await load() } } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                }
            }
        }
        .task { await load() }
        .sheet(item: $commentTarget) { target in
            PrInlineCommentSheet(target: target) { text in
                upsertComment(path: target.path, line: target.line, text: text)
            }
        }
        .sheet(isPresented: $reviewing) {
            PrPendingReviewSheet(commentCount: draftComments.count) { event, summary in
                try await viewModel.submitPrReview(
                    event: event,
                    summary: summary,
                    comments: draftComments
                )
                draftComments = []
            }
        }
    }

    private var fileList: some View {
        List {
            if !draftComments.isEmpty {
                Section {
                    Text("\(draftComments.count) pending inline comment\(draftComments.count == 1 ? "" : "s")")
                        .foregroundStyle(.secondary)
                } footer: {
                    Text("Comments are saved locally until you submit one review.")
                }
            }
            Section {
                ForEach(files) { file in
                    NavigationLink(value: file) {
                        fileRow(file)
                    }
                }
            } header: {
                Text("\(files.count) file\(files.count == 1 ? "" : "s") changed")
            } footer: {
                if let skipped = diff?.skippedFiles, skipped > 0 {
                    Text("\(skipped) file\(skipped == 1 ? " was" : "s were") omitted because the patch is too large.")
                }
            }
        }
        .insetGroupedListCompat()
        .navigationDestination(for: PrPatchFile.self) { file in
            PrReviewFileView(
                file: file,
                isViewed: viewed.contains(file.path),
                commentCount: draftComments.filter { $0.path == file.path }.count,
                toggleViewed: { toggleViewed(file.path) },
                comment: { line in commentTarget = PrLineTarget(path: file.path, line: line) }
            )
        }
        .refreshable { await load() }
    }

    private func fileRow(_ file: PrPatchFile) -> some View {
        HStack(spacing: 10) {
            Image(systemName: viewed.contains(file.path) ? "checkmark.circle.fill" : "circle")
                .foregroundStyle(viewed.contains(file.path) ? .green : .secondary)
            VStack(alignment: .leading, spacing: 2) {
                Text(file.path).font(.subheadline.monospaced())
                    .lineLimit(1).truncationMode(.middle)
                let notes = draftComments.filter { $0.path == file.path }.count
                if notes > 0 {
                    Text("\(notes) pending comment\(notes == 1 ? "" : "s")")
                        .font(.caption).foregroundStyle(.orange)
                }
            }
        }
    }

    private func load() async {
        loading = true
        errorText = nil
        do {
            async let loadedDiff = OS1API.prDiff(sessionId: viewModel.session.id)
            guard let patch = try await loadedDiff else {
                diff = nil
                files = []
                loading = false
                return
            }
            let parsed = await Task.detached(priority: .userInitiated) {
                PrPatchParser.files(in: patch.patch)
            }.value
            diff = patch
            files = parsed
            if let fileState = try? await OS1API.prViewedFiles(
                repo: viewModel.session.repo,
                number: patch.number
            ) {
                viewedPrId = fileState.prId
                viewed = Set(fileState.viewed)
            }
        } catch {
            errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
        }
        loading = false
    }

    private func toggleViewed(_ path: String) {
        guard let viewedPrId else { return }
        let target = !viewed.contains(path)
        if target { viewed.insert(path) } else { viewed.remove(path) }
        Task {
            do {
                try await OS1API.setPrFileViewed(prId: viewedPrId, path: path, viewed: target)
            } catch {
                if target { viewed.remove(path) } else { viewed.insert(path) }
                errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    private func upsertComment(path: String, line: Int, text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let comment = PrInlineComment(path: path, line: line, text: trimmed)
        draftComments.removeAll { $0.id == comment.id }
        draftComments.append(comment)
    }
}

private struct PrReviewFileView: View {
    let file: PrPatchFile
    let isViewed: Bool
    let commentCount: Int
    let toggleViewed: () -> Void
    let comment: (Int) -> Void

    var body: some View {
        ScrollView([.horizontal, .vertical]) {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(file.lines) { line in
                    PrReviewLineView(line: line, comment: comment)
                }
            }
            .frame(minWidth: 680, alignment: .leading)
            .padding(.vertical, 8)
        }
        .background(OS1VisualStyle.background)
        .navigationTitle(file.path.split(separator: "/").last.map(String.init) ?? file.path)
        .inlineTitleBarCompat()
        .toolbar {
            ToolbarItem(placement: .topTrailingCompat) {
                Button(action: toggleViewed) {
                    Label(isViewed ? "Mark unviewed" : "Mark viewed", systemImage: isViewed ? "eye.slash" : "eye")
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            if commentCount > 0 {
                Text("\(commentCount) pending inline comment\(commentCount == 1 ? "" : "s")")
                    .font(.caption.weight(.medium))
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(.thinMaterial, in: Capsule())
                    .padding(.bottom, 8)
            }
        }
    }
}

private struct PrReviewLineView: View {
    let line: PrPatchLine
    let comment: (Int) -> Void

    var body: some View {
        HStack(spacing: 0) {
            Text(line.oldLine.map(String.init) ?? "")
                .frame(width: 44, alignment: .trailing)
            Text(line.newLine.map(String.init) ?? "")
                .frame(width: 44, alignment: .trailing)
            Text(line.text.isEmpty ? " " : line.text)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, 10)
            if let anchor = line.commentLine {
                Button { comment(anchor) } label: {
                    Image(systemName: "plus.bubble")
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 8)
                .accessibilityLabel("Add inline comment on line \(anchor)")
            } else {
                Color.clear.frame(width: 36)
            }
        }
        .font(.system(.caption, design: .monospaced))
        .foregroundStyle(foreground)
        .background(background)
        .textSelection(.enabled)
    }

    private var foreground: Color {
        switch line.kind {
        case .addition: OS1VisualStyle.green
        case .deletion: OS1VisualStyle.red
        case .metadata: OS1VisualStyle.blue
        case .context: OS1VisualStyle.codeWellText
        }
    }

    private var background: Color {
        switch line.kind {
        case .addition: OS1VisualStyle.green.opacity(0.10)
        case .deletion: OS1VisualStyle.red.opacity(0.10)
        default: .clear
        }
    }
}

private struct PrLineTarget: Identifiable {
    let path: String
    let line: Int
    var id: String { "\(path):\(line)" }
}

private struct PrInlineCommentSheet: View {
    let target: PrLineTarget
    let save: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("\(target.path):\(target.line)").font(.caption.monospaced())
                }
                Section("Comment") {
                    TextEditor(text: $text).frame(minHeight: 140).focused($focused)
                }
            }
            .navigationTitle("Inline comment")
            .inlineTitleBarCompat()
            .toolbar {
                ToolbarItem(placement: .topLeadingCompat) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topTrailingCompat) {
                    Button("Add") { save(text); dismiss() }
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .task { focused = true }
        #if os(macOS)
        .frame(minWidth: 440, minHeight: 360)
        #endif
    }
}

private struct PrPendingReviewSheet: View {
    let commentCount: Int
    let submit: (String, String) async throws -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var event = "COMMENT"
    @State private var summary = ""
    @State private var sending = false
    @State private var errorText: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text("\(commentCount) inline comment\(commentCount == 1 ? "" : "s") will be submitted together.")
                }
                Section {
                    Picker("Review", selection: $event) {
                        Text("Comment").tag("COMMENT")
                        Text("Approve").tag("APPROVE")
                        Text("Request changes").tag("REQUEST_CHANGES")
                    }.pickerStyle(.segmented).labelsHidden()
                }
                Section("Summary") { TextEditor(text: $summary).frame(minHeight: 110) }
                if let errorText { Section { Text(errorText).foregroundStyle(.red) } }
            }
            .navigationTitle("Submit review")
            .inlineTitleBarCompat()
            .toolbar {
                ToolbarItem(placement: .topLeadingCompat) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .topTrailingCompat) {
                    if sending { ProgressView().controlSize(.small) } else {
                        Button("Submit") { send() }
                    }
                }
            }
            .disabled(sending)
        }
        #if os(macOS)
        .frame(minWidth: 440, minHeight: 400)
        #endif
    }

    private func send() {
        sending = true
        errorText = nil
        Task {
            do {
                try await submit(event, summary)
                dismiss()
            } catch {
                errorText = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
            sending = false
        }
    }
}
