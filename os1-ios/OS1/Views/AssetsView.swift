import SwiftUI
#if os(iOS)
import WebKit
#endif

/// Open the session's assets — the scratch folder of agent-produced artifacts
/// — as a tab beside the conversation, optionally on one named file.
///
/// An environment action rather than a callback threaded down through the
/// transcript: the deepest caller is a tool-call row, several layers below the
/// session view, and none of the rows in between have any business knowing
/// that an assets tab exists. `isAvailable` is what a caller checks before
/// drawing a button — the Mac app doesn't install a handler, and an "Open"
/// chip that does nothing is worse than no chip.
struct OpenAssetsAction: Equatable {
    /// The session whose folder this opens — and the action's identity.
    ///
    /// Equatable on purpose, and keyed on something stable: the handler is a
    /// fresh closure on every parent update, and an environment value that
    /// never compares equal would re-evaluate `SessionView.body` — transcript
    /// and all — every time the sessions poll landed.
    let sessionId: String?
    fileprivate let handler: ((String?) -> Void)?

    var isAvailable: Bool { handler != nil }

    /// `openAssets()` for the whole folder, `openAssets(path)` for one file.
    func callAsFunction(_ path: String? = nil) { handler?(path) }

    static let unavailable = OpenAssetsAction(sessionId: nil, handler: nil)

    static func opening(
        sessionId: String,
        _ handler: @escaping (String?) -> Void
    ) -> OpenAssetsAction {
        OpenAssetsAction(sessionId: sessionId, handler: handler)
    }

    static func == (lhs: OpenAssetsAction, rhs: OpenAssetsAction) -> Bool {
        lhs.sessionId == rhs.sessionId && lhs.isAvailable == rhs.isAvailable
    }
}

private struct OpenAssetsKey: EnvironmentKey {
    static let defaultValue = OpenAssetsAction.unavailable
}

extension EnvironmentValues {
    var openAssets: OpenAssetsAction {
        get { self[OpenAssetsKey.self] }
        set { self[OpenAssetsKey.self] = newValue }
    }
}

#if os(iOS)
/// The session's scratch assets, as a tab: the file list, and the file you
/// picked rendered in place.
///
/// No `NavigationStack` of its own — this sits inside the one that pushed the
/// session, so a list-to-file drill-in would stack a second navigation bar
/// under the first. The "Files" button in the toolbar is the way back up
/// instead, and the title says which of the two you're looking at.
struct AssetsView: View {
    let sessionId: String
    /// The file the tab opened on, when it was opened from a chat row.
    var initialPath: String?

    @State private var files: [OS1API.SessionAsset] = []
    @State private var selectedPath: String?
    @State private var showingList = false
    @State private var loading = true
    @State private var loadFailed = false

    var body: some View {
        Group {
            if loading && files.isEmpty {
                loadingPlaceholder
            } else if loadFailed && files.isEmpty {
                failedPlaceholder
            } else if files.isEmpty {
                emptyPlaceholder
            } else if let asset = selectedAsset, !showingList {
                AssetPreview(sessionId: sessionId, asset: asset)
            } else {
                fileList
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(OS1VisualStyle.background)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                if selectedAsset != nil && !showingList {
                    Button {
                        withAnimation(.snappy(duration: 0.2, extraBounce: 0)) {
                            showingList = true
                        }
                    } label: {
                        Label("Files", systemImage: "list.bullet")
                    }
                } else {
                    Button {
                        Task { await load() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                }
            }
        }
        .task(id: sessionId) { await load() }
    }

    private var title: String {
        guard let asset = selectedAsset, !showingList else { return "Assets" }
        return asset.name
    }

    private var selectedAsset: OS1API.SessionAsset? {
        files.first { $0.path == selectedPath }
    }

    // MARK: - The list

    private var fileList: some View {
        List {
            Section {
                ForEach(files) { asset in
                    Button {
                        withAnimation(.snappy(duration: 0.2, extraBounce: 0)) {
                            selectedPath = asset.path
                            showingList = false
                        }
                    } label: {
                        AssetRow(asset: asset, selected: asset.path == selectedPath)
                    }
                    .buttonStyle(.plain)
                }
            } footer: {
                Text("Scratch files this session's agent wrote. They live "
                     + "outside the repository and are never committed.")
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(OS1VisualStyle.background)
        .refreshable { await load() }
    }

    // MARK: - Placeholders

    private var loadingPlaceholder: some View {
        ProgressView()
            .controlSize(.large)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var emptyPlaceholder: some View {
        ListPlaceholder(
            symbol: "folder",
            title: "No assets yet",
            message: "Artifacts this session writes — reports, charts, sample "
                + "data — show up here."
        ) {
            EmptyView()
        }
    }

    private var failedPlaceholder: some View {
        ListPlaceholder(
            symbol: "exclamationmark.triangle",
            title: "Couldn't load assets",
            message: "The server didn't answer for this session's files."
        ) {
            Button("Try again") { Task { await load() } }
                .buttonStyle(PlaceholderActionStyle())
        }
    }

    // MARK: - Loading

    private func load() async {
        loading = true
        loadFailed = false
        let loaded = (try? await OS1API.assets(sessionId: sessionId)) ?? []
        guard !Task.isCancelled else { return }
        // Newest first: the file an agent just wrote is the one you came for.
        files = loaded.sorted { $0.mtime > $1.mtime }
        loadFailed = files.isEmpty && loaded.isEmpty
        loading = false

        // Land on the file the tab was opened with, or the newest one. A
        // selection already made by hand survives a refresh.
        if let selectedPath, files.contains(where: { $0.path == selectedPath }) { return }
        if let initialPath, files.contains(where: { $0.path == initialPath }) {
            selectedPath = initialPath
            showingList = false
        } else {
            selectedPath = files.first?.path
            showingList = files.count > 1 && initialPath == nil
        }
    }
}

/// One file in the list: what it's called, where it sits, how big and how old.
private struct AssetRow: View {
    let asset: OS1API.SessionAsset
    let selected: Bool

    /// The folders above the file, when it isn't at the top level.
    private var folder: String? {
        let parts = asset.path.split(separator: "/")
        guard parts.count > 1 else { return nil }
        return parts.dropLast().joined(separator: "/")
    }

    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: AssetKind.of(asset).symbol)
                .symbolRenderingMode(.hierarchical)
                .font(.system(size: 15))
                .foregroundStyle(OS1VisualStyle.textDim)
                .frame(width: 22)
            VStack(alignment: .leading, spacing: 2) {
                Text(asset.name)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(OS1VisualStyle.text)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(OS1VisualStyle.textDim)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if selected {
                Image(systemName: "checkmark")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(OS1VisualStyle.accent)
            }
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())
    }

    private var subtitle: String {
        var parts: [String] = []
        if let folder { parts.append(folder) }
        parts.append(
            ByteCountFormatter.string(
                fromByteCount: Int64(asset.size),
                countStyle: .file
            )
        )
        if let modified = asset.modified {
            parts.append(modified.formatted(.relative(presentation: .named)))
        }
        return parts.joined(separator: " · ")
    }
}

/// How one asset is rendered. WebKit handles most of it — and MUST, for
/// anything whose relative references have to resolve — but markdown would
/// arrive as raw source and code as an unstyled wall, and the app already
/// renders both properly.
enum AssetKind {
    case web
    case markdown
    case text
    case opaque

    static func of(_ asset: OS1API.SessionAsset) -> AssetKind {
        switch asset.ext {
        case "html", "htm", "svg", "pdf",
             "png", "jpg", "jpeg", "gif", "webp", "ico",
             "mp4", "webm", "mov", "mp3", "wav":
            return .web
        case "md", "markdown":
            return .markdown
        case "txt", "js", "mjs", "cjs", "ts", "tsx", "jsx", "css", "json",
             "csv", "tsv", "xml", "yaml", "yml", "log", "py", "sh", "sql",
             "swift", "rs", "go", "rb", "toml", "ini", "env":
            return .text
        default:
            return .opaque
        }
    }

    var symbol: String {
        switch self {
        case .web: "safari"
        case .markdown: "doc.richtext"
        case .text: "curlybraces"
        case .opaque: "doc"
        }
    }
}

/// One asset, rendered.
private struct AssetPreview: View {
    let sessionId: String
    let asset: OS1API.SessionAsset

    @State private var text: String?
    @State private var textFailed = false

    /// Enough of a text file to read on a phone; a generated log can be huge
    /// and the point of the preview is to see what the agent produced.
    private static let maxTextCharacters = 200_000

    var body: some View {
        Group {
            switch AssetKind.of(asset) {
            case .web:
                if let url = OS1API.assetURL(sessionId: sessionId, path: asset.path) {
                    AssetWebView(url: url, sessionId: sessionId)
                        .ignoresSafeArea(.container, edges: .bottom)
                } else {
                    opaquePlaceholder
                }
            case .markdown:
                textScroll { MarkdownBody($0) }
            case .text:
                textScroll { body in
                    Text(body)
                        .font(.caption.monospaced())
                        .foregroundStyle(OS1VisualStyle.text)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            case .opaque:
                opaquePlaceholder
            }
        }
        .task(id: asset.path) { await loadTextIfNeeded() }
    }

    @ViewBuilder
    private func textScroll<Content: View>(
        @ViewBuilder _ content: @escaping (String) -> Content
    ) -> some View {
        if let text {
            ScrollView {
                content(text)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
            }
        } else if textFailed {
            ListPlaceholder(
                symbol: "exclamationmark.triangle",
                title: "Couldn't read this file",
                message: asset.path
            ) {
                EmptyView()
            }
        } else {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var opaquePlaceholder: some View {
        ListPlaceholder(
            symbol: "doc",
            title: asset.name,
            message: ByteCountFormatter.string(
                fromByteCount: Int64(asset.size),
                countStyle: .file
            ) + " · no preview for this kind of file"
        ) {
            EmptyView()
        }
    }

    private func loadTextIfNeeded() async {
        let kind = AssetKind.of(asset)
        guard kind == .markdown || kind == .text else { return }
        text = nil
        textFailed = false
        guard let data = try? await OS1API.assetData(
            sessionId: sessionId,
            path: asset.path
        ) else {
            textFailed = true
            return
        }
        guard !Task.isCancelled else { return }
        text = String(
            String(decoding: data, as: UTF8.self).prefix(Self.maxTextCharacters)
        )
    }
}

/// An asset in a web view, loaded from the route that serves it.
///
/// Not a native image or PDF view: an HTML asset's relative references
/// (./style.css, ./data.json) only resolve when the page is loaded from the
/// raw route itself, and that route is authenticated. WebKit won't carry the
/// app's `Authorization` header on subresource loads, so the session token
/// rides in as the same `opensession_auth` cookie the web client uses —
/// scoped to THIS session's assets path, so a page an agent wrote can reach
/// its own siblings and nothing else on the API.
private struct AssetWebView: UIViewRepresentable {
    let url: URL
    let sessionId: String

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // Nothing an asset leaves behind should outlive the tab; the cookie is
        // re-seeded on every load anyway.
        configuration.websiteDataStore = .nonPersistent()
        configuration.allowsInlineMediaPlayback = true
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        context.coordinator.load(url, in: webView, sessionId: sessionId)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        guard context.coordinator.loaded != url else { return }
        context.coordinator.load(url, in: webView, sessionId: sessionId)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    @MainActor
    final class Coordinator {
        private(set) var loaded: URL?

        /// Seeding has to FINISH before the navigation starts: a cookie set
        /// alongside the load loses the race and the asset comes back a 401.
        func load(_ url: URL, in webView: WKWebView, sessionId: String) {
            loaded = url
            let token = ServerConfig.shared.token
            guard !token.isEmpty, let cookie = Self.authCookie(
                token: token,
                url: url,
                sessionId: sessionId
            ) else {
                // A server running without the auth gate needs no cookie.
                webView.load(URLRequest(url: url))
                return
            }
            let store = webView.configuration.websiteDataStore.httpCookieStore
            Task {
                await store.setCookie(cookie)
                webView.load(URLRequest(url: url))
            }
        }

        private static func authCookie(
            token: String,
            url: URL,
            sessionId: String
        ) -> HTTPCookie? {
            guard let host = url.host else { return nil }
            var properties: [HTTPCookiePropertyKey: Any] = [
                .name: "opensession_auth",
                .value: token,
                .domain: host,
                .path: "/api/sessions/\(sessionId)/assets/",
            ]
            if url.scheme == "https" { properties[.secure] = "TRUE" }
            return HTTPCookie(properties: properties)
        }
    }
}
#endif
