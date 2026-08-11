import Foundation

private final class SafeImageRedirectDelegate: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        var redirected = request
        if let original = task.originalRequest?.url,
           let target = request.url,
           (original.scheme != target.scheme
            || original.host != target.host
            || original.port != target.port) {
            redirected.setValue(nil, forHTTPHeaderField: "Authorization")
        }
        completionHandler(redirected)
    }
}

/// Thin REST client for the Open Session HTTP API: reads, the occasional
/// mutation, and — through `deliverPrompt` — every message this app sends.
@MainActor
enum OS1API {
    private static let imageSession = URLSession(
        configuration: .default,
        delegate: SafeImageRedirectDelegate(),
        delegateQueue: nil
    )

    enum APIError: LocalizedError {
        case notConfigured
        case badURL
        case http(Int)
        case server(String)

        var errorDescription: String? {
            switch self {
            case .notConfigured: "Server URL or token not set — open Settings."
            case .badURL: "Invalid server URL."
            case .http(let code):
                code == 401
                    ? "Not signed in (401) — check your token in Settings."
                    : "Server returned HTTP \(code)."
            case .server(let message): message
            }
        }
    }

    /// The live sessions list — everything except archived.
    ///
    /// Archived sessions are the larger half of this instance's list and none
    /// of the first screen, so they travel on their own slice below. Asking
    /// for the live one is opt-in: a server that predates the parameter
    /// answers with the whole list, which still splits correctly downstream
    /// (`prepared` sorts archived rows out either way).
    static func sessions() async throws -> [Session] {
        try await get("/api/sessions?archived=exclude")
    }

    /// Archived sessions, as summaries.
    ///
    /// Each row carries what the Archived screen renders — title, repo,
    /// activity, who — and is marked `slim`, so anything that opens one
    /// hydrates it first (`session(id:)`). Barely changes between polls, so
    /// it settles into a 304 while the live slice keeps churning.
    static func archivedSessions() async throws -> [Session] {
        try await get("/api/sessions?archived=only&slim=1")
    }

    /// One session, whole. The list used to be the only source of a session
    /// object; this is what lets a client stop carrying every archived row
    /// and still open one.
    static func session(id: String) async throws -> Session {
        let encoded = id.addingPercentEncoding(
            withAllowedCharacters: .urlPathAllowed
        ) ?? id
        return try await get("/api/sessions/\(encoded)")
    }

    struct WorkspaceSummary: Decodable, Sendable {
        let id: String
        let name: String
    }

    /// Canonical workspace names for collapsing sibling sessions into one row.
    static func workspaces() async throws -> [WorkspaceSummary] {
        struct WorkspacesResponse: Decodable, Sendable {
            let workspaces: [WorkspaceSummary]
        }
        let response: WorkspacesResponse = try await get("/api/workspaces")
        return response.workspaces
    }

    static func transcript(sessionId: String) async throws -> [TranscriptEntry] {
        try await get("/api/sessions/\(sessionId)/transcript")
    }

    /// One sub-agent's transcript. `agentId` comes off the spawning Task
    /// call — its result's `agentId`, or the `ses_…` the result announces.
    static func subagent(
        sessionId: String,
        agentId: String
    ) async throws -> SubagentTranscript {
        let session = sessionId.addingPercentEncoding(
            withAllowedCharacters: .urlPathAllowed
        ) ?? sessionId
        let agent = agentId.addingPercentEncoding(
            withAllowedCharacters: .urlPathAllowed
        ) ?? agentId
        return try await get("/api/sessions/\(session)/subagent/\(agent)")
    }

    /// `@`-mention targets matching a query, for the composer's "Reference a
    /// file" picker. Scoped to the session, so an attached repo's files come
    /// back too (labelled with their repo).
    static func fileMentions(query: String, sessionId: String) async throws -> [FileMention] {
        struct MentionsResponse: Decodable, Sendable { let files: [FileMention]? }
        let allowed = CharacterSet.urlQueryAllowed.subtracting(CharacterSet(charactersIn: "&+"))
        let q = query.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
        let response: MentionsResponse = try await get(
            "/api/files?q=\(q)&session=\(sessionId)"
        )
        return response.files ?? []
    }

    /// Promote an ask-mode session to code mode. The server cuts the worktree —
    /// which is why this is one-way, and why the row says so.
    @discardableResult
    static func promoteToCode(sessionId: String) async throws -> String? {
        struct PromoteResponse: Decodable, Sendable { let branch: String? }
        let response: PromoteResponse = try await post(
            "/api/sessions/\(sessionId)/promote",
            body: [:]
        )
        return response.branch
    }

    /// Hold a prompt until `at`, when the server sends it for you.
    static func schedulePrompt(sessionId: String, prompt: String, at: Date) async throws {
        struct ScheduledPrompt: Decodable, Sendable { let id: String? }
        let formatter = ISO8601DateFormatter()
        let _: ScheduledPrompt = try await post(
            "/api/sessions/\(sessionId)/scheduled-prompts",
            body: [
                "prompt": prompt,
                "at": formatter.string(from: at),
                "user": ServerConfig.shared.userName,
            ]
        )
    }

    /// A server-side media file (walkthrough stills and demo videos are staged
    /// as absolute paths). The route is path-scoped server-side; this only
    /// spells the URL, which the video player needs as a URL rather than data.
    static func mediaURL(path: String) -> URL? {
        guard let base = ServerConfig.shared.baseURL,
              var components = URLComponents(
                  url: base.appendingPathComponent("media"),
                  resolvingAgainstBaseURL: false
              )
        else { return nil }
        components.queryItems = [URLQueryItem(name: "path", value: path)]
        return components.url
    }

    /// Bytes of a staged media file, for the stills.
    static func media(path: String) async throws -> Data {
        guard let url = mediaURL(path: path) else { throw APIError.badURL }
        return try await responseData(for: ServerConfig.shared.authorizedRequest(url))
    }

    /// One file in a session's scratch assets folder — the artifacts an agent
    /// writes with `opensession-assets` (visualizations, reports, sample data).
    /// They live outside every worktree, so nothing here is a repo path.
    /// `Hashable` so a row can be pushed as a navigation destination.
    struct SessionAsset: Decodable, Sendable, Hashable, Identifiable {
        let path: String
        let size: Int
        let mtime: String

        var id: String { path }

        /// Last path component — what the file is called, without its folder.
        var name: String {
            path.split(separator: "/").last.map(String.init) ?? path
        }

        /// Lowercased extension, or "" — what the viewer picks a renderer by.
        var ext: String {
            let name = name
            guard let dot = name.lastIndex(of: "."), dot != name.startIndex
            else { return "" }
            return String(name[name.index(after: dot)...]).lowercased()
        }

        var modified: Date? { Session.parseISO(mtime) }
    }

    static func assets(sessionId: String) async throws -> [SessionAsset] {
        struct AssetsResponse: Decodable, Sendable { let files: [SessionAsset]? }
        let response: AssetsResponse = try await get("/api/sessions/\(sessionId)/assets")
        return response.files ?? []
    }

    /// Where one asset's bytes are served. The route carries the file's
    /// relative path in the URL PATH rather than a query parameter, which is
    /// what lets an HTML asset's relative references (./style.css, ./data.json)
    /// resolve against it — the same reason the web viewer frames this route.
    static func assetURL(sessionId: String, path: String) -> URL? {
        guard let base = ServerConfig.shared.baseURL else { return nil }
        // Per SEGMENT: `urlPathAllowed` leaves "/" alone, and the separators
        // are structure here, not part of any file's name.
        let encoded = path
            .split(separator: "/")
            .map { segment in
                String(segment).addingPercentEncoding(
                    withAllowedCharacters: .urlPathAllowed
                ) ?? String(segment)
            }
            .joined(separator: "/")
        return URL(
            string: "\(base.absoluteString)/api/sessions/\(sessionId)/assets/raw/\(encoded)"
        )
    }

    /// Bytes of one asset, for the kinds the app renders itself.
    static func assetData(sessionId: String, path: String) async throws -> Data {
        guard let url = assetURL(sessionId: sessionId, path: path) else {
            throw APIError.badURL
        }
        return try await responseData(for: ServerConfig.shared.authorizedRequest(url))
    }

    static func deleteAsset(sessionId: String, path: String) async throws {
        struct DeleteResponse: Decodable, Sendable { let ok: Bool }
        let _: DeleteResponse = try await post(
            "/api/sessions/\(sessionId)/assets/delete",
            body: ["path": path]
        )
    }

    /// Full content for an entry the WS delivered clamped.
    static func fullEntryContent(sessionId: String, entryId: String) async throws -> String {
        struct EntryResponse: Decodable { let content: String }
        let response: EntryResponse = try await get("/api/sessions/\(sessionId)/entry/\(entryId)")
        return response.content
    }

    /// Where a transcript image's bytes actually live.
    ///
    /// Most of them are SERVER-RELATIVE ("/media?path=…" for an uploaded or
    /// read file, "/api/…"), because the transcript is written for a web
    /// viewer that resolves those against its own origin for free. Here they
    /// have to be joined to the configured server: `URL(string:)` happily
    /// returns a scheme-less relative URL, `URLRequest` can't fetch one, and
    /// every such picture came out as the grey retry tile.
    nonisolated static func conversationImageURL(source: String, base: URL?) -> URL? {
        if source.hasPrefix("/") {
            guard let base else { return nil }
            return URL(string: source, relativeTo: base)?.absoluteURL
        }
        return URL(string: source)
    }

    /// Resolve an image from a bounded transcript entry. Large inline images
    /// arrive over the wire as `os-blob:<entry>/<index>` and are served as
    /// authenticated bytes by the transcript-image route.
    static func conversationImage(source: String, sessionId: String) async throws -> Data {
        if source.hasPrefix("os-blob:"),
           let slash = source.lastIndex(of: "/"),
           let index = Int(source[source.index(after: slash)...]) {
            let entryId = String(source[source.index(source.startIndex, offsetBy: 8)..<slash])
            return try await getData(
                "/api/sessions/\(sessionId)/transcript-image/\(entryId)/\(index)"
            )
        }

        let config = ServerConfig.shared
        let base = config.baseURL
        guard let url = conversationImageURL(source: source, base: base) else {
            throw APIError.badURL
        }
        let sameOrigin = url.scheme == base?.scheme
            && url.host == base?.host
            && url.port == base?.port
        let request = sameOrigin
            ? config.authorizedRequest(url)
            : URLRequest(url: url)
        return try await responseData(for: request)
    }

    /// PR details for the session's branch, or nil when it has no PR — the
    /// route answers a bare JSON `null` in that case (a real answer, not an
    /// error), so probe the raw body before decoding.
    static func pr(sessionId: String) async throws -> PrDetails? {
        let data = try await getData("/api/sessions/\(sessionId)/pr")
        let body = String(decoding: data, as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if body.isEmpty || body == "null" { return nil }
        return try await decodeDetached(PrDetails.self, from: data)
    }

    /// The committed PR patch used by the native review canvas. The server
    /// returns `null` for a session target with no pull request.
    static func prDiff(sessionId: String) async throws -> PrDiff? {
        let data = try await getData("/api/sessions/\(sessionId)/pr-diff")
        let body = String(decoding: data, as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if body.isEmpty || body == "null" { return nil }
        return try await decodeDetached(PrDiff.self, from: data)
    }

    static func prViewedFiles(repo: String?, number: Int) async throws -> PrViewedFiles {
        var components = URLComponents()
        components.queryItems = [URLQueryItem(name: "number", value: String(number))]
        if let repo, !repo.isEmpty {
            components.queryItems?.append(URLQueryItem(name: "repo", value: repo))
        }
        return try await get("/api/pr-viewed-files?\(components.percentEncodedQuery ?? "")")
    }

    static func setPrFileViewed(prId: String, path: String, viewed: Bool) async throws {
        struct Response: Decodable, Sendable { let ok: Bool? }
        var body: [String: Any] = ["prId": prId, "path": path, "viewed": viewed]
        let user = ServerConfig.shared.userName
        if !user.isEmpty { body["user"] = user }
        let _: Response = try await post("/api/pr-viewed-files", body: body)
    }

    // MARK: - Pull request actions
    //
    // The three mutations the web PR panel offers, on the same routes. Each
    // needs a GitHub credential server-side: with web sign-in on that is the
    // signed-in person's own token, so a 403 here means "connect your GitHub
    // account", not a bug — the server says so in `error` and APIError.server
    // carries the sentence through to the panel.

    /// Submit a review on the session's PR. `event` is APPROVE,
    /// REQUEST_CHANGES or COMMENT; everything but APPROVE needs a summary
    /// (the server refuses an empty review).
    static func submitPrReview(
        sessionId: String,
        event: String,
        summary: String,
        comments: [PrInlineComment] = []
    ) async throws {
        struct ReviewResponse: Decodable { let ok: Bool? }
        var body: [String: Any] = ["event": event]
        let trimmed = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty { body["summary"] = trimmed }
        if !comments.isEmpty {
            body["comments"] = comments.map {
                ["path": $0.path, "line": $0.line, "side": "RIGHT", "text": $0.text]
            }
        }
        let user = ServerConfig.shared.userName
        if !user.isEmpty { body["user"] = user }
        let _: ReviewResponse = try await post(
            "/api/sessions/\(sessionId)/pr-review",
            body: body
        )
    }

    /// Merge the session's PR. `method` is squash (the default), merge or
    /// rebase; the server refuses a merge a stack layer below still blocks.
    static func mergePr(sessionId: String, method: String = "squash") async throws {
        struct MergeResponse: Decodable { let ok: Bool? }
        let _: MergeResponse = try await post(
            "/api/sessions/\(sessionId)/pr-merge",
            body: ["method": method]
        )
    }

    /// Close the session's PR without merging it.
    static func closePr(sessionId: String) async throws {
        struct CloseResponse: Decodable { let ok: Bool? }
        let _: CloseResponse = try await post(
            "/api/sessions/\(sessionId)/pr-close",
            body: [:]
        )
    }

    struct GitStatus: Decodable, Sendable, Equatable {
        let branch: String?
        let hasUpstream: Bool
        let ahead: Int
        let behind: Int
        let behindBase: Int
        let baseBranch: String
        let uncommittedFiles: Int
    }

    struct DiffFile: Decodable, Sendable, Identifiable, Equatable {
        let path: String
        let oldPath: String?
        let status: String
        let additions: Int
        let deletions: Int
        let binary: Bool?

        var id: String { path }
    }

    struct SessionDiff: Decodable, Sendable, Equatable {
        let branch: String?
        let baseRef: String?
        let files: [DiffFile]
        let totalAdditions: Int
        let totalDeletions: Int
        let truncated: Bool?
        /// The whole worktree's unified patch, in one string — the route
        /// sends it alongside the file list, and the Changes view splits it
        /// per file (PatchSplitter) rather than asking per file. Optional
        /// because a server old enough to omit it must still decode.
        let rawPatch: String?
    }

    struct RepoDiff: Decodable, Sendable, Equatable {
        let repo: String
        let dir: String?
        let primary: Bool
        let diff: SessionDiff
    }

    struct SessionDiffResponse: Decodable, Sendable, Equatable {
        let repos: [RepoDiff]
    }

    struct WorkspaceOverview: Decodable, Sendable, Equatable {
        struct Message: Decodable, Sendable, Equatable {
            let content: String
            let sessionId: String
            let at: String
        }

        let prompt: Message?
        let lastMessage: Message?
    }

    static func gitStatus(sessionId: String, repo: String) async throws -> GitStatus? {
        let encodedRepo = repo.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)
            ?? repo
        let data = try await getData(
            "/api/sessions/\(sessionId)/git-status?repo=\(encodedRepo)"
        )
        let body = String(decoding: data, as: UTF8.self)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if body.isEmpty || body == "null" { return nil }
        return try await decodeDetached(GitStatus.self, from: data)
    }

    static func sessionDiff(sessionId: String) async throws -> SessionDiffResponse {
        try await get("/api/sessions/\(sessionId)/diff")
    }

    static func workspaceOverview(workspaceId: String) async throws -> WorkspaceOverview {
        try await get("/api/workspaces/\(workspaceId)/overview")
    }

    /// Live per-session sandbox state. It is fetched only from Workspace
    /// details because asking every row can execute provider status checks.
    static func sandbox(sessionId: String) async throws -> SessionSandboxStatus {
        let encoded = sessionId.addingPercentEncoding(
            withAllowedCharacters: .urlPathAllowed
        ) ?? sessionId
        return try await get("/api/sessions/\(encoded)/sandbox")
    }

    /// Explicit sandbox lifecycle control. Recreate is destructive for files
    /// that only exist in the sandbox volume, so the server requires confirm.
    static func sandboxAction(
        sessionId: String,
        action: SessionSandboxAction
    ) async throws -> SessionSandboxStatus {
        let encoded = sessionId.addingPercentEncoding(
            withAllowedCharacters: .urlPathAllowed
        ) ?? sessionId
        let body: [String: Any] = action == .recreate ? ["confirm": true] : [:]
        return try await post("/api/sessions/\(encoded)/sandbox/\(action.rawValue)", body: body)
    }

    /// Archive (or unarchive) a session. Archiving an in-flight session also
    /// stops its run server-side.
    static func setArchived(sessionId: String, archived: Bool) async throws {
        struct ArchiveResponse: Decodable { let ok: Bool? }
        let _: ArchiveResponse = try await post(
            "/api/sessions/\(sessionId)/archive",
            body: ["archived": archived]
        )
    }

    static func renameWorkspace(workspaceId: String, name: String) async throws {
        struct RenameResponse: Decodable { let workspace: WorkspaceSummary? }
        let _: RenameResponse = try await patch(
            "/api/workspaces/\(workspaceId)",
            body: ["name": name]
        )
    }

    static func renameSession(sessionId: String, title: String) async throws {
        struct RenameResponse: Decodable { let ok: Bool? }
        let _: RenameResponse = try await put(
            "/api/sessions/\(sessionId)/title",
            body: ["title": title]
        )
    }

    struct AuthStatus: Decodable {
        let authenticated: Bool?
        let login: String?
        let name: String?
    }

    /// Signed-in identity for the current bearer token. Used to backfill
    /// `githubLogin` on devices whose token predates the app storing the
    /// login at sign-in time (the avatar needs it).
    static func authStatus() async throws -> AuthStatus {
        try await get("/api/auth/status")
    }

    private struct LiveActivityResponse: Decodable, Sendable { let ok: Bool? }

    struct LiveActivityConnection: Equatable, Sendable {
        let baseURL: URL
        let token: String
        let user: String

        static func current() -> LiveActivityConnection? {
            let config = ServerConfig.shared
            guard let baseURL = config.baseURL, config.isConfigured else { return nil }
            return LiveActivityConnection(
                baseURL: baseURL,
                token: config.token,
                user: config.userName
            )
        }
    }

    static func registerLiveActivityDevice(
        deviceId: String,
        pushToStartToken: String,
        connection: LiveActivityConnection
    ) async throws {
        let _: LiveActivityResponse = try await liveActivityMutate(
            "/api/live-activities/device",
            method: "PUT",
            body: [
                "deviceId": deviceId,
                "pushToStartToken": pushToStartToken,
                "user": connection.user,
            ],
            connection: connection
        )
    }

    static func registerLiveActivity(
        deviceId: String,
        activityId: String,
        pushToken: String,
        connection: LiveActivityConnection
    ) async throws {
        let _: LiveActivityResponse = try await liveActivityMutate(
            "/api/live-activities/activity",
            method: "PUT",
            body: [
                "deviceId": deviceId,
                "activityId": activityId,
                "pushToken": pushToken,
                "user": connection.user,
            ],
            connection: connection
        )
    }

    static func unregisterLiveActivityDevice(
        deviceId: String,
        connection: LiveActivityConnection
    ) async throws {
        let encoded = deviceId.addingPercentEncoding(
            withAllowedCharacters: .urlPathAllowed
        ) ?? deviceId
        let _: LiveActivityResponse = try await liveActivityMutate(
            "/api/live-activities/device/\(encoded)",
            method: "DELETE",
            body: ["user": connection.user],
            connection: connection
        )
    }

    private static func liveActivityMutate<T: Decodable & Sendable>(
        _ path: String,
        method: String,
        body: [String: Any],
        connection: LiveActivityConnection
    ) async throws -> T {
        guard let url = URL(string: connection.baseURL.absoluteString + path) else {
            throw APIError.badURL
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(connection.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            if let serverError = try? JSONDecoder().decode(ServerErrorBody.self, from: data),
               let message = serverError.error {
                throw APIError.server(message)
            }
            throw APIError.http(http.statusCode)
        }
        return try await decodeDetached(T.self, from: data)
    }

    /// Revoke the server-side web session before removing its keychain copy.
    static func logout() async throws {
        struct LogoutResponse: Decodable { let ok: Bool? }
        let _: LogoutResponse = try await post("/api/auth/logout", body: [:])
    }

    /// Unauthenticated liveness probe; also carries the server bootId.
    static func health() async throws -> Bool {
        struct Health: Decodable { let ok: Bool? }
        let health: Health = try await get("/api/health", authorized: false)
        return health.ok ?? true
    }

    // MARK: - Session creation

    private struct ServerErrorBody: Decodable { let error: String? }

    struct RepoInfo: Codable, Identifiable, Hashable {
        let id: String
        let ghRepo: String?
        let label: String?
        let defaultBranch: String?
        let sharedCheckout: Bool?
        let isDefault: Bool?
        /// This repo's letter-tile color, assigned across the registered set
        /// so no two repos share one. Absent on servers older than the
        /// assignment, where the tile falls back to its own hash.
        let color: String?
        /// Whether that color was chosen for the repo rather than assigned.
        let colorChosen: Bool?
        /// What automatic would give it — the same as `color` unless one was
        /// chosen. The tile editor previews it on its Automatic row.
        let autoColor: String?
        /// Which of the editor's icon choices the art came from, when the
        /// server stored it ("github" / "upload").
        let iconSource: String?
        /// Whether the tile paints art rather than the letter.
        let hasIcon: Bool?
        /// Changes when that art does — hung off the icon URL so a replaced
        /// icon isn't served from the cache the old one is sitting in.
        let iconRev: Double?

        private enum CodingKeys: String, CodingKey {
            case id, ghRepo, label, defaultBranch, sharedCheckout, color
            case colorChosen, autoColor, iconSource, hasIcon, iconRev
            case isDefault = "default"
        }
    }

    /// Set a repo's tile color, or fetch/clear its icon. `color` and `icon`
    /// are three-state: absent leaves that half alone, `.some(nil)` clears it.
    @discardableResult
    static func setRepoAppearance(
        id: String,
        color: String?? = nil,
        icon: String?? = nil
    ) async throws -> RepoAppearance {
        var body: [String: Any] = [:]
        if let color { body["color"] = color ?? NSNull() }
        if let icon { body["icon"] = icon ?? NSNull() }
        return try await post("/api/repos/\(id)/appearance", body: body)
    }

    struct RepoAppearance: Decodable, Sendable {
        let color: String?
        let hasIcon: Bool
        let iconRev: Double?
        let iconSource: String?
    }

    /// The owner's GitHub avatar, proxied by our server so the editor can
    /// OFFER the picture rather than a button promising one. 404s when the
    /// repo has no GitHub remote — the choice then isn't shown.
    @MainActor
    static func repoGitHubAvatarURL(id: String) -> URL? {
        ServerConfig.shared.baseURL?
            .appendingPathComponent("api/repos/\(id)/github-avatar")
    }

    /// Give a repo art of its own. Raw PNG bytes, like the web editor: the
    /// client re-encodes whatever was picked, so the server's icon path only
    /// ever decodes PNG.
    static func uploadRepoIcon(id: String, png: Data) async throws -> RepoAppearance {
        let config = ServerConfig.shared
        guard let base = config.baseURL, config.isConfigured else {
            throw APIError.notConfigured
        }
        guard let url = URL(string: base.absoluteString + "/api/repos/\(id)/icon") else {
            throw APIError.badURL
        }
        var request = config.authorizedRequest(url)
        request.httpMethod = "POST"
        request.setValue("image/png", forHTTPHeaderField: "Content-Type")
        request.httpBody = png
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            if let serverError = try? JSONDecoder().decode(ServerErrorBody.self, from: data),
               let message = serverError.error {
                throw APIError.server(message)
            }
            throw APIError.http(http.statusCode)
        }
        return try await decodeDetached(RepoAppearance.self, from: data)
    }

    /// Repos a new session can target.
    static func repos() async throws -> [RepoInfo] {
        struct ReposResponse: Decodable { let repos: [RepoInfo] }
        let response: ReposResponse = try await get("/api/repos")
        // Recorded on the way through rather than at the call sites: every
        // tile in the app wants the assignment, and a tile is handed a repo
        // id, not a RepoInfo.
        await RepoTilePalette.shared.remember(response.repos)
        return response.repos
    }

    /// One teammate from the server's identity roster (src/server/people.ts).
    /// `name` is the first name every people surface keys on — presence
    /// viewers, `startedBy`, @-mentions — and `github` is where the face
    /// comes from.
    struct Person: Decodable, Sendable {
        let name: String
        let fullName: String?
        let github: String?
    }

    /// The team directory: who exists, and which GitHub account each is.
    static func people() async throws -> [Person] {
        struct PeopleResponse: Decodable, Sendable { let people: [Person]? }
        let response: PeopleResponse = try await get("/api/people")
        return response.people ?? []
    }

    /// What's wired up on this instance, for Settings → Setup. Read-only
    /// snapshot; presence booleans only, never a credential value. Mirrors
    /// the web's `SetupStatus` (src/frontend/components/setup-shared.tsx) as
    /// a tolerant subset — every field optional, so a server that grows or
    /// drops one can't break an older build.
    struct SetupStatus: Codable, Sendable {
        struct Engine: Codable, Sendable {
            let ready: Bool?
            /// What stops this instance running a turn, in one sentence.
            let blocker: String?
            let fix: String?
            let defaultModel: String?
            let bridgeEnabled: Bool?
            let claudeAccounts: Int?
            let codexAccounts: Int?
        }

        /// Whether a repo commits the scripts that let a session provision and
        /// boot it unattended (docs/repo-lifecycle.md).
        struct Lifecycle: Codable, Sendable {
            let dir: String?
            let setup: Bool?
            let start: Bool?
            let previewCommand: Bool?
        }

        struct Repo: Codable, Sendable {
            let id: String
            let label: String?
            let path: String?
            let lifecycle: Lifecycle?
        }

        struct Team: Codable, Sendable {
            let count: Int?
            let names: [String]?
        }

        struct Github: Codable, Sendable {
            let userPrAuth: Bool?
            let clientIdConfigured: Bool?
            let redirectFlowAvailable: Bool?
            let botTokenPresent: Bool?
            let callbackUrl: String?
        }

        struct Integration: Codable, Sendable {
            let id: String
            let label: String?
            let enabled: Bool?
            let missingRequired: [String]?
        }

        let publicBaseUrl: String?
        let repos: [Repo]?
        let team: Team?
        let engine: Engine?
        let github: Github?
        let integrations: [Integration]?
    }

    static func setupStatus() async throws -> SetupStatus {
        try await get("/api/setup/status")
    }

    /// Models (and presets) a session can run on, plus the interactive default.
    static func models() async throws -> ModelCatalog {
        try await get("/api/models")
    }

    /// Create a session; returns the new session id. Code mode gets a
    /// server-suggested branch; the opening run starts immediately.
    static func createSession(
        prompt: String,
        repo: String,
        mode: String,
        model: String? = nil,
        effort: String? = nil,
        fastMode: Bool = false,
        images: [String] = [],
        workspaceId: String? = nil
    ) async throws -> String {
        struct CreateResponse: Decodable { let id: String }
        var body: [String: Any] = ["prompt": prompt, "mode": mode]
        if !repo.isEmpty { body["repo"] = repo }
        // Join an existing workspace as a sibling session (a new tab) rather
        // than starting a standalone session: the server takes the workspace's
        // worktree/branch for code sessions, so the tabs share one checkout.
        if let workspaceId, !workspaceId.isEmpty { body["workspaceId"] = workspaceId }
        if let model, !model.isEmpty { body["model"] = model }
        if let effort, !effort.isEmpty { body["effort"] = effort }
        if fastMode { body["fastMode"] = true }
        if !images.isEmpty { body["images"] = images }
        let user = ServerConfig.shared.userName
        if !user.isEmpty { body["user"] = user }
        let response: CreateResponse = try await post("/api/sessions", body: body)
        return response.id
    }

    /// Open an empty sibling session in a session's workspace — the tab strip's
    /// "+". It shares the source's worktree, branch and repo, and has no run
    /// yet: its first prompt starts one. The server answers with the full row
    /// so the new tab renders immediately instead of waiting for the poll.
    static func newSiblingSession(from sourceId: String) async throws -> Session {
        struct NewSessionResponse: Decodable {
            let id: String
            let session: Session?
        }
        var body: [String: Any] = ["mode": "share"]
        let user = ServerConfig.shared.userName
        if !user.isEmpty { body["user"] = user }
        let response: NewSessionResponse = try await post(
            "/api/sessions/\(sourceId)/new-session",
            body: body
        )
        // A server old enough to omit the row still returns the id; the bare
        // session decodes tolerantly and the poll fills the rest in.
        return response.session ?? Session(id: response.id)
    }

    /// What the server did with a message — or why it couldn't.
    ///
    /// The distinction that matters to the outbox is retryable vs terminal:
    /// anything that smells like connectivity comes back `.unavailable` and is
    /// tried again, while a refusal is `.rejected` and waits for a human.
    enum PromptDelivery: Sendable {
        /// Accepted. `status` is where it landed: started/steered/queued/handled.
        case delivered(status: String, message: String)
        /// The server understood and refused — retrying won't help.
        case rejected(String)
        /// No such session (yet): a freshly created session may not be persisted.
        case missing(String)
        /// Couldn't reach the server, or it failed on its own. Retry.
        case unavailable(String)
    }

    /// Deliver one message. The reply is the acknowledgement the outbox waits
    /// for; `clientId` makes a retry idempotent, so a reply lost on the way
    /// back can never post the message twice.
    static func deliverPrompt(
        sessionId: String,
        content: String,
        images: [String] = [],
        user: String,
        busyMode: String,
        effort: String? = nil,
        fastMode: Bool? = nil,
        clientId: String
    ) async -> PromptDelivery {
        struct DeliverResponse: Decodable, Sendable {
            let status: String?
            let message: String?
            let error: String?
        }
        let config = ServerConfig.shared
        guard let base = config.baseURL, config.isConfigured else {
            return .unavailable(APIError.notConfigured.localizedDescription)
        }
        let escaped = sessionId.addingPercentEncoding(
            withAllowedCharacters: .urlPathAllowed
        ) ?? sessionId
        guard let url = URL(
            string: base.absoluteString + "/api/sessions/\(escaped)/prompt"
        ) else {
            return .rejected(APIError.badURL.localizedDescription)
        }

        var body: [String: Any] = [
            "content": content,
            "busy": busyMode == "steer" ? "steer" : "queue",
            "clientId": clientId,
        ]
        if !user.isEmpty { body["user"] = user }
        if !images.isEmpty { body["images"] = images }
        if let effort, !effort.isEmpty { body["effort"] = effort }
        if let fastMode { body["fastMode"] = fastMode }

        var request = config.authorizedRequest(url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // Shorter than URLSession's 60s default: a send that hasn't been
        // answered in 20s is better retried than left hanging, and the
        // clientId makes that safe.
        request.timeoutInterval = 20
        guard let payload = try? JSONSerialization.data(withJSONObject: body) else {
            return .rejected("Message couldn't be encoded.")
        }
        request.httpBody = payload

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            let decoded = try? await decodeDetached(DeliverResponse.self, from: data)
            guard let http = response as? HTTPURLResponse else {
                return .unavailable("No response from the server.")
            }
            if (200..<300).contains(http.statusCode) {
                return .delivered(
                    status: decoded?.status ?? "started",
                    message: decoded?.message ?? ""
                )
            }
            let message = decoded?.error ?? decoded?.message
                ?? APIError.http(http.statusCode).localizedDescription
            if http.statusCode == 404 { return .missing(message) }
            // 401 is "signed out", not "bad message" — a re-auth fixes it, so
            // hold the message rather than failing it.
            if http.statusCode == 401 || http.statusCode >= 500 {
                return .unavailable(message)
            }
            return .rejected(message)
        } catch {
            return .unavailable(await Reachability.describe(error))
        }
    }

    // MARK: - Desk

    struct DeskEnsure: Decodable, Sendable {
        let sessionId: String
        let clearedAt: String?
    }

    /// Get-or-create the user's standing Desk session (server: desk.ts).
    static func ensureDesk() async throws -> DeskEnsure {
        try await post("/api/desk/ensure", body: ["user": ServerConfig.shared.userName])
    }

    struct DeskVoiceSecret: Decodable, Sendable {
        let clientSecret: String
        let expiresAt: Double?
        let model: String
        let sessionId: String
    }

    /// Mint a short-lived Realtime client secret for a Desk voice call — the
    /// real OpenAI key stays on the server (desk-voice.ts).
    static func deskVoiceSecret() async throws -> DeskVoiceSecret {
        try await post("/api/desk/voice/secret", body: ["user": ServerConfig.shared.userName])
    }

    /// Run one Realtime tool call server-side, as the verified user, and hand
    /// back the JSON string the model gets as its function_call_output. The
    /// result under "result" has no fixed schema, so this path stays on raw
    /// JSONSerialization instead of a Decodable.
    static func deskVoiceTool(
        callId: String,
        name: String,
        args: [String: Any]
    ) async throws -> String {
        var body: [String: Any] = ["callId": callId, "name": name, "args": args]
        let user = ServerConfig.shared.userName
        if !user.isEmpty { body["user"] = user }
        let data = try await mutateData("/api/desk/voice/tool", method: "POST", body: body)
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let result = object["result"],
           let out = try? JSONSerialization.data(
               withJSONObject: result,
               options: [.fragmentsAllowed]
           ),
           let text = String(data: out, encoding: .utf8) {
            return text
        }
        return String(decoding: data, as: UTF8.self)
    }

    /// Mirror finalized voice-call turns into the Desk transcript (and the
    /// next text turn's handoff note, server-side).
    static func deskVoiceTranscript(
        entries: [(id: String, role: String, text: String)]
    ) async throws {
        struct OkResponse: Decodable, Sendable { let ok: Bool? }
        var body: [String: Any] = [
            "entries": entries.map { ["id": $0.id, "role": $0.role, "text": $0.text] }
        ]
        let user = ServerConfig.shared.userName
        if !user.isEmpty { body["user"] = user }
        let _: OkResponse = try await post("/api/desk/voice/transcript", body: body)
    }

    /// One audio-free line about how a voice call went (counters only — no
    /// audio, no transcript). A call that fails does so on the user's device
    /// with nothing to inspect; this is what makes the next report of one
    /// answerable. Best effort by design: the caller ignores failures.
    static func deskVoiceDiag(_ report: [String: Any]) async throws {
        struct OkResponse: Decodable, Sendable { let ok: Bool? }
        var body = report
        let user = ServerConfig.shared.userName
        if !user.isEmpty { body["user"] = user }
        let _: OkResponse = try await post("/api/desk/voice/diag", body: body)
    }

    // MARK: - Plain (support)

    /// The Todo queue. The server caches it for 30s and caps it at 100
    /// threads — there is no cursor, so a busier inbox truncates silently.
    static func supportThreads() async throws -> [SupportThreadSummary] {
        struct ThreadsResponse: Decodable, Sendable {
            let threads: [SupportThreadSummary]?
        }
        let response: ThreadsResponse = try await get("/api/plain/threads")
        return response.threads ?? []
    }

    /// One thread's timeline. Uncached server-side, so this is what to refetch
    /// after sending — the queue's own cache lags by up to 30s.
    static func supportThread(id: String) async throws -> SupportThread {
        struct ThreadResponse: Decodable, Sendable { let thread: SupportThread }
        let encoded = id.addingPercentEncoding(
            withAllowedCharacters: .urlPathAllowed
        ) ?? id
        let response: ThreadResponse = try await get("/api/plain/threads/\(encoded)")
        return response.thread
    }

    /// Send a customer reply or post an internal note.
    ///
    /// Send the RAW text: the server adds the sign-off on a reply (skipping it
    /// when the author already signed) and the `**Name (via …):**` prefix on a
    /// note. Pre-signing here would produce two signatures.
    ///
    /// The answer says how it went out — `"user"` when the teammate's own
    /// Plain grant carried it, `"system"` when it fell back to the workspace
    /// bot. Worth showing: the customer sees a different sender.
    ///
    /// A reply emails a real person and there is no idempotency key, so this
    /// must never be auto-retried; a second attempt is a second email.
    @discardableResult
    static func sendSupportReply(
        threadId: String,
        text: String,
        isNote: Bool
    ) async throws -> String? {
        struct ReplyResponse: Decodable, Sendable { let sentAs: String? }
        let encoded = threadId.addingPercentEncoding(
            withAllowedCharacters: .urlPathAllowed
        ) ?? threadId
        var body: [String: Any] = [
            "text": text,
            "kind": isNote ? "note" : "reply",
        ]
        // Without a name the reply goes out unsigned and the note lands
        // unattributed. A signed-in server overrides this with the verified
        // identity anyway.
        let user = ServerConfig.shared.userName
        if !user.isEmpty { body["user"] = user }
        let response: ReplyResponse = try await post(
            "/api/plain/threads/\(encoded)/reply",
            body: body
        )
        return response.sentAs
    }

    /// Move a thread through the queue. Writes take the LOWERCASE status;
    /// reads hand back Plain's uppercase one.
    static func setSupportStatus(
        threadId: String,
        status: String,
        durationSeconds: Int? = nil
    ) async throws {
        struct StatusResponse: Decodable, Sendable { let ok: Bool? }
        let encoded = threadId.addingPercentEncoding(
            withAllowedCharacters: .urlPathAllowed
        ) ?? threadId
        var body: [String: Any] = ["status": status]
        if let durationSeconds { body["durationSeconds"] = durationSeconds }
        let user = ServerConfig.shared.userName
        if !user.isEmpty { body["user"] = user }
        let _: StatusResponse = try await post(
            "/api/plain/threads/\(encoded)/status",
            body: body
        )
    }

    /// An attachment's bytes, through the server's proxy.
    ///
    /// Never build a Plain URL: its signed links expire in about three
    /// minutes, which is why the thread payload carries only the id and the
    /// proxy re-mints one per request. It also needs our bearer token, so this
    /// can't be handed to `AsyncImage` — the same reason the assets viewer
    /// fetches its own bytes.
    static func supportAttachment(id: String) async throws -> Data {
        let encoded = id.addingPercentEncoding(
            withAllowedCharacters: .urlPathAllowed
        ) ?? id
        return try await getData("/api/plain/attachments/\(encoded)")
    }

    private static func post<T: Decodable & Sendable>(
        _ path: String,
        body: [String: Any]
    ) async throws -> T {
        try await mutate(path, method: "POST", body: body)
    }

    private static func put<T: Decodable & Sendable>(
        _ path: String,
        body: [String: Any]
    ) async throws -> T {
        try await mutate(path, method: "PUT", body: body)
    }

    private static func patch<T: Decodable & Sendable>(
        _ path: String,
        body: [String: Any]
    ) async throws -> T {
        try await mutate(path, method: "PATCH", body: body)
    }

    private static func mutate<T: Decodable & Sendable>(
        _ path: String,
        method: String,
        body: [String: Any]
    ) async throws -> T {
        let config = ServerConfig.shared
        guard let base = config.baseURL else { throw APIError.notConfigured }
        guard config.isConfigured else { throw APIError.notConfigured }
        guard let url = URL(string: base.absoluteString + path) else { throw APIError.badURL }

        var request = config.authorizedRequest(url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            if let serverError = try? JSONDecoder().decode(ServerErrorBody.self, from: data),
               let message = serverError.error {
                throw APIError.server(message)
            }
            throw APIError.http(http.statusCode)
        }
        return try await decodeDetached(T.self, from: data)
    }

    /// `mutate` without a Decodable — for responses with no fixed schema
    /// (the Desk voice tool relay). Same error contract.
    private static func mutateData(
        _ path: String,
        method: String,
        body: [String: Any]
    ) async throws -> Data {
        let config = ServerConfig.shared
        guard let base = config.baseURL else { throw APIError.notConfigured }
        guard config.isConfigured else { throw APIError.notConfigured }
        guard let url = URL(string: base.absoluteString + path) else { throw APIError.badURL }

        var request = config.authorizedRequest(url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            if let serverError = try? JSONDecoder().decode(ServerErrorBody.self, from: data),
               let message = serverError.error {
                throw APIError.server(message)
            }
            throw APIError.http(http.statusCode)
        }
        return data
    }

    private static func get<T: Decodable & Sendable>(
        _ path: String,
        authorized: Bool = true
    ) async throws -> T {
        let config = ServerConfig.shared
        guard let base = config.baseURL else { throw APIError.notConfigured }
        if authorized && !config.isConfigured { throw APIError.notConfigured }
        guard let url = URL(string: base.absoluteString + path) else { throw APIError.badURL }

        let request = authorized ? config.authorizedRequest(url) : URLRequest(url: url)
        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw APIError.http(http.statusCode)
        }
        return try await decodeDetached(T.self, from: data)
    }

    /// Decode off the main actor. OS1API is @MainActor, and decoding inline
    /// parked multi-megabyte payloads on the main thread — the sessions list
    /// is thousands of rows every 5s poll, a visible periodic hitch while
    /// typing (long transcripts weren't small either). Taking archived
    /// sessions off that poll roughly halved it; it is still the biggest
    /// thing this app decodes.
    private static func decodeDetached<T: Decodable & Sendable>(
        _ type: T.Type,
        from data: Data
    ) async throws -> T {
        try await Task.detached(priority: .userInitiated) {
            try JSONDecoder().decode(T.self, from: data)
        }.value
    }

    private static func getData(_ path: String) async throws -> Data {
        let config = ServerConfig.shared
        guard let base = config.baseURL else { throw APIError.notConfigured }
        guard config.isConfigured else { throw APIError.notConfigured }
        guard let url = URL(string: base.absoluteString + path) else { throw APIError.badURL }
        return try await responseData(for: config.authorizedRequest(url))
    }

    private static func responseData(for request: URLRequest) async throws -> Data {
        let (data, response) = try await imageSession.data(for: request)
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            throw APIError.http(http.statusCode)
        }
        return data
    }
}
