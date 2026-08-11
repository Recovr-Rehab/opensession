import Foundation
import Observation

/// Drives the catch-up deck: a frozen queue of unread workspaces, the glance
/// each card shows, and the archive / read / keep decisions — with one level of
/// undo, because two of the three change state and one of those is destructive.
@Observable
@MainActor
final class CatchUpViewModel {
    enum Action: String, Equatable, Sendable, CaseIterable {
        case archive, read, keep

        var pastTense: String {
            switch self {
            case .archive: "Archived"
            case .read: "Marked read"
            case .keep: "Kept unread"
            }
        }
    }

    /// The glance a card shows: what you asked, and where things stand. Not a
    /// transcript — the deck is for deciding, and the whole conversation is one
    /// tap away.
    struct Preview: Equatable, Sendable {
        var prompt: String?
        var latest: String?
        var failed = false

        var isEmpty: Bool { prompt == nil && latest == nil }
    }

    /// A decision that can still be taken back.
    struct Undoable: Equatable, Sendable {
        let card: CatchUpCard
        let action: Action
        /// Where the card sat, so undo puts it back rather than on the end.
        let index: Int
    }

    private(set) var cards: [CatchUpCard] = []
    private(set) var index = 0
    private(set) var previews: [String: Preview] = [:]
    private(set) var undoable: Undoable?
    /// How many decisions this run — what the finish screen reports.
    private(set) var handled = 0
    /// True until both inputs have answered. "All caught up" is a CLAIM: made
    /// before the sessions list and the read marks land, it is
    /// indistinguishable from a queue that simply never loaded — which is
    /// exactly what a deck opened straight from a cold launch used to show.
    private(set) var isSettling = true

    /// The queue is built ONCE, on the first load that has sessions in it, and
    /// then frozen: our own mark-read and archive calls (and the 5s poll behind
    /// them) would otherwise reshuffle the deck under the card being swiped.
    /// Freezing on the first build with rows — rather than the first build at
    /// all — keeps a cold launch from stranding the deck on "All caught up"
    /// before the sessions list has answered.
    private var frozen = false

    private var loading: Set<String> = []
    private var undoExpiry: Task<Void, Never>?
    private weak var list: SessionsListViewModel?

    var current: CatchUpCard? { card(at: index) }
    var next: CatchUpCard? { card(at: index + 1) }
    var following: CatchUpCard? { card(at: index + 2) }
    var remaining: Int { max(0, cards.count - index) }
    var isDone: Bool { !cards.isEmpty && index >= cards.count }
    var isEmpty: Bool { cards.isEmpty }

    private func card(at position: Int) -> CatchUpCard? {
        cards.indices.contains(position) ? cards[position] : nil
    }

    /// The card `offset` places behind the current one. The deck renders one
    /// slot deeper than it shows, so a card fades in while the swipe in front
    /// of it is still happening.
    func card(atOffset offset: Int) -> CatchUpCard? { card(at: index + offset) }

    // MARK: - Building

    /// Wait for the deck to have something true to say, then stop waiting.
    ///
    /// The sessions list is multi-megabyte and the read marks are their own
    /// request, so opening the deck from a launch (or the `OS1_OPEN_CATCHUP`
    /// hook) beats both. Retrying until either the queue has cards or both
    /// inputs have answered is what turns a permanent "All caught up" into a
    /// brief wait. There is deliberately no deadline: an unread count before
    /// the reads hydrate is not an estimate, it is an unsupported claim.
    func settle(from list: SessionsListViewModel) async {
        while !Task.isCancelled {
            rebuild(from: list)
            if !cards.isEmpty { break }
            if list.hasLoaded, ReadsStore.shared.hasHydrated { break }
            try? await Task.sleep(for: .milliseconds(250))
        }
        isSettling = false
    }

    /// Build (or rebuild, until frozen) the queue from the list the sessions
    /// screen already polls. Cheap enough to call on every appearance.
    func rebuild(from list: SessionsListViewModel) {
        self.list = list
        guard !frozen else { return }
        let reads = ReadsStore.shared
        let config = ServerConfig.shared
        let built = CatchUpQueue.build(
            sessions: list.sessions,
            workspaceNames: list.workspaceNames,
            viewerName: config.userName,
            viewerLogin: config.githubLogin,
            isUnread: { reads.isUnread($0) }
        )
        cards = built
        if !built.isEmpty { frozen = true }
        prefetch()
    }

    // MARK: - Decisions

    func act(_ action: Action) {
        guard let card = current else { return }
        switch action {
        case .read:
            for session in card.sessions { ReadsStore.shared.markRead(session) }
        case .archive:
            // Archiving is enough on its own — an archived row is off the list,
            // and leaving its read mark alone is what lets undo restore it to
            // the unread state it actually had.
            for session in card.sessions { list?.archive(session) }
        case .keep:
            break
        }
        undoable = Undoable(card: card, action: action, index: index)
        index += 1
        handled += 1
        scheduleUndoExpiry()
        prefetch()
    }

    /// Put the last decision back — the card returns to where it was and the
    /// state change is reversed.
    func undo() {
        guard let entry = undoable else { return }
        undoExpiry?.cancel()
        undoExpiry = nil
        undoable = nil
        switch entry.action {
        case .read:
            for session in entry.card.sessions { ReadsStore.shared.markUnread(session) }
        case .archive:
            for session in entry.card.sessions { list?.unarchive(session) }
        case .keep:
            break
        }
        index = entry.index
        handled = max(0, handled - 1)
    }

    func dismissUndo() {
        undoExpiry?.cancel()
        undoExpiry = nil
        undoable = nil
    }

    /// A reply lands like a right-swipe: the workspace is read, and the deck
    /// moves on. Delivery goes through the outbox, so it survives a bad network
    /// and the deck doesn't have to hold a socket open per card.
    func reply(_ text: String) {
        guard let card = current else { return }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        Outbox.shared.enqueue(
            sessionId: card.target.id,
            content: trimmed,
            // The composer's own preference, read the way it reads it — a reply
            // from here must land the same way one typed in the session would.
            busyMode: UserDefaults.standard.string(forKey: "os1.composer.busySend")
                ?? "queue",
            user: ServerConfig.shared.userName
        )
        act(.read)
    }

    private func scheduleUndoExpiry() {
        undoExpiry?.cancel()
        let pending = undoable
        undoExpiry = Task { [weak self] in
            try? await Task.sleep(for: .seconds(6))
            guard !Task.isCancelled, let self, self.undoable == pending else { return }
            self.undoable = nil
        }
    }

    // MARK: - Previews

    /// Load the glance for the current card and the one behind it. Prefetching
    /// the next one is what makes a swipe land on content rather than on a
    /// placeholder — the whole reason the deck feels immediate.
    func prefetch() {
        for card in [current, next].compactMap({ $0 }) {
            Task { await loadPreview(for: card) }
        }
    }

    func loadPreview(for card: CatchUpCard) async {
        guard previews[card.id] == nil, !loading.contains(card.id) else { return }
        loading.insert(card.id)
        defer { loading.remove(card.id) }
        do {
            let entries = try await OS1API.transcript(sessionId: card.target.id)
            previews[card.id] = Self.preview(from: entries)
        } catch {
            previews[card.id] = Preview(prompt: nil, latest: nil, failed: true)
        }
    }

    /// Longest prose a card shows before it fades out. A glance, and a ceiling
    /// on what the markdown renderer is handed per card.
    private static let previewCeiling = 1_200

    nonisolated static func preview(from entries: [TranscriptEntry]) -> Preview {
        // The opening ask, skipping slash commands and image-only sends — the
        // same rule the workspace overview panel uses server-side.
        let prompt = entries.first {
            $0.isUser && $0.notice == nil && isProse($0.text) && !$0.text
                .trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("/")
        }
        let latest = entries.last { $0.isAssistant && isProse($0.text) }
        return Preview(
            prompt: prompt.map { clamp($0.text) },
            latest: latest.map { clamp($0.text) },
            failed: false
        )
    }

    private nonisolated static func isProse(_ text: String) -> Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private nonisolated static func clamp(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > previewCeiling else { return trimmed }
        let head = trimmed.prefix(previewCeiling)
        // Cut on a line break so the fade never lands mid-word or, worse,
        // inside an unclosed markdown fence.
        if let lastBreak = head.lastIndex(of: "\n"), lastBreak > head.startIndex {
            return String(head[head.startIndex..<lastBreak])
        }
        return String(head)
    }
}
