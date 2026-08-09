import Foundation

/// One shared note, as the list route describes it.
///
/// Notes are the web app's collaborative markdown docs (`~/.opensession-notes/`,
/// one Yjs doc each). They are shared by everyone on the instance — there is no
/// per-user scoping — which is why this app treats another person's edit as
/// something to merge with rather than something that can't happen.
struct NoteSummary: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let title: String
    /// Milliseconds since the epoch, from the `.md` snapshot's mtime — so it
    /// lags a live web edit by the server's persist debounce. Good enough to
    /// sort a list by; never a freshness check (that's `NoteDocument.hash`).
    let updatedAt: Double?

    var updated: Date? {
        updatedAt.map { Date(timeIntervalSince1970: $0 / 1000) }
    }
}

/// A note's text plus the version tag to send back when saving it.
struct NoteDocument: Decodable, Equatable, Sendable {
    let id: String
    let title: String?
    let text: String
    /// sha256 of `text`. Round-tripped as `ifMatch` on save so the server can
    /// refuse a write based on text somebody else has already moved on from —
    /// this client edits whole documents, so a stale buffer would otherwise
    /// carry the undo of every edit made in the meantime.
    let hash: String?
}

/// A save the server refused because the note changed underneath us. Carries
/// the current server text so the UI can offer "keep mine" / "take theirs"
/// without another round trip.
struct NoteConflict: Error, Sendable {
    let serverText: String
    let hash: String?
}
