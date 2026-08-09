import Foundation

/// The notes list behind the Notes sheet. Loads once per appearance and on
/// pull-to-refresh; the list is small (tens of rows) and changes rarely, so it
/// does not poll the way the sessions list does.
@MainActor
@Observable
final class NotesListModel {
    private(set) var notes: [NoteSummary] = []
    private(set) var isLoading = false
    private(set) var errorText: String?

    func load() async {
        if notes.isEmpty { isLoading = true }
        do {
            notes = try await OS1API.notes()
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
        isLoading = false
    }

    /// Create a note and hand back its id so the caller can open it straight
    /// away — a new note is empty apart from its heading, so landing on the
    /// list instead would show a row with nothing in it.
    func create(title: String) async -> String? {
        do {
            let note = try await OS1API.createNote(title: title)
            notes.insert(note, at: 0)
            return note.id
        } catch {
            errorText = error.localizedDescription
            return nil
        }
    }

    func delete(id: String) async {
        let previous = notes
        notes.removeAll { $0.id == id }
        do {
            try await OS1API.deleteNote(id: id)
        } catch {
            notes = previous
            errorText = error.localizedDescription
        }
    }
}

/// One open note: its text, who else is in it, and the save loop.
///
/// The web editor is a Yjs CRDT over the shared socket; this app has no CRDT,
/// so it reads and writes whole documents over REST and uses the socket purely
/// as a change bell (`note_update`) and a presence feed. Two things keep that
/// honest:
///
/// - Every save carries `ifMatch`, the hash of the text the edit was based on.
///   The server refuses a stale write instead of letting it revert whatever
///   somebody else typed in the meantime (`NoteConflict`).
/// - A remote change while the buffer is clean is adopted silently; while it
///   is dirty it raises a banner rather than yanking the text out from under
///   the person typing.
@MainActor
@Observable
final class NoteEditorModel {
    enum Status: Equatable {
        case loading
        case idle
        case saving
        case saved
        case failed(String)
    }

    let noteId: String
    var title: String

    /// The editable buffer. Hot state — only the editor pane reads it, so a
    /// keystroke doesn't re-evaluate the surrounding screen.
    var draft: String = "" {
        didSet {
            guard !isApplyingRemote, draft != oldValue else { return }
            isDirty = draft != savedText
            if isDirty { scheduleSave() }
        }
    }

    private(set) var status: Status = .loading
    private(set) var isDirty = false
    /// Other people with this note open, by display name (never us).
    private(set) var viewers: [String] = []
    /// Someone else changed the note while we had unsaved edits.
    private(set) var hasRemoteChanges = false
    /// A save the server refused; the UI asks whose text wins.
    private(set) var conflict: NoteConflict?

    private var savedText = ""
    private var baseHash: String?
    private var isApplyingRemote = false
    private var saveTask: Task<Void, Never>?
    private var refreshTask: Task<Void, Never>?
    private var socket: OS1Socket?

    /// Long enough that a sentence is one save rather than twenty (each is a
    /// Yjs transaction broadcast to every web editor), short enough that
    /// leaving the screen rarely has anything left to flush.
    private let saveDebounce: Duration = .seconds(2)

    init(noteId: String, title: String) {
        self.noteId = noteId
        self.title = title
    }

    // MARK: - Lifecycle

    func start() async {
        await reload()
        connect()
    }

    func stop() {
        saveTask?.cancel()
        refreshTask?.cancel()
        socket?.leaveNote()
        socket?.disconnect()
        socket = nil
    }

    private func reload() async {
        do {
            let document = try await OS1API.note(id: noteId)
            apply(text: document.text, hash: document.hash)
            if let serverTitle = document.title, !serverTitle.isEmpty {
                title = serverTitle
            }
            status = .idle
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    private func apply(text: String, hash: String?) {
        isApplyingRemote = true
        draft = text
        isApplyingRemote = false
        savedText = text
        baseHash = hash
        isDirty = false
        hasRemoteChanges = false
    }

    // MARK: - Saving

    private func scheduleSave() {
        saveTask?.cancel()
        saveTask = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(for: saveDebounce)
            if Task.isCancelled { return }
            await save()
        }
    }

    /// Write now — on leaving the screen, backgrounding, or toggling out of
    /// edit mode. A debounce that only fires on idle would otherwise lose the
    /// last two seconds of typing to a dismiss.
    func flush() async {
        saveTask?.cancel()
        saveTask = nil
        guard isDirty, conflict == nil else { return }
        await save()
    }

    private func save() async {
        let pending = draft
        guard pending != savedText else {
            isDirty = false
            return
        }
        status = .saving
        do {
            let hash = try await OS1API.saveNote(
                id: noteId,
                text: pending,
                ifMatch: baseHash
            )
            savedText = pending
            baseHash = hash
            // More was typed while the save was in flight: that text is still
            // unsaved, and the debounce that queued it has already fired.
            isDirty = draft != savedText
            status = .saved
            if isDirty { scheduleSave() }
        } catch let conflictError as NoteConflict {
            conflict = conflictError
            status = .idle
        } catch {
            status = .failed(error.localizedDescription)
        }
    }

    // MARK: - Conflict resolution

    /// Keep what's on the phone: rebase onto the server's text and write over
    /// it. An informed overwrite, unlike the silent one `ifMatch` prevents.
    func resolveKeepingMine() {
        baseHash = conflict?.hash
        savedText = conflict?.serverText ?? savedText
        conflict = nil
        isDirty = true
        Task { await save() }
    }

    /// Take the server's text and drop the local edits.
    func resolveTakingTheirs() {
        guard let conflict else { return }
        apply(text: conflict.serverText, hash: conflict.hash)
        self.conflict = nil
        status = .idle
    }

    // MARK: - Socket

    private func connect() {
        let socket = OS1Socket()
        self.socket = socket
        socket.onEvent = { [weak self] event in
            self?.handle(event)
        }
        // Freshness is nice-to-have here: a dropped socket leaves the note
        // readable and savable, and re-entering the screen reconnects. No
        // reconnect ladder for v1.
        socket.onClose = { [weak self] _ in
            self?.viewers = []
        }
        socket.connect()
    }

    private func handle(_ event: ServerEvent) {
        switch event {
        case .hello:
            socket?.watchNote(
                noteId: noteId,
                user: ServerConfig.shared.userName
            )
        case .noteChanged(let id) where id == noteId:
            noteChangedRemotely()
        case .notePresence(let id, let names) where id == noteId:
            let me = ServerConfig.shared.userName
            viewers = names.filter { $0 != me }
        default:
            break
        }
    }

    private func noteChangedRemotely() {
        refreshTask?.cancel()
        refreshTask = Task { [weak self] in
            // Coalesce: a web editor emits updates at typing speed, and our
            // own save comes back to us as one of these too.
            try? await Task.sleep(for: .milliseconds(600))
            if Task.isCancelled { return }
            await self?.checkRemote()
        }
    }

    /// What the bell actually means, decided by looking rather than assuming.
    ///
    /// The server broadcasts our own write back to us, so "an update arrived
    /// while I have unsaved text" is not enough to claim someone else typed —
    /// saying so put a "changed on the server" banner over the user's own
    /// save. Compare against the text we last wrote instead: same text, same
    /// author; different text, somebody else.
    private func checkRemote() async {
        guard let document = try? await OS1API.note(id: noteId) else { return }
        if document.text == savedText {
            baseHash = document.hash
            return
        }
        if isDirty || conflict != nil {
            hasRemoteChanges = true
            return
        }
        apply(text: document.text, hash: document.hash)
        if let title = document.title, !title.isEmpty { self.title = title }
    }

    /// Discard local edits and take whatever the server has now — the action
    /// behind the "changed on the server" banner.
    func adoptRemote() async {
        saveTask?.cancel()
        await reload()
    }
}
