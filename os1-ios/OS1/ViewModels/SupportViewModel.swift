import Foundation

/// The Plain Todo queue.
///
/// Polling only: Plain has no push into this app, and the `/ws` socket carries
/// session events, not tickets. Staleness stacks — the server caches the queue
/// for 30s under this poll — so the thread screen refetches itself rather than
/// trusting a row.
@MainActor
@Observable
final class SupportQueueModel {
    private(set) var threads: [SupportThreadSummary] = []
    private(set) var isLoading = false
    private(set) var errorText: String?

    /// Lanes, in Plain's own priority order, empty ones dropped. The web
    /// sidebar groups the same way; a flat list by time buries the urgent
    /// ones under whatever arrived last.
    var lanes: [(priority: SupportPriority, threads: [SupportThreadSummary])] {
        SupportPriority.allCases.compactMap { priority in
            let rows = threads.filter { $0.lane == priority }
            return rows.isEmpty ? nil : (priority, rows)
        }
    }

    /// The queue in lane order, flattened — what a band shows when it only has
    /// room for the top of it. Plain's own ordering (most recently moved to
    /// Todo first) survives within each lane.
    var prioritised: [SupportThreadSummary] {
        lanes.flatMap(\.threads)
    }

    func load() async {
        if threads.isEmpty { isLoading = true }
        do {
            threads = try await OS1API.supportThreads()
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
        isLoading = false
    }

    /// Drop a row the moment it leaves the queue, so the list doesn't hold a
    /// ticket you just finished for the length of the server's cache.
    func forget(id: String) {
        threads.removeAll { $0.id == id }
    }
}

/// One open ticket: its timeline, the composer's state, and the status
/// actions.
@MainActor
@Observable
final class SupportThreadModel {
    enum Sending: Equatable {
        case idle
        case sending
        /// How the last reply actually left: as the teammate's own Plain user,
        /// or as the workspace bot.
        case sent(asUser: Bool, wasNote: Bool)
        case failed(String)
    }

    let threadId: String
    private(set) var thread: SupportThread?
    private(set) var isLoading = true
    private(set) var errorText: String?
    private(set) var sending: Sending = .idle
    /// Set once the ticket leaves the queue from here, so the list can drop
    /// the row without waiting out the server's 30s cache.
    private(set) var statusChanged = false

    /// The composer's two modes. A note never reaches the customer; a reply is
    /// an email to a real person, which is why sending is one-shot and never
    /// retried automatically.
    var isNoteMode = false
    var draft = ""

    private var pollTask: Task<Void, Never>?

    init(threadId: String) {
        self.threadId = threadId
    }

    func load() async {
        do {
            thread = try await OS1API.supportThread(id: threadId)
            errorText = nil
        } catch {
            errorText = error.localizedDescription
        }
        isLoading = false
    }

    /// The web polls this every 20s and skips while the tab is hidden; the
    /// phone equivalent is stopping when the screen goes away.
    func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(20))
                if Task.isCancelled { return }
                guard let self, sending == .idle else { continue }
                await load()
            }
        }
    }

    func stopPolling() {
        pollTask?.cancel()
        pollTask = nil
    }

    var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && sending != .sending
    }

    func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, sending != .sending else { return }
        let wasNote = isNoteMode
        sending = .sending
        do {
            let sentAs = try await OS1API.sendSupportReply(
                threadId: threadId,
                text: text,
                isNote: wasNote
            )
            draft = ""
            sending = .sent(asUser: sentAs == "user", wasNote: wasNote)
            // The reply route busts no cache, but the single-thread route is
            // uncached — so the new entry is one refetch away.
            await load()
        } catch {
            // Deliberately keeps the draft: a failed send may still have
            // reached Plain, and retyping a lost reply is worse than deciding
            // for yourself whether to send it again.
            sending = .failed(error.localizedDescription)
        }
    }

    func setStatus(_ status: String, durationSeconds: Int? = nil) async {
        do {
            try await OS1API.setSupportStatus(
                threadId: threadId,
                status: status,
                durationSeconds: durationSeconds
            )
            statusChanged = true
            await load()
        } catch {
            errorText = error.localizedDescription
        }
    }
}
