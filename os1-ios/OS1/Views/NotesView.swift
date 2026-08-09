import SwiftUI

/// The shared notes, on the phone.
///
/// Notes are the one thing in the web app that lives beside your chats without
/// being one — everyone on the instance reads and writes the same markdown
/// docs. This is the native half of that surface: a list, a note, and an
/// editor. It presents as a sheet with its own `NavigationStack` for the same
/// reason the Desk does: the sessions list's stack is typed `[Session]`, and a
/// place you visit is not a step in the chat you were reading.
///
/// What the web has and this deliberately does not (yet): the read-only wiki
/// tree, search, backlinks, mention chips, pinning, and live cursors. Cursors
/// are impossible without a Swift Yjs; the rest are scope.
struct NotesSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var model = NotesListModel()
    @State private var path: [NoteSummary] = []
    @State private var newTitle = ""
    @State private var isNaming = false

    var body: some View {
        NavigationStack(path: $path) {
            list
                .navigationTitle("Notes")
                .inlineTitleBarCompat()
                .navigationDestination(for: NoteSummary.self) { note in
                    NoteDetailView(note: note)
                }
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                    // Compose sits at the bottom-right, where Notes and Mail
                    // put it and where a thumb is — beside Done it read as a
                    // second confirmation.
                    #if os(iOS)
                    ToolbarSpacer(.flexible, placement: .bottomBar)
                    ToolbarItem(placement: .bottomBar) { newNoteButton }
                    #else
                    ToolbarItem(placement: .topTrailingCompat) { newNoteButton }
                    #endif
                }
                .alert("New note", isPresented: $isNaming) {
                    TextField("Title", text: $newTitle)
                    Button("Cancel", role: .cancel) {}
                    Button("Create") { create() }
                } message: {
                    Text("Everyone on this instance can read and edit it.")
                }
        }
        .task {
            await model.load()
            #if DEBUG
            // Dev loop: land on a note without a tap (see the Desk's own hook
            // in SessionsListView).
            if let id = ProcessInfo.processInfo.environment["OS1_OPEN_NOTE"],
               let note = model.notes.first(where: { $0.id == id }) {
                path = [note]
            }
            #endif
        }
    }

    private var newNoteButton: some View {
        Button {
            newTitle = ""
            isNaming = true
        } label: {
            Image(systemName: "square.and.pencil")
                .foregroundStyle(OS1VisualStyle.text)
        }
        .accessibilityLabel("New note")
    }

    @ViewBuilder
    private var list: some View {
        if model.isLoading {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if model.notes.isEmpty {
            ListPlaceholder(
                symbol: "note.text",
                title: "No notes yet",
                message: model.errorText
                    ?? "Notes are shared with everyone on this instance."
            ) {
                Button("New note") {
                    newTitle = ""
                    isNaming = true
                }
                .buttonStyle(PlaceholderActionStyle())
            }
        } else {
            List {
                ForEach(model.notes) { note in
                    NavigationLink(value: note) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(note.title)
                                .font(.body.weight(.medium))
                                .lineLimit(2)
                            if let updated = note.updated {
                                Text(
                                    updated,
                                    format: .relative(presentation: .named)
                                )
                                .font(.footnote)
                                .foregroundStyle(OS1VisualStyle.textDim)
                            }
                        }
                        .padding(.vertical, 2)
                    }
                    .swipeActions(edge: .trailing) {
                        // Destructive for everyone, not just for you — hence
                        // the confirmation the swipe alone doesn't carry.
                        Button(role: .destructive) {
                            Task { await model.delete(id: note.id) }
                        } label: {
                            Label("Delete", systemImage: "trash")
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

    private func create() {
        let title = newTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else { return }
        Task {
            guard let id = await model.create(title: title) else { return }
            // Open it straight away: a fresh note is a heading and nothing
            // else, so the list has nothing to show you about it.
            path.append(
                NoteSummary(id: id, title: title, updatedAt: nil)
            )
        }
    }
}

/// One note: rendered by default, editable on demand.
///
/// Reading is the dominant mode on a phone — raw markdown as a landing screen
/// would show link syntax and mention targets where the web shows prose — so
/// this inverts the web editor's Edit/Preview default rather than copying it.
struct NoteDetailView: View {
    let note: NoteSummary
    @State private var model: NoteEditorModel
    @State private var isEditing = false
    @Environment(\.scenePhase) private var scenePhase

    init(note: NoteSummary) {
        self.note = note
        _model = State(
            initialValue: NoteEditorModel(noteId: note.id, title: note.title)
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            banner
            if isEditing {
                NoteEditorPane(model: model)
            } else {
                reader
            }
        }
        .background(OS1VisualStyle.background)
        .navigationTitle(model.title)
        .inlineTitleBarCompat()
        .toolbar {
            ToolbarItem(placement: .topTrailingCompat) {
                Button(isEditing ? "Done" : "Edit") {
                    isEditing.toggle()
                    // Leaving the editor is a save point: the debounce may
                    // still be counting, and the next thing the reader shows
                    // should be what's on the server.
                    if !isEditing { Task { await model.flush() } }
                }
            }
        }
        .safeAreaInset(edge: .bottom) { statusBar }
        .task { await model.start() }
        .onDisappear {
            Task {
                await model.flush()
                model.stop()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            // A phone going to sleep mid-sentence is the common way to lose
            // the last debounce window.
            if phase != .active { Task { await model.flush() } }
        }
        .alert(
            "This note changed while you were editing",
            isPresented: Binding(
                get: { model.conflict != nil },
                set: { if !$0 { model.resolveTakingTheirs() } }
            )
        ) {
            Button("Keep mine") { model.resolveKeepingMine() }
            Button("Use theirs", role: .cancel) { model.resolveTakingTheirs() }
        } message: {
            Text(
                "Someone else saved a different version. Keeping yours replaces theirs."
            )
        }
    }

    @ViewBuilder
    private var reader: some View {
        ScrollView {
            Group {
                if model.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text("This note is empty. Tap Edit to write something.")
                        .font(.subheadline)
                        .foregroundStyle(OS1VisualStyle.textDim)
                        .frame(maxWidth: .infinity, alignment: .leading)
                } else {
                    MarkdownBody(model.draft)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: OS1VisualStyle.sessionMaxWidth, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// One strip, not a stack of them: the only banner worth interrupting for
    /// is "what you're reading is no longer what's on the server".
    @ViewBuilder
    private var banner: some View {
        if model.hasRemoteChanges {
            HStack(spacing: 8) {
                Image(systemName: "arrow.triangle.2.circlepath")
                Text("Changed on the server")
                Spacer(minLength: 8)
                Button("Reload") { Task { await model.adoptRemote() } }
                    .buttonStyle(.borderless)
            }
            .font(.footnote)
            .foregroundStyle(OS1VisualStyle.text)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(OS1VisualStyle.yellow.opacity(0.18))
        }
    }

    /// Save state and company, at the size of things you glance at.
    @ViewBuilder
    private var statusBar: some View {
        let line = statusLine
        if !line.isEmpty {
            Text(line)
                .font(.footnote)
                .foregroundStyle(OS1VisualStyle.textDim)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(.bar)
        }
    }

    private var statusLine: String {
        var parts: [String] = []
        switch model.status {
        case .loading: parts.append("Loading…")
        case .saving: parts.append("Saving…")
        case .saved: parts.append(model.isDirty ? "Unsaved changes" : "Saved")
        case .failed(let message): parts.append(message)
        case .idle: if model.isDirty { parts.append("Unsaved changes") }
        }
        if !model.viewers.isEmpty {
            let names = model.viewers.joined(separator: ", ")
            parts.append("\(names) \(model.viewers.count == 1 ? "is" : "are") also here")
        }
        return parts.joined(separator: " · ")
    }
}

/// The editor lives in its own view struct so a keystroke re-evaluates this
/// and nothing else — the same rule `SessionInputBar` follows for the
/// composer's draft.
private struct NoteEditorPane: View {
    @Bindable var model: NoteEditorModel
    /// Edit is a decision, so the keyboard comes with it — tapping Edit and
    /// then having to tap the text as well is a second ask for something you
    /// already said.
    @FocusState private var isFocused: Bool

    var body: some View {
        TextEditor(text: $model.draft)
            .focused($isFocused)
            .onAppear { isFocused = true }
            // Markdown is code as much as prose: a proportional font hides
            // the alignment of lists and fences, and smart quotes silently
            // corrupt them.
            .font(.system(.body, design: .monospaced))
            .autocorrectionDisabled()
            .noAutocapitalizationCompat()
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            #if os(iOS)
            .scrollContentBackground(.hidden)
            #endif
            .background(OS1VisualStyle.background)
    }
}
