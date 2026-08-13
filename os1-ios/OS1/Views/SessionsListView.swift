import Combine
import SwiftUI

/// The horizontal margin every row, band and lane heading in the list shares —
/// one constant so they can't drift apart. iPhone runs wider than the 16pt the
/// web sidebar uses: at 16 the list read tight against the screen edge, and
/// 20 is also what the system's own plain lists give content at this width.
/// The Mac sidebar keeps 16, where rows are compact and the window supplies
/// its own breathing room.
#if os(iOS)
private let sidebarMargin: CGFloat = 20
#else
private let sidebarMargin: CGFloat = 16
#endif

/// Sessions list, mirroring the web sidebar's organization: group by Status
/// (In progress / Needs input / In review / Done / Backlog), by Repo, by Repo
/// and Status, by Repo and Inbox (each repo's rows banded by activity, the
/// web's Inbox mode nested per repo), by Inbox (one flat activity-banded list
/// across every repo), or a flat Recent list — plus a repo filter, sort, and
/// search.
/// The grouping/filter choices persist like the web's filter popover does.
struct SessionsListView: View {
    enum GroupBy: String, CaseIterable {
        case status, repo
        case repoStatus = "repo-status"
        case repoInbox = "repo-inbox"
        case inbox
        case recent

        var label: String {
            switch self {
            case .status: "Status"
            case .repo: "Repo"
            case .repoStatus: "Repo and status"
            case .repoInbox: "Repo and inbox"
            case .inbox: "Inbox"
            case .recent: "Recently active"
            }
        }
    }

    enum SortBy: String, CaseIterable {
        case updated, created

        var label: String {
            switch self {
            case .updated: "Last activity"
            case .created: "Created"
            }
        }
    }

    @State private var viewModel = SessionsListViewModel()
    @State private var showSettings = false
    @State private var showDesk = false
    /// The Plain support queue. iOS reaches it from the Support card at the
    /// bottom of the sessions sidebar; Mac keeps it in the sidebar header.
    @State private var showSupport = false
    @State private var supportQueue = SupportQueueModel()
    /// The ticket opened from the support queue. It has its own destination
    /// because this screen's navigation path is typed `[Session]`.
    @State private var openTicket: SupportThreadSummary?
    /// The push stack, typed rather than a `NavigationPath`, so a create that
    /// resolves after the person has navigated elsewhere can find its own
    /// pending entry instead of assuming it is still on top.
    @State private var path: [Session] = []
    /// The row you came back FROM. iOS pops the session off the stack, so
    /// without this the list gives no clue where you just were — on a long
    /// list, finding your place again is a scroll and a squint. Mac needs no
    /// equivalent: the open session stays selected in the sidebar.
    @State private var lastOpenedSessionID: String?
    @State private var searchText = ""
    /// Non-nil opens the new-session sheet; carries the per-repo "+" preset.
    @State private var newSessionRequest: NewSessionRequest?
    /// Parked "Start an Agent" requests (`StartAgentIntent`, widgets, Siri).
    @State private var quickCapture = QuickCapture.shared
    /// A session tapped in the Live Activity, parked until the list has loaded.
    @State private var requestedSession = SessionOpenRequest.shared
    /// Opening prompts (and images) of just-created sessions, keyed by id —
    /// seeds the conversation view so it renders instantly instead of waiting
    /// for the server to persist the session.
    @State private var optimisticSeeds: [String: SessionViewModel.OptimisticSeed] = [:]
    /// Staged images survive switching sibling tabs (whose SessionViewModel
    /// and socket are otherwise deliberately recreated). Text lives in
    /// DraftsStore so a remote send cannot be shadowed by stale view state.
    @State private var composerDrafts: [String: SessionViewModel.ComposerDraft] = [:]
    /// Temp IDs remain aliases through the outgoing view's onDisappear so a
    /// draft edited while session creation resolves is saved under the real ID.
    @State private var resolvedSessionIds: [String: String] = [:]
    /// Loaded transcripts for recently visited mobile conversations. The
    /// cache is bounded and cached view models disconnect while off-screen.
    @State private var sessionPageCache = SessionViewModelCache()
    /// Surfaced when a background session create fails after the sheet closed.
    @State private var createError: String?
    @State private var showArchived = false
    /// An archived row opens only after its sheet has dismissed; pushing while
    /// the sheet is still closing can drop the navigation transition on iOS.
    @State private var pendingArchivedOpen: Session?
    /// The catch-up deck — a full-screen pass over everything unread.
    @State private var showCatchUp = false
    /// The session the deck asked to open. Pushed only once the cover is gone:
    /// appending to `path` while it is still dismissing loses the push.
    @State private var pendingCatchUpOpen: Session?
    /// A tapped "Try again" on the unreachable screen, until it lands.
    @State private var isRetrying = false
    #if os(iOS)
    @State private var renamingWorkspace: SidebarWorkspace?
    @State private var renameText = ""
    @State private var detailsWorkspace: SidebarWorkspace?
    @State private var pendingContextMerge: ContextMerge?
    @State private var prActionError: String?
    @State private var slackShare: PrSlackShareRequest?
    #endif

    private struct ContextMerge {
        let session: Session
        let method: String
    }

    struct NewSessionRequest: Identifiable {
        let id = UUID()
        var repo: String?
        /// Opened from the Action Button's "New Idea": the composer's mic
        /// starts listening with the sheet.
        var dictate = false
        /// Set when the create joins an existing workspace as a new tab (the
        /// session's ⋯ menu); nil starts a standalone session.
        var workspaceId: String?
    }

    @AppStorage("os1.list.groupBy") private var groupByRaw = GroupBy.repoStatus.rawValue
    @AppStorage("os1.list.repo") private var repoFilter = "all"
    @AppStorage("os1.list.sort") private var sortByRaw = SortBy.updated.rawValue
    // Default to the signed-in person's own sessions, like the web sidebar —
    // the server also hosts hundreds of automation runs and teammates' sessions.
    @AppStorage("os1.list.people") private var peopleFilter = "mine"
    @AppStorage("os1.sidebar.repoOrder") private var preferredRepoOrder = "[]"
    /// Section headings the person has folded shut — repo bands, status lanes
    /// and inbox bands, keyed like the web sidebar's collapse state and stored
    /// as a JSON array so the choice survives relaunches.
    @AppStorage("os1.list.collapsed") private var collapsedGroupsRaw = "[]"
    /// Source rows the person has hidden — the account's, shared with the web
    /// sidebar's own band menu. See `SidebarFeeds`.
    @AppStorage(SidebarFeeds.storageKey) private var hiddenFeedsRaw = "[]"

    private var groupBy: GroupBy { GroupBy(rawValue: groupByRaw) ?? .repoStatus }
    private var sortBy: SortBy { SortBy(rawValue: sortByRaw) ?? .updated }

    private var collapsedGroups: Set<String> {
        guard let data = collapsedGroupsRaw.data(using: .utf8),
              let keys = try? JSONDecoder().decode([String].self, from: data)
        else { return [] }
        return Set(keys)
    }

    private func isCollapsed(_ key: String) -> Bool {
        collapsedGroups.contains(key)
    }

    /// The same key a plain "Repo" group carries, so folding a repo shut in
    /// one grouping keeps it shut in the other.
    private func repoBandKey(_ repo: String) -> String { "repo-\(repo)" }

    private func toggleCollapsed(_ key: String) {
        var keys = collapsedGroups
        if keys.contains(key) {
            keys.remove(key)
        } else {
            keys.insert(key)
        }
        guard let data = try? JSONEncoder().encode(keys.sorted()),
              let raw = String(data: data, encoding: .utf8)
        else { return }
        withAnimation(.snappy(duration: 0.25)) {
            collapsedGroupsRaw = raw
        }
    }

    /// A folded section still shows the open session, so the row you're
    /// reading never disappears out from under the selection — the same rule
    /// the web sidebar applies to its collapsed lanes.
    private func showsWhileCollapsed(_ workspace: SidebarWorkspace) -> Bool {
        #if os(macOS)
        guard let selectedSessionID else { return false }
        return workspace.sessions.contains { $0.id == selectedSessionID }
        #else
        return false
        #endif
    }

    private func visibleWorkspaces(
        _ workspaces: [SidebarWorkspace],
        collapsedKey: String
    ) -> [SidebarWorkspace] {
        guard isCollapsed(collapsedKey) else { return workspaces }
        return workspaces.filter(showsWhileCollapsed)
    }

    #if os(macOS)
    @State private var selectedSessionID: String?
    /// Archived rows stay out of the live sidebar, but their hydrated copy can
    /// still own the detail column.
    @State private var openedArchivedSession: Session?
    #endif

    var body: some View {
        navigationContainer
            // Session-id links in agent output (SessionLinks) are ordinary
            // markdown links on a private scheme; catching them here — above
            // the navigation container — is what lets a transcript push the
            // worker it spawned instead of leaving the id as dead text.
            .environment(\.openURL, OpenURLAction { url in
                guard let id = SessionLinks.sessionId(from: url) else {
                    return .systemAction
                }
                return openSessionLink(id: id)
            })
            .task {
                viewModel.startPolling()
                // Not for the sheet's repo picker — for the tiles in this
                // list. The repo list carries each repo's assigned tile
                // color, and without it every tile falls back to its own
                // hash, which is exactly where two repos can collide.
                _ = try? await OS1API.repos()
            }
            #if os(iOS)
            // Keyed on the row's visibility so hiding Plain stops the poll and
            // showing it again starts one: a source you asked not to see
            // shouldn't keep spending the radio in the background.
            .task(id: isPlainHidden) {
                guard !isPlainHidden else { return }
                while !Task.isCancelled {
                    await supportQueue.load()
                    try? await Task.sleep(for: .seconds(60))
                }
            }
            #endif
            .onDisappear {
                viewModel.stopPolling()
            }
            .onChange(of: sessionCacheScope) {
                sessionPageCache.removeAll()
            }
            #if os(macOS)
            // File > New Session (Cmd+N) from the app's menu commands.
            .onReceive(NotificationCenter.default.publisher(for: .os1NewSession)) { _ in
                newSessionRequest = NewSessionRequest()
            }
            #endif
            .onChange(of: viewModel.hasLoaded) {
                autoOpenFromEnvironment()
                openRequestedSession()
            }
            // "Start an Agent" (StartAgentIntent — Action Button, widget,
            // Siri). It can run before this view exists (cold launch) or while
            // it's already on screen, so both entrances read the parked request.
            .onAppear {
                openQuickCapture()
                openRequestedSession()
            }
            .onChange(of: quickCapture.request?.id) { openQuickCapture() }
            .onChange(of: requestedSession.request?.id) { openRequestedSession() }
            .alert(
                "Couldn't start session",
                isPresented: Binding(
                    get: { createError != nil },
                    set: { if !$0 { createError = nil } }
                )
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(createError ?? "")
            }
            #if os(iOS)
            .alert(
                "Rename workspace",
                isPresented: Binding(
                    get: { renamingWorkspace != nil },
                    set: { if !$0 { renamingWorkspace = nil } }
                ),
                presenting: renamingWorkspace
            ) { workspace in
                TextField("Workspace name", text: $renameText)
                Button("Cancel", role: .cancel) {}
                Button("Rename") {
                    viewModel.rename(workspace, to: renameText)
                }
                .disabled(
                    workspace.workspaceId != nil
                        && renameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                )
            } message: { _ in
                Text("Choose a name for this workspace.")
            }
            .confirmationDialog(
                contextMergeTitle,
                isPresented: Binding(
                    get: { pendingContextMerge != nil },
                    set: { if !$0 { pendingContextMerge = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button(contextMergeButtonLabel) { performContextMerge() }
                Button("Cancel", role: .cancel) { pendingContextMerge = nil }
            } message: {
                Text("This cannot be undone.")
            }
            .alert(
                "Couldn't update pull request",
                isPresented: Binding(
                    get: { prActionError != nil },
                    set: { if !$0 { prActionError = nil } }
                )
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(prActionError ?? "Please try again.")
            }
            .sheet(item: $detailsWorkspace) { workspace in
                WorktreeInfoSheet(workspace: workspace, listViewModel: viewModel)
                    .presentationDetents([.large])
                    .presentationDragIndicator(.visible)
            }
            .sheet(item: $slackShare) { request in
                PrSlackShareSheet(request: request)
            }
            #endif
    }

    #if os(macOS)
    /// Mac: sessions live in a sidebar and the selected one opens in the
    /// detail column (like the web app), instead of iOS push navigation.
    private var navigationContainer: some View {
        NavigationSplitView {
            VStack(spacing: 0) {
                macSidebarHeader
                Divider()
                loadingOrList
            }
                .navigationSplitViewColumnWidth(min: 240, ideal: 300, max: 420)
        } detail: {
            // A ticket takes the detail column the way a session does — the
            // sidebar's deeper panel, not a window over it.
            if let openTicket {
                SupportThreadView(row: openTicket) {
                    supportQueue.forget(id: openTicket.id)
                }
                .id(openTicket.id)
            } else if showSupport {
                SupportQueueView(model: supportQueue) { row in
                    openTicket = row
                }
            } else if let archivedSession = openedArchivedSession {
                SessionView(
                    session: archivedSession,
                    workspaceNames: viewModel.workspaceNames,
                    composerDraft: storedDraft(for: archivedSession.id),
                    onSaveComposerDraft: { draft in
                        saveComposerDraft(draft, for: archivedSession.id)
                    }
                )
                    .id(archivedSession.id)
                    .onChange(of: archivedSession, initial: true) { _, open in
                        ReadsStore.shared.open(open)
                    }
                    .onDisappear { ReadsStore.shared.close(archivedSession.id) }
            } else if let selectedSessionID,
               let session = viewModel.sessions.first(where: { $0.id == selectedSessionID }) {
                SessionView(
                    session: session,
                    seed: optimisticSeeds[session.id],
                    workspaceNames: viewModel.workspaceNames,
                    composerDraft: storedDraft(for: session.id),
                    onSaveComposerDraft: { draft in
                        saveComposerDraft(draft, for: session.id)
                    }
                )
                    // Fresh view (and socket) per session, not a reused one.
                    .id(selectedSessionID)
                    // The selected session reads as read, and keeps re-marking as
                    // the poll hands it fresher activity — see SessionTabsView
                    // for the same rule on the iOS stack.
                    .onChange(of: session, initial: true) { _, open in
                        ReadsStore.shared.open(open)
                    }
                    .onDisappear { ReadsStore.shared.close(session.id) }
            } else {
                ContentUnavailableView(
                    "Select a session",
                    systemImage: "bubble.left.and.bubble.right"
                )
            }
        }
        // Picking a session in the sidebar means you're done with the ticket —
        // otherwise the detail column would keep showing it while the sidebar
        // says something else is selected.
        .onChange(of: selectedSessionID) { _, id in
            if id != nil {
                openTicket = nil
                showSupport = false
                openedArchivedSession = nil
            }
        }
        .sheet(item: $newSessionRequest) { request in
            NewSessionView(
                initialRepo: request.repo,
                initialWorkspaceId: request.workspaceId,
                autoDictate: request.dictate
            ) { session, seed in
                openOptimistic(session, seed: seed)
            } onResolved: { tempId, result in
                resolveCreate(tempId: tempId, result: result)
            }
        }
        .sheet(isPresented: $showArchived) {
					ArchivedSessionsView(
						sessions: viewModel.archivedSessions,
						loaded: viewModel.archivedHasLoaded,
						onOpen: { session in
							pendingArchivedOpen = session
							showArchived = false
						},
						onRestore: viewModel.unarchive,
						loadFailure: viewModel.archivedLoadFailure,
						onRetry: { Task { await viewModel.refreshArchived(force: true) } }
					)
            .task { await viewModel.refreshArchived() }
        }
        .onChange(of: showArchived) { _, shown in
            guard !shown, let session = pendingArchivedOpen else { return }
            pendingArchivedOpen = nil
            Task { openedArchivedSession = await viewModel.hydrated(session) }
        }
        .sheet(isPresented: $showDesk) {
            DeskSheet()
                .frame(minWidth: 520, minHeight: 600)
        }
        .safeAreaInset(edge: .bottom) {
            errorBanner
        }
    }

    /// A stable in-sidebar hierarchy avoids three unrelated icon buttons
    /// floating in the unified window toolbar. Settings remains available in
    /// the app menu (Cmd+,), where Mac users expect it.
    private var macSidebarHeader: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 7) {
                Text("Sessions")
                    .font(.headline)
                Text("\(viewModel.sessions.count)")
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(OS1VisualStyle.textFaint)
                Spacer(minLength: 8)
                filterMenu
                    .menuStyle(.borderlessButton)
                    .menuIndicator(.hidden)
                    .controlSize(.small)
                    .help("Filter, group, and sort sessions")
                Button {
                    showSupport = true
                } label: {
                    Image(systemName: "lifepreserver")
                }
                .controlSize(.small)
                .help("Open the support queue")
                Button {
                    showDesk = true
                } label: {
                    Image(systemName: "lamp.desk")
                }
                .controlSize(.small)
                .help("Open the Desk")
                Button {
                    newSessionRequest = NewSessionRequest()
                } label: {
                    Label("New", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
                .help("New session (Command-N)")
            }

            HStack(spacing: 7) {
                Image(systemName: "magnifyingglass")
                    .font(.caption)
                    .foregroundStyle(OS1VisualStyle.textFaint)
                TextField("Search sessions", text: $searchText)
                    .textFieldStyle(.plain)
                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(OS1VisualStyle.textFaint)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 9)
            .frame(height: 28)
            .background(.fill.tertiary, in: RoundedRectangle(cornerRadius: 7))
        }
        .padding(.horizontal, 12)
        .padding(.top, 10)
        .padding(.bottom, 11)
        .background(.bar)
    }
    #else
    private var navigationContainer: some View {
        NavigationStack(path: $path) {
            loadingOrList
                .inlineTitleBarCompat()
                // The system search field: iOS 26 places it at the bottom edge
                // on iPhone (the Liquid Glass search treatment), replacing the
                // old toolbar toggle + inline field. It sits on the CONTAINER
                // rather than on the list, so the bottom bar is whole from the
                // first frame — hung off the list, it appeared only once the
                // first poll landed, and the Desk button spent the load
                // centred on its own before the field shoved it right.
                .searchable(text: $searchText, prompt: "Search sessions")
                .toolbar {
                    ToolbarItem(placement: .topLeadingCompat) {
                        Button {
                            showSettings = true
                        } label: {
                            // The tile this button wore before the icon work
                            // of 2026-08-07 — restored deliberately, after a
                            // day of resizing it landed nowhere better.
                            //
                            // What that was: a 44pt round tile painting an
                            // UNTRIMMED icon, i.e. one whose own transparent
                            // margin left the mark on ~80% of the picture.
                            // The icon route now crops that margin off
                            // (png-trim.ts), so reproducing the old look
                            // takes the inset back as `artScale`, a notch
                            // under the 0.867 that reproduced it exactly:
                            // the mark is solid ink against actions that are
                            // a near-transparent capsule holding two ~22pt
                            // glyphs, so it stays under their 44pt capsule:
                            // 44 × 0.88 × 0.93 ≈ 36pt.
                            //
                            // Square clip, not `round`, once the art is this
                            // close to the tile's edge: a circle inscribed in
                            // the same 44pt box crosses inside the mark's own
                            // rounded-square corners and flattens them, which
                            // is the "cutting off the radius" this button was
                            // reported for. Nothing is clipped either way at
                            // this size — the square is just the shape that
                            // stays true if the art grows again.
                            RepoTile(
                                name: "opensession",
                                size: 44,
                                artScale: 0.88
                            )
                        }
                        .accessibilityLabel("Settings")
                        // Hiding the glass background leaves the padding the
                        // capsule reserved, so the bare tile sits well right
                        // of everything under it. Pull it back until the MARK
                        // starts on the list's own column — band headings and
                        // row tiles both begin at ~16pt — which is further
                        // than the tile's frame suggests: the art is inset
                        // inside it by `artScale`, so the frame has to sit
                        // ~5pt left of where the ink should land, i.e. 33.5pt
                        // left of the column itself.
                        .padding(.leading, sidebarMargin - 33.5)
                    }
                    // The bare app tile is the control; the toolbar's glass
                    // circle around it read as a stray border.
                    .sharedBackgroundVisibility(.hidden)
                    ToolbarItem(placement: .topTrailingCompat) {
                        filterMenu
                    }
                    ToolbarItem(placement: .topTrailingCompat) {
                        Button {
                            newSessionRequest = NewSessionRequest()
                        } label: {
                            Image(systemName: "plus")
                                .foregroundStyle(OS1VisualStyle.text)
                        }
                        .accessibilityLabel("New session")
                    }
                    DefaultToolbarItem(kind: .search, placement: .bottomBar)
                    ToolbarSpacer(.fixed, placement: .bottomBar)
                    ToolbarItem(placement: .bottomBar) {
                        Button {
                            showCatchUp = true
                        } label: {
                            Image(systemName: catchUpCount > 0
                                ? "rectangle.stack.fill"
                                : "rectangle.stack")
                                .foregroundStyle(catchUpCount > 0
                                    ? OS1VisualStyle.accent
                                    : OS1VisualStyle.text)
                        }
                        .accessibilityLabel(
                            catchUpCount > 0
                                ? "Catch up on \(catchUpCount) unread workspaces"
                                : "Open Catch Up"
                        )
                    }
                    ToolbarItem(placement: .bottomBar) {
                        Button {
                            showDesk = true
                        } label: {
                            Image(systemName: "lamp.desk")
                                .foregroundStyle(OS1VisualStyle.text)
                        }
                        .accessibilityLabel("Open the Desk")
                    }
                }
                .sheet(isPresented: $showSettings) {
                    SettingsView()
                }
                .sheet(isPresented: $showDesk) {
                    DeskSheet()
                        .presentationDetents([.large])
                        .presentationDragIndicator(.visible)
                }
                .navigationDestination(isPresented: $showSupport) {
                    SupportQueueView(model: supportQueue) { row in
                        openTicket = row
                    }
                }
                // Pushed onto this stack, not thrown over it: a ticket is
                // somewhere you go from the list, the same as a session, and
                // a sheet would have covered the list you came from. It can't
                // ride `path` — that is typed `[Session]` on purpose — so it
                // gets its own item-driven destination.
                .navigationDestination(item: $openTicket) { row in
                    SupportThreadView(row: row) {
                        supportQueue.forget(id: row.id)
                    }
                }
                .onAppear {
                    #if DEBUG
                    // Dev loop: open the Desk on launch so simulator voice
                    // runs need no UI driving (`OS1_VOICE_AUTOSTART=1`), or
                    // just the sheet — the board, no call — with
                    // `OS1_OPEN_DESK=1`. Both exist because the Desk sits
                    // behind a toolbar tap that a simulator run can't make.
                    let env = ProcessInfo.processInfo.environment
                    if env["OS1_VOICE_AUTOSTART"] != nil || env["OS1_OPEN_DESK"] != nil {
                        showDesk = true
                    }
                    // Same reason as the Desk: the new-session palette sits
                    // behind a toolbar tap, and a toolbar glyph is the one
                    // target a scripted click reliably misses.
                    if env["OS1_OPEN_NEW"] != nil {
                        newSessionRequest = NewSessionRequest()
                    }
                    if env["OS1_OPEN_SUPPORT"] != nil {
                        showSupport = true
                    }
                    if env["OS1_OPEN_SETTINGS"] != nil {
                        showSettings = true
                    }
                    // Same reason again: the catch-up deck is behind a band row
                    // that only exists when you have unread work, which a
                    // scripted run can't rely on being there.
                    if env["OS1_OPEN_CATCHUP"] != nil {
                        showCatchUp = true
                    }
                    #endif
                }
                .sheet(item: $newSessionRequest) { request in
                    NewSessionView(
                        initialRepo: request.repo,
                        initialWorkspaceId: request.workspaceId,
                        autoDictate: request.dictate
                    ) { session, seed in
                        openOptimistic(session, seed: seed)
                    } onResolved: { tempId, result in
                        resolveCreate(tempId: tempId, result: result)
                    }
                }
                .sheet(isPresented: $showArchived) {
                    ArchivedSessionsView(
                        sessions: viewModel.archivedSessions,
                        loaded: viewModel.archivedHasLoaded,
                onOpen: { session in
                    pendingArchivedOpen = session
                    showArchived = false
                },
                onRestore: viewModel.unarchive,
                loadFailure: viewModel.archivedLoadFailure,
                onRetry: { Task { await viewModel.refreshArchived(force: true) } }
                    )
                    .task { await viewModel.refreshArchived() }
                }
                .onChange(of: showArchived) { _, shown in
                    guard !shown, let session = pendingArchivedOpen else { return }
                    pendingArchivedOpen = nil
                    Task { path.append(await viewModel.hydrated(session)) }
                }
                .fullScreenCoverCompat(isPresented: $showCatchUp) {
                    CatchUpView(list: viewModel) { session in
                        pendingCatchUpOpen = session
                        showCatchUp = false
                    }
                }
                .onChange(of: showCatchUp) { _, shown in
                    guard !shown, let session = pendingCatchUpOpen else { return }
                    pendingCatchUpOpen = nil
                    path.append(session)
                }
                .safeAreaInset(edge: .bottom) {
                    errorBanner
                }
        }
        // Recorded on the way IN, from the stack itself rather than at each
        // of the four push sites (row tap, session link, optimistic create,
        // dev auto-open), so a session opened by any route marks its row.
        .onChange(of: path) {
            if let open = path.last { lastOpenedSessionID = open.id }
        }
    }
    #endif

    @ViewBuilder
    private var loadingOrList: some View {
        // An empty live list isn't yet an empty account: the archived index
        // is a second request, and a list whose sessions are all archived
        // would otherwise flash "nothing here yet" before it arrives. Only
        // ever waits when the live list came back empty, so the common case
        // renders the moment it lands.
        if !viewModel.hasLoaded || (hasNoRows && !viewModel.archivedHasLoaded) {
            loadingState
        } else if hasNoRows {
            if let failure = viewModel.loadFailure {
                unreachableState(failure)
            } else {
                emptyState
            }
        } else {
            list
        }
    }

    private var hasNoRows: Bool {
        viewModel.sessions.isEmpty && viewModel.archivedSessions.isEmpty
    }

    /// True while the whole screen is given over to a failed load — which is
    /// also the one time the banner has nothing to add.
    private var showsFailureScreen: Bool {
        viewModel.hasLoaded && hasNoRows && viewModel.loadFailure != nil
    }

    /// The first load. A tailnet server with the tunnel down answers nothing
    /// for a full minute, and a bare spinner spends that minute saying
    /// nothing — so the diagnosis joins it as soon as there is one.
    private var loadingState: some View {
        VStack(spacing: 14) {
            #if os(iOS)
            // The spinner is for the failure case only: once there is a
            // diagnosis to read, rows that will never arrive would be a lie.
            if viewModel.loadFailure == nil {
                SessionsSkeleton()
            } else {
                ProgressView()
            }
            #else
            ProgressView()
            #endif
            if let failure = viewModel.loadFailure {
                VStack(spacing: 3) {
                    Text(failure.title)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(OS1VisualStyle.text)
                    Text(failure.fix ?? failure.detail)
                        .font(.footnote)
                        .foregroundStyle(OS1VisualStyle.textDim)
                }
                .multilineTextAlignment(.center)
                .frame(maxWidth: 300)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .animation(.easeOut(duration: 0.2), value: viewModel.loadFailure)
    }

    /// Floating glass capsule, matching the session view's banner styling,
    /// instead of a full-width opaque bar.
    ///
    /// Silent while the failure screen is up: the same sentence twice, once
    /// mid-screen and once in red at the bottom, reads as two problems.
    @ViewBuilder
    private var errorBanner: some View {
        if let error = viewModel.error, !showsFailureScreen {
            HStack(spacing: 10) {
                Text(error).lineLimit(2)
                if viewModel.archiveFailure != nil {
                    Button("Retry archive") { viewModel.retryArchive() }
                        .buttonStyle(.borderless)
                }
            }
            .font(.footnote)
            .foregroundStyle(.red)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .glassSurface(in: Capsule())
            .padding(.bottom, 8)
        }
    }

    /// Follow a `bks-…` link from a transcript. A session we're already
    /// polling opens in place; one we've never seen (archived away, another
    /// server, deleted) can't be pushed, so it hands off to the web app rather
    /// than dropping the tap silently.
    private func openSessionLink(id: String) -> OpenURLAction.Result {
        if let session = viewModel.sessions.first(where: { $0.id == id })
            ?? viewModel.archivedSessions.first(where: { $0.id == id }) {
            #if os(macOS)
            if session.slim == true {
                Task { openedArchivedSession = await viewModel.hydrated(session) }
            } else if session.archived == true {
                openedArchivedSession = session
            } else {
                selectedSessionID = session.id
            }
            #else
            if session.slim == true {
                // A row from the archived index carries what a list renders
                // and nothing else — fetch the session itself before opening
                // it, or the conversation comes up quietly missing its PR,
                // its walkthrough and its model.
                Task { path.append(await viewModel.hydrated(session)) }
            } else {
                path.append(session)
            }
            #endif
            return .handled
        }
        guard let base = ServerConfig.shared.baseURL else { return .handled }
        return .systemAction(
            base.appendingPathComponent("session").appendingPathComponent(id)
        )
    }

    /// Open the composer for an Action Button "New Idea", mic hot. A request
    /// is consumed once, so returning to the list later doesn't reopen it.
    private func openQuickCapture() {
        guard let request = quickCapture.take() else { return }
        newSessionRequest = NewSessionRequest(dictate: request.dictate)
    }

    private func openRequestedSession() {
        guard viewModel.hasLoaded, let request = requestedSession.take() else { return }
        _ = openSessionLink(id: request.sessionId)
    }

    /// Dev convenience for simulator runs: OS1_OPEN_SESSION=<id> jumps straight
    /// into that session once the list has loaded.
    private func autoOpenFromEnvironment() {
        guard let id = ProcessInfo.processInfo.environment["OS1_OPEN_SESSION"],
              let session = viewModel.sessions.first(where: { $0.id == id })
        else { return }
        #if os(macOS)
        if selectedSessionID == nil { selectedSessionID = session.id }
        #else
        if path.isEmpty { path.append(session) }
        #endif
    }

    private func storedDraft(for id: String) -> SessionViewModel.ComposerDraft? {
        let draft = SessionViewModel.ComposerDraft(
            text: DraftsStore.shared.text(for: id) ?? "",
            images: composerDrafts[id]?.images ?? []
        )
        return draft.isEmpty ? nil : draft
    }

    private func saveComposerDraft(
        _ draft: SessionViewModel.ComposerDraft,
        for id: String
    ) {
        composerDrafts[id] = draft.images.isEmpty
            ? nil
            : SessionViewModel.ComposerDraft(text: "", images: draft.images)
        DraftsStore.shared.setText(draft.text, for: id, immediate: true)
    }

    /// The moment Start is tapped: an optimistic row (temporary `pending-` id)
    /// joins the list and the conversation view opens seeded from the prompt —
    /// no waiting on the server. `resolveCreate` swaps in the real id (or
    /// rolls back) when the background create finishes.
    private func openOptimistic(
        _ session: Session, seed: SessionViewModel.OptimisticSeed
    ) {
        viewModel.addOptimistic(session)
        optimisticSeeds[session.id] = seed
        #if os(macOS)
        selectedSessionID = session.id
        #else
        path.append(session)
        #endif
    }

    /// The tab strip's "+" — a new session in a workspace opens as a tab right
    /// away, with no composer sheet in between. The server mints an EMPTY
    /// sibling that shares this workspace's worktree and branch; it carries no
    /// run until its first message, so there is no prompt to collect up front,
    /// and nothing the sheet would have asked for is still open (repo, branch
    /// and mode all come from the workspace).
    ///
    /// The create is awaited rather than optimistic: writing the session file
    /// is one round trip — no worktree to prepare — so the tab appears with a
    /// real id from its first frame, and a failure lands before there's a tab
    /// to tear down. The row is filed locally so the strip has it immediately
    /// instead of on the next poll.
    private func openSiblingTab(of source: Session) async -> Session? {
        do {
            let created = try await OS1API.newSiblingSession(from: source.id)
            viewModel.addOptimistic(created)
            return created
        } catch {
            createError = error.localizedDescription
            return nil
        }
    }

    /// The background create finished: move the pending row (and the open
    /// conversation) onto the server's real id, or roll the pending row back
    /// and surface the error.
    private func resolveCreate(tempId: String, result: Result<String, Error>) {
        switch result {
        case .success(let id):
            viewModel.resolveOptimistic(tempId: tempId, realId: id)
            sessionPageCache.remove(sessionId: tempId)
            resolvedSessionIds[tempId] = id
            if let seed = optimisticSeeds.removeValue(forKey: tempId) {
                optimisticSeeds[id] = seed
            }
            if let draft = composerDrafts.removeValue(forKey: tempId) {
                composerDrafts[id] = draft
            }
            DraftsStore.shared.remap(tempId: tempId, to: id)
            #if os(macOS)
            if selectedSessionID == tempId { selectedSessionID = id }
            #else
            // Swap the pending entry wherever it sits in the stack, rather
            // than whatever happens to be on top: worktree prep takes seconds,
            // and by the time it lands the person may have gone back and
            // opened a different session — replacing the top would yank them
            // into the session they started earlier.
            if let index = path.firstIndex(where: { $0.id == tempId }),
               let session = viewModel.sessions.first(where: { $0.id == id }) {
                var next = path
                next[index] = session
                // No visible pop/push double transition.
                var transaction = Transaction()
                transaction.disablesAnimations = true
                withTransaction(transaction) {
                    path = next
                }
            }
            #endif
        case .failure(let error):
            viewModel.removeOptimistic(tempId)
            sessionPageCache.remove(sessionId: tempId)
            optimisticSeeds[tempId] = nil
            #if os(macOS)
            if selectedSessionID == tempId { selectedSessionID = nil }
            #else
            // Same care as the success path: drop the failed session's own
            // screen, not whatever the person is looking at now.
            path.removeAll { $0.id == tempId }
            #endif
            createError = error.localizedDescription
        }
    }

    // ── Filtering / grouping ──────────────────────────────────────────────

    private var availableRepos: [String] {
        SessionsListViewModel.repositoryOrder(
            in: viewModel.sessions,
            preferredOrderJSON: preferredRepoOrder
        )
    }

    /// What counts as "mine" here — one rule, shared with the Archived sheet.
    private var peopleLens: PeopleLens { PeopleLens.current() }

    private var visibleArchivedSessions: [Session] {
        let lens = peopleLens
        return viewModel.archivedSessions.filter { session in
            (peopleFilter != "mine" || lens.isMine(session))
                && (repoFilter == "all" || session.effectiveRepo == repoFilter)
        }
    }

    /// The current lens as one predicate, with its inputs read once.
    ///
    /// Hides stay here rather than in the view model's grouping: the hide map
    /// changes independently of the session list, so a hidden row has to
    /// disappear on the tap, not on the next poll.
    private func visibilityFilter() -> (SidebarWorkspace) -> Bool {
        let people = peopleFilter
        let lens = peopleLens
        let repo = repoFilter
        let query = searchText.trimmingCharacters(in: .whitespaces).lowercased()
        // Rows this person has hidden drop out of the sidebar — except while
        // a session of theirs is blocked on a question (the poll consumes the
        // hide when that happens), and except while searching, which is how a
        // hidden row is found again so its menu can restore it.
        #if os(iOS)
        let hides = query.isEmpty ? HideStore.shared.hides : [:]
        #endif
        return { workspace in
            #if os(iOS)
            if !hides.isEmpty, workspace.lane != .needsInput,
               hides[SidebarRowKeys.rowKey(for: workspace)] != nil {
                return false
            }
            #endif
            if people == "mine", !lens.owns(workspace) { return false }
            if repo != "all", workspace.effectiveRepo != repo { return false }
            guard !query.isEmpty else { return true }
            if workspace.title.lowercased().contains(query) { return true }
            return workspace.sessions.contains { session in
                [session.title, session.effectiveRepo, session.branch, session.id]
                    .compactMap { $0 }
                    .contains { $0.lowercased().contains(query) }
            }
        }
    }

    /// Whether anything survives the lens — the empty-state overlay's
    /// question. Stops at the first match instead of filtering and sorting
    /// the whole list a second time per body evaluation.
    private var hasVisibleWorkspaces: Bool {
        allSidebarWorkspaces.contains(where: visibilityFilter())
    }

    private var filteredWorkspaces: [SidebarWorkspace] {
        let workspaces = allSidebarWorkspaces.filter(visibilityFilter())
        // Decorated sort: parse each row's date once, not once per
        // comparison — this runs on the main thread on every body
        // evaluation, and the list can be thousands of rows with the
        // people filter set to "everyone".
        return workspaces
            .map { workspace in
                (
                    workspace: workspace,
                    inProgress: workspace.lane == .inProgress,
                    date: sortBy == .updated
                        ? workspace.lastActivityDate
                        : workspace.createdDate
                )
            }
            .sorted {
                if $0.inProgress != $1.inProgress { return $0.inProgress }
                return $0.date > $1.date
            }
            .map(\.workspace)
    }

    /// Grouped once by the view model, not per read: several properties below
    /// (`filteredWorkspaces`, the empty-state overlay, the tab-strip lookup)
    /// each want the rows, and regrouping thousands of sessions inside a body
    /// evaluation is what used to pin the main thread on launch.
    private var allSidebarWorkspaces: [SidebarWorkspace] {
        viewModel.sidebarWorkspaces
    }

    private struct SessionGroup: Identifiable {
        let id: String
        let title: String
        let workspaces: [SidebarWorkspace]
        let repo: String?
    }

    private struct RepoSessionGroup: Identifiable {
        let repo: String
        let workspaces: [SidebarWorkspace]
        /// The sections nested under the repo band: status lanes in "Repo and
        /// status", activity bands in "Repo and inbox".
        let lanes: [SessionGroup]

        var id: String { repo }
    }

    private var groups: [SessionGroup] {
        let workspaces = filteredWorkspaces
        switch groupBy {
        case .recent:
            return workspaces.isEmpty
                ? []
                : [SessionGroup(
                    id: "recent",
                    title: "",
                    workspaces: workspaces,
                    repo: nil
                )]
        case .repo:
            let byRepo = Dictionary(grouping: workspaces, by: \.effectiveRepo)
            return availableRepos.filter { byRepo[$0] != nil }.map {
                SessionGroup(
                    id: "repo-\($0)",
                    title: $0,
                    workspaces: byRepo[$0]!,
                    repo: $0
                )
            }
        case .inbox:
            // One flat list across every repo, banded like an email inbox:
            // Needs action first, then by when the row last moved. Repo
            // identity moves onto the rows themselves (see `sessionRow`).
            return SessionsListViewModel.inboxBands(workspaces).map { band in
                SessionGroup(
                    id: "inbox-\(band.band.rawValue)",
                    title: band.band.label,
                    workspaces: band.workspaces,
                    repo: nil
                )
            }
        case .status:
            return Session.Lane.allCases.compactMap { lane in
                let inLane = workspaces.filter { $0.lane == lane }
                return inLane.isEmpty
                    ? nil
                    : SessionGroup(
                        id: "lane-\(lane.rawValue)",
                        title: lane.label,
                        workspaces: inLane,
                        repo: nil
                    )
            }
        case .repoStatus, .repoInbox:
            // Both nest their sections under repo bands — see
            // repoSessionGroups / repoInboxGroups.
            return []
        }
    }

    private var repoSessionGroups: [RepoSessionGroup] {
        let byRepo = Dictionary(grouping: filteredWorkspaces, by: \.effectiveRepo)
        return availableRepos.compactMap { repo in
            guard let workspaces = byRepo[repo] else { return nil }
            let lanes = Session.Lane.allCases.compactMap { lane in
                let inLane = workspaces.filter { $0.lane == lane }
                return inLane.isEmpty
                    ? nil
                    : SessionGroup(
                        id: "repo-\(repo)-lane-\(lane.rawValue)",
                        title: lane.label,
                        workspaces: inLane,
                        repo: nil
                    )
            }
            return RepoSessionGroup(repo: repo, workspaces: workspaces, lanes: lanes)
        }
    }

    /// "Repo and inbox": the same repo bands, with each repo's rows split into
    /// the Inbox activity bands instead of status lanes.
    private var repoInboxGroups: [RepoSessionGroup] {
        let byRepo = Dictionary(grouping: filteredWorkspaces, by: \.effectiveRepo)
        return availableRepos.compactMap { repo in
            guard let workspaces = byRepo[repo] else { return nil }
            let bands = SessionsListViewModel.inboxBands(workspaces).map { band in
                SessionGroup(
                    id: "repo-\(repo)-band-\(band.band.rawValue)",
                    title: band.band.label,
                    workspaces: band.workspaces,
                    repo: nil
                )
            }
            return RepoSessionGroup(repo: repo, workspaces: workspaces, lanes: bands)
        }
    }

    private var filterMenu: some View {
        Menu {
            filterMenuContent
        } label: {
            #if os(macOS)
            Image(
                systemName: repoFilter == "all"
                    ? "line.3.horizontal.decrease"
                    : "line.3.horizontal.decrease.circle.fill"
            )
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(repoFilter == "all" ? OS1VisualStyle.textDim : OS1VisualStyle.accentInk)
            .frame(width: 26, height: 24)
            .contentShape(Rectangle())
            #else
            WebIcon(
                kind: .filter,
                size: 24,
                color: repoFilter == "all"
                    ? OS1VisualStyle.textDim
                    : OS1VisualStyle.accentInk
            )
            #endif
        }
        .accessibilityLabel("Filter sessions")
        .accessibilityValue(filterAccessibilityValue)
    }

    private var filterMenuContent: some View {
        Group {
            Button("Archived") { showArchived = true }
            Picker("Show", selection: $peopleFilter) {
                Text("My sessions").tag("mine")
                Text("Everyone").tag("all")
            }
            Picker("Group by", selection: $groupByRaw) {
                ForEach(GroupBy.allCases, id: \.rawValue) { option in
                    Text(option.label).tag(option.rawValue)
                }
            }
            Picker("Repo", selection: $repoFilter) {
                Text("All repos").tag("all")
                ForEach(availableRepos, id: \.self) { repo in
                    Text(repo).tag(repo)
                }
            }
            .pickerStyle(.menu)
            Picker("Sort by", selection: $sortByRaw) {
                ForEach(SortBy.allCases, id: \.rawValue) { option in
                    Text(option.label).tag(option.rawValue)
                }
            }
        }
    }

    private var filterAccessibilityValue: String {
        let people = peopleFilter == "mine" ? "My sessions" : "Everyone"
        let repo = repoFilter == "all" ? "All repositories" : RepoTile.label(for: repoFilter)
        return "\(people), grouped by \(groupBy.label), \(repo), sorted by \(sortBy.label)"
    }

    // ── List body ─────────────────────────────────────────────────────────

    #if os(macOS)
    private var list: some View {
        List(selection: $selectedSessionID) {
            listSections
        }
        .listStyle(.sidebar)
        .overlay { emptyFilterOverlay }
        // Delete key archives the selected session — the Mac-native
        // counterpart to iOS's swipe.
        .onDeleteCommand {
            if let selectedSessionID,
               let workspace = allSidebarWorkspaces.first(where: {
                   $0.sessions.contains { $0.id == selectedSessionID }
               }) {
                archive(workspace)
            }
        }
    }
    #else
    private var list: some View {
        List {
            listSections
        }
        .listStyle(.plain)
        // The 44pt floor exists for rows that don't state their own height;
        // ours all do, and all it did here was inflate the lane headings into
        // full-height rows. Rows carry the touch metrics in their own padding
        // (which is why SessionRow pads to 13 rather than 11).
        .environment(\.defaultMinListRowHeight, 8)
        .scrollContentBackground(.hidden)
        .background(OS1VisualStyle.background)
        .listSectionSpacing(10)
        .contentMargins(.top, 4, for: .scrollContent)
        .overlay { emptyFilterOverlay }
        .refreshable {
            await viewModel.refresh()
        }
        .navigationDestination(for: Session.self) { session in
            SessionTabsView(
                session: session,
                tabs: SessionsListViewModel.tabSessions(
                    in: viewModel.sessions,
                    containing: session
                ),
                workspaceNames: viewModel.workspaceNames,
                viewModelForSession: {
                    sessionPageCache.viewModel(
                        for: $0,
                        scope: sessionCacheScope,
                        seed: optimisticSeeds[$0.id],
                        composerDraft: storedDraft(for: $0.id)
                    )
                },
                onSaveComposerDraft: { savedSession, draft in
                    let id = resolvedSessionIds[savedSession.id] ?? savedSession.id
                    saveComposerDraft(draft, for: id)
                },
                onNewSession: {
                    // The session's ⋯ → "New session in this workspace": a sibling
                    // tab, not a standalone session. The workspace id comes from
                    // the latest polled copy — the row NavigationPath retained
                    // predates a workspace this session may have joined since.
                    let current = viewModel.sessions.first { $0.id == session.id } ?? session
                    guard current.workspaceId?.isEmpty == false else {
                        // A workspace-less legacy session has no strip to join,
                        // so the composer sheet stays the way in — it's a
                        // standalone session, and its repo/mode are still open
                        // questions.
                        newSessionRequest = NewSessionRequest(repo: session.effectiveRepo)
                        return nil
                    }
                    return await openSiblingTab(of: current)
                },
                onRenameWorkspace: { name in
                    guard let workspace = workspace(containing: session) else { return }
                    viewModel.rename(workspace, to: name)
                },
                onArchiveWorkspace: {
                    guard let workspace = workspace(containing: session) else { return }
                    archive(workspace)
                },
                onCloseTab: { closed in
                    sessionPageCache.remove(sessionId: closed.id)
                    viewModel.archive(closed)
                }
            )
            .id(session.id)
        }
    }
    #endif

    /// The repo an Inbox row wears on its tile — nothing above it says which
    /// repo it belongs to, since the flat list has no repo bands. Every other
    /// grouping has a repo band or a repo filter doing that job, and a list
    /// that's already one repo (a repo filter, or a single-repo instance)
    /// would only repeat itself.
    private func inboxRowRepo(_ workspace: SidebarWorkspace) -> String? {
        guard groupBy == .inbox, repoFilter == "all", availableRepos.count > 1
        else { return nil }
        return workspace.effectiveRepo
    }

    #if os(iOS)
    /// Matched across the whole workspace, not just its main session: the
    /// strip's sibling tabs all live behind one row, so returning from a tab
    /// highlights the row that pushed it.
    private func isLastOpened(_ workspace: SidebarWorkspace) -> Bool {
        guard let lastOpenedSessionID else { return false }
        return workspace.sessions.contains { $0.id == lastOpenedSessionID }
    }
    #endif

    @ViewBuilder
    private func sessionRow(_ workspace: SidebarWorkspace) -> some View {
        let session = workspace.mainSession
        let canArchive = !workspace.isOptimistic
        let repo = inboxRowRepo(workspace)
        #if os(macOS)
        // Selection drives the detail column; select by id so rows replaced
        // by polling (fresh struct values every refresh) keep the selection.
        // Archiving is Mac-idiomatic here: hover button on the row, context
        // menu, and the Delete key — swipe also works but isn't the primary.
        SessionRow(
            session: workspace.statusSession,
            title: workspace.title,
            sessions: workspace.sessions,
            repo: repo,
            onArchive: canArchive ? { archive(workspace) } : nil
        )
        .tag(session.id)
        .swipeActions(edge: .trailing) { archiveButton(workspace, viaSwipe: true) }
        .contextMenu { archiveButton(workspace) }
        #else
        Button {
            path.append(session)
        } label: {
            SessionRow(
                session: workspace.statusSession,
                title: workspace.title,
                sessions: workspace.sessions,
                repo: repo,
                highlighted: isLastOpened(workspace)
            )
        }
        .buttonStyle(.plain)
        .listRowInsets(EdgeInsets(
            top: 2, leading: sidebarMargin, bottom: 2, trailing: sidebarMargin
        ))
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
        .swipeActions(edge: .trailing) { archiveButton(workspace, viaSwipe: true) }
        // Swipe right to pin, left to archive: the pin is the reversible one,
        // so it takes the leading edge (and its full swipe just toggles).
        // The tint rides on the swipe, not on the button: it paints the swipe
        // action's own background here, but in the context menu the same tint
        // would land on the glyph and make Pin the one coloured item in a
        // column of grey ones.
        .swipeActions(edge: .leading) {
            pinButton(workspace, filled: true).tint(OS1VisualStyle.yellow)
        }
        .contextMenu {
            if canArchive { workspaceMenu(workspace) }
        }
        #endif
    }

    #if os(iOS)
    /// Leading swipe (and context menu) action. Non-destructive: the row stays
    /// where it is and gains a copy in the Pinned band, so the cell just closes
    /// — no `.destructive` role, and the toggle animates the band's insert.
    ///
    /// `filled` for the same reason the tint is set by the caller: a swipe
    /// action is a glyph knocked out of a colour capsule, where the solid
    /// symbol is the system's own shape, while every other glyph in the
    /// context menu is an outline one.
    @ViewBuilder
    private func pinButton(
        _ workspace: SidebarWorkspace,
        filled: Bool = false
    ) -> some View {
        if !workspace.isOptimistic {
            let pinned = PinStore.shared.isPinned(workspace)
            let symbol = pinned ? "pin.slash" : "pin"
            Button {
                withAnimation(.snappy(duration: 0.28)) {
                    PinStore.shared.toggle(workspace)
                }
            } label: {
                Label(
                    pinned ? "Unpin" : "Pin",
                    systemImage: filled ? "\(symbol).fill" : symbol
                )
            }
        }
    }

    /// Flip the whole workspace read or unread, like the web sidebar row's
    /// right-click action — one unread session bolds the row, so the toggle
    /// has to cover every session behind it. Only the move you can actually
    /// make is offered, the way the web menu does it.
    @ViewBuilder
    private func readButton(_ workspace: SidebarWorkspace) -> some View {
        let unread = ReadsStore.shared.isUnread(workspace.sessions)
        Button {
            for session in workspace.sessions {
                if unread {
                    ReadsStore.shared.markRead(session)
                } else {
                    ReadsStore.shared.markUnread(session)
                }
            }
        } label: {
            Label(
                unread ? "Mark as read" : "Mark as unread",
                systemImage: unread ? "envelope.open" : "envelope.badge"
            )
        }
    }

    @ViewBuilder
    private func workspaceMenu(_ workspace: SidebarWorkspace) -> some View {
        readButton(workspace)

        // Same action as the leading swipe, for anyone who reaches for the
        // long press instead.
        pinButton(workspace)

        Button {
            renameText = workspace.title
            renamingWorkspace = workspace
        } label: {
            Label("Rename", systemImage: "pencil")
        }

        if let link = workspace.shareURL {
            ShareLink(item: link) {
                Label("Share link", systemImage: "square.and.arrow.up")
            }
        }

        if let session = workspace.pullRequestSession,
           let state = session.pullRequestContextState {
            Divider()
            Label(state.label, systemImage: prStateIcon(state))
                .disabled(true)
            prAction(state, session: session, workspace: workspace)
            if let prURL = session.prUrl.flatMap(URL.init(string:)) {
                Button {
                    copyToPasteboard(prURL.absoluteString)
                    Haptics.play(.selection)
                } label: {
                    Label("Copy GitHub link", systemImage: "doc.on.doc")
                }
                Button {
                    slackShare = PrSlackShareRequest(
                        title: workspace.title,
                        url: prURL,
                        sessionId: session.id,
                        repo: session.repo,
                        branch: session.branch,
                        merged: session.prState == "MERGED",
                        walkthroughSummary: session.walkthrough?.summary,
                        suggestedScreenshot: session.walkthrough?.shots?
                            .first { $0.after != nil }?.after
                    )
                } label: {
                    Label("Share to Slack", systemImage: "paperplane")
                }
                Link(destination: prURL) {
                    Label {
                        Text(verbatim: session.prNumber.map { "Open PR #\($0)" } ?? "Open pull request")
                    } icon: {
                        Image(systemName: "arrow.triangle.pull")
                    }
                }
            }
        }

        // Last of the three that send you somewhere else (share sheet, Safari,
        // this sheet), rather than sitting between Pin and Rename: it is the
        // one you reach for least, and the run of state → edit → go-look-at-it
        // is the order the web row's menu already reads in.
        Button {
            detailsWorkspace = workspace
        } label: {
            Label("Worktree details", systemImage: "info.circle")
        }

        if !workspace.isOptimistic {
            Divider()
            // Hiding is the personal counterpart to archiving: the row leaves
            // YOUR sidebar (here and in the web one) while the session keeps
            // running for everyone else — so it isn't destructive-styled.
            //
            // "…my sidebar", the web menu's wording, is one word too wide for
            // a context menu and wrapped onto a second line — the only item in
            // the menu that did. The shorter phrasing is the web's own, from
            // its narrower menus (FeedRows, the band header).
            if HideStore.shared.isHidden(workspace) {
                Button {
                    HideStore.shared.clear([SidebarRowKeys.rowKey(for: workspace)])
                } label: {
                    Label("Restore to sidebar", systemImage: "eye")
                }
            } else {
                Button {
                    hide(workspace)
                } label: {
                    Label("Hide from sidebar", systemImage: "eye.slash")
                }
            }
            if workspace.pullRequestSession?.pullRequestContextState?.suggestsArchive != true {
                Button(role: .destructive) {
                    archive(workspace)
                } label: {
                    Label("Archive", systemImage: "archivebox")
                }
            }
        }
    }

    @ViewBuilder
    private func prAction(
        _ state: Session.PullRequestContextState,
        session: Session,
        workspace: SidebarWorkspace
    ) -> some View {
        switch state {
        case .merged, .closed:
            Button(role: .destructive) { archive(workspace) } label: {
                Label("Archive", systemImage: "archivebox")
            }
        case .conflicts:
            Button {
                promptForPr(
                    session,
                    "Rebase this branch on the latest base branch, resolve the pull request's merge conflicts, run the relevant tests, commit the changes, and push them."
                )
            } label: {
                Label("Resolve conflicts", systemImage: "arrow.triangle.2.circlepath")
            }
        case .failing:
            Button {
                promptForPr(
                    session,
                    "Investigate the failing checks on PR #\(session.prNumber ?? 0), fix the failures, run the relevant tests, commit the changes, and push them."
                )
            } label: {
                Label("Fix checks", systemImage: "wrench.and.screwdriver")
            }
        case .running:
            if let url = session.prUrl.flatMap(URL.init(string:)) {
                Link(destination: url.appendingPathComponent("checks")) {
                    Label("View checks", systemImage: "checklist")
                }
            }
        case .draft:
            EmptyView()
        case .changesRequested:
            Button {
                promptForPr(
                    session,
                    "Address the requested changes on PR #\(session.prNumber ?? 0), run the relevant tests, commit the changes, and push them."
                )
            } label: {
                Label("Address feedback", systemImage: "text.bubble")
            }
        case .ready:
            Menu {
                Button("Squash and merge") { prepareContextMerge(session, method: "squash") }
                Button("Create a merge commit") { prepareContextMerge(session, method: "merge") }
                Button("Rebase and merge") { prepareContextMerge(session, method: "rebase") }
            } label: {
                Label("Merge pull request", systemImage: "arrow.triangle.merge")
            }
        }
    }

    private func prStateIcon(_ state: Session.PullRequestContextState) -> String {
        switch state {
        case .merged: "arrow.triangle.merge"
        case .closed, .failing: "xmark.circle.fill"
        case .conflicts: "exclamationmark.triangle.fill"
        case .running: "clock.fill"
        case .draft: "pencil.circle.fill"
        case .changesRequested: "exclamationmark.bubble.fill"
        case .ready: "checkmark.circle.fill"
        }
    }

    private func promptForPr(_ session: Session, _ prompt: String) {
        let busyMode = UserDefaults.standard.string(forKey: "os1.composer.busySend") ?? "queue"
        guard Outbox.shared.enqueue(
            sessionId: session.id,
            content: prompt,
            busyMode: busyMode,
            user: ServerConfig.shared.userName
        ) != nil else {
            prActionError = "Too many unsent messages. Send or delete some first."
            return
        }
        HideStore.shared.unhide(for: session)
        Haptics.play(.send)
    }

    private func prepareContextMerge(_ session: Session, method: String) {
        pendingContextMerge = ContextMerge(session: session, method: method)
    }

    private var contextMergeTitle: String {
        guard let number = pendingContextMerge?.session.prNumber else {
            return "Merge pull request?"
        }
        return "Merge PR #\(number)?"
    }

    private var contextMergeButtonLabel: String {
        switch pendingContextMerge?.method {
        case "merge": "Create a merge commit"
        case "rebase": "Rebase and merge"
        default: "Squash and merge"
        }
    }

    private func performContextMerge() {
        guard let pending = pendingContextMerge else { return }
        pendingContextMerge = nil
        Task {
            do {
                try await OS1API.mergePr(
                    sessionId: pending.session.id,
                    method: pending.method
                )
                Haptics.play(.commit)
                await viewModel.refresh()
            } catch {
                prActionError = (error as? LocalizedError)?.errorDescription
                    ?? error.localizedDescription
            }
        }
    }

    private func hide(_ workspace: SidebarWorkspace) {
        withAnimation(.snappy(duration: 0.28)) {
            HideStore.shared.hide(workspace)
        }
    }

    /// The sidebar row a pushed session belongs to, so the session's own overflow
    /// menu can act on the whole worktree. Resolved ids first: a session pushed
    /// while it was still optimistic keeps its temp id in the stack.
    private func workspace(containing session: Session) -> SidebarWorkspace? {
        let id = resolvedSessionIds[session.id] ?? session.id
        return viewModel.sidebarWorkspaces.first { workspace in
            workspace.sessions.contains { $0.id == id }
        }
    }
    #endif

    /// Trailing swipe (and Mac context-menu) action. Hidden for optimistic
    /// rows — even after create returns a real id, the server may not have
    /// exposed the session through its cached list yet.
    ///
    /// The swipe variant is `role: .destructive` and skips our own
    /// `withAnimation`: the destructive role tells the List the row is going
    /// away, so a full swipe runs the system's native delete choreography
    /// (row slides off, neighbors close up). A non-destructive button first
    /// snaps the cell shut and then our animation re-ran the whole
    /// inset-grouped section reflow — visibly morphing iOS 26's
    /// position-dependent corner radii at our curve's pace.
    @ViewBuilder
    private func archiveButton(
        _ workspace: SidebarWorkspace,
        viaSwipe: Bool = false
    ) -> some View {
        if !workspace.isOptimistic {
            Button(role: viaSwipe ? .destructive : nil) {
                archive(workspace, animated: !viaSwipe)
            } label: {
                // A Label, not our own icon+text stack: a swipe action lays
                // out the system's label shape (glyph over caption, dropping
                // to the glyph alone in a short swipe), and a custom view is
                // rendered as its text only — which is why the archive glyph
                // never appeared. `archivebox` is the metaphor the overflow
                // menus here and in the session already use.
                Label("Archive", systemImage: "archivebox.fill")
            }
            // Red, matching the web sidebar's own swipe action at phone width
            // (.sidebar-swipe-action--archive, var(--red)): the same gesture on
            // the same row should not change colour between the two clients.
            // Our own palette rather than stock .red — see OS1VisualStyle.
            .tint(OS1VisualStyle.red)
        }
    }

    private func archive(_ workspace: SidebarWorkspace, animated: Bool = true) {
        workspace.sessions.forEach {
            sessionPageCache.remove(sessionId: $0.id)
        }
        #if os(iOS)
        // The server unpins archived work for everyone (`unpinEverywhere`);
        // dropping it locally too keeps the Pinned band from holding a row
        // that just left the list.
        PinStore.shared.unpin(workspace)
        #endif
        #if os(macOS)
        if workspace.sessions.contains(where: { $0.id == selectedSessionID }) {
            selectedSessionID = nil
        }
        #endif
        if animated {
            // Mac hover button / Delete key / context menu: collapse the row
            // instead of blinking it out.
            withAnimation(.snappy(duration: 0.28)) {
                workspace.sessions.forEach(viewModel.archive)
            }
        } else {
            // Swipe path: the List's destructive-role delete animation owns
            // the removal; wrapping the mutation would fight it.
            workspace.sessions.forEach(viewModel.archive)
        }
    }

    private var sessionCacheScope: SessionViewModelCache.Scope {
        let config = ServerConfig.shared
        return SessionViewModelCache.Scope(
            serverURL: config.baseURLString,
            token: config.token
        )
    }

    /// Rows this person pinned, lifted to the top of the list in their own pin
    /// order. They also stay in their normal band below: pinning is quick
    /// access, not a status — the rule the web sidebar's Pinned band follows.
    /// Built from the filtered rows, so the search field and the repo/people
    /// filters narrow the band like everything else.
    #if os(iOS)
    private var pinnedWorkspaces: [SidebarWorkspace] {
        let store = PinStore.shared
        guard !store.pins.isEmpty else { return [] }
        return filteredWorkspaces
            .compactMap { workspace in store.rank(workspace).map { (workspace, $0) } }
            .sorted { $0.1 < $1.1 }
            .map(\.0)
    }
    #endif

    private var listSections: some View {
        Group {
            #if os(iOS)
            if !pinnedWorkspaces.isEmpty {
                Section {
                    ForEach(
                        visibleWorkspaces(pinnedWorkspaces, collapsedKey: "pinned")
                    ) { workspace in
                        sessionRow(workspace)
                    }
                } header: {
                    groupHeader(
                        title: "Pinned",
                        count: pinnedWorkspaces.count,
                        collapseKey: "pinned"
                    )
                }
            }
            #endif

            if groupBy == .repoStatus || groupBy == .repoInbox {
                ForEach(groupBy == .repoInbox ? repoInboxGroups : repoSessionGroups) { repoGroup in
                    // Folding a repo band takes its lane headings with it —
                    // the band's own heading is the one thing left standing.
                    let bandKey = repoBandKey(repoGroup.repo)
                    Section {
                        if !isCollapsed(bandKey) {
                            ForEach(repoGroup.lanes) { laneGroup in
                                statusLaneHeader(laneGroup)
                                ForEach(
                                    visibleWorkspaces(
                                        laneGroup.workspaces,
                                        collapsedKey: laneGroup.id
                                    )
                                ) { workspace in
                                    sessionRow(workspace)
                                }
                            }
                        }
                    } header: {
                        groupHeader(
                            title: repoGroup.repo,
                            count: repoGroup.workspaces.count,
                            repo: repoGroup.repo,
                            collapseKey: bandKey
                        )
                    }
                }
            } else {
                ForEach(groups) { group in
                    Section {
                        ForEach(
                            visibleWorkspaces(group.workspaces, collapsedKey: group.id)
                        ) { workspace in
                            sessionRow(workspace)
                        }
                    } header: {
                        if !group.title.isEmpty {
                            groupHeader(
                                title: group.title,
                                count: group.workspaces.count,
                                repo: group.repo,
                                collapseKey: group.id
                            )
                        }
                    }
                }
            }

            #if os(iOS)
            if !isPlainHidden { mobilePlainRow }
            #endif

            // The archived entry is a destination, not a proof that its index
            // has loaded. Keep it reachable even for an empty or failed fetch.
            if viewModel.hasLoaded {
                Section {
                    Button {
                        showArchived = true
                    } label: {
                        HStack(spacing: 9) {
                            #if os(iOS)
                            WebIcon(kind: .archive, size: 22, color: OS1VisualStyle.textDim)
                                .frame(width: 22, height: 22)
                                // Centred on the repo tiles above it, not
                                // flush with their left edge: the glyph's ink
                                // is ~16pt wide against a tile's 22, so
                                // sharing a left edge would leave it looking
                                // shifted. Its own box lands 1pt shy of their
                                // centre line, hence the nudge. An offset,
                                // not padding: the label keeps the 47pt
                                // column the row titles use.
                                .offset(x: 1)
                            #else
                            WebIcon(kind: .archive, size: 16, color: OS1VisualStyle.textDim)
                                .frame(width: 16, height: 16)
                            #endif
                            Text("Archived")
                                #if os(iOS)
                                // Same type as a repo band: it's a row that
                                // leads somewhere, not a caption.
                                .font(.callout.weight(.medium))
                                #else
                                .font(.body)
                                #endif
                                .foregroundStyle(OS1VisualStyle.textDim)
                            Spacer()
                            Text("\(viewModel.archivedSessions.count)")
                                .font(.footnote.weight(.medium))
                                .foregroundStyle(OS1VisualStyle.textFaint)
                                // Same trailing column as a row's run clock:
                                // the shared 16pt margin, no extra inset.
                        }
                        #if os(iOS)
                        // Same reason as SessionRow's 13: no 44pt floor now.
                        .padding(.vertical, 11)
                        #else
                        .padding(.vertical, 3)
                        #endif
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    #if os(iOS)
                    // The shared margin, like every other row in this list —
                    // the archive glyph lands on the same column as the repo
                    // tiles and band headings above it.
                    .listRowInsets(EdgeInsets(
                        top: 2, leading: sidebarMargin, bottom: 2, trailing: sidebarMargin
                    ))
                    .listRowSeparator(.hidden)
                    .listRowBackground(Color.clear)
                    #endif
                }
            }

        }
    }

    @ViewBuilder
    private var emptyFilterOverlay: some View {
        if !hasVisibleWorkspaces && viewModel.archivedSessions.isEmpty {
            if !searchText.isEmpty {
                ContentUnavailableView.search(text: searchText)
            } else if peopleFilter == "mine" {
                // Same look as the other two states on this screen: three
                // different placeholder styles on one list is what makes a
                // surface read as unfinished.
                ListPlaceholder(
                    symbol: "person.crop.circle",
                    title: "No sessions of yours yet",
                    message: "Sessions you start appear here."
                ) {
                    Button("New session") {
                        newSessionRequest = NewSessionRequest()
                    }
                    .buttonStyle(PlaceholderActionStyle())
                    Button("Show everyone's") { peopleFilter = "all" }
                        .buttonStyle(PlaceholderActionStyle(prominent: false))
                }
            }
        }
    }

    #if os(iOS)
    /// Plain is a project feed on the web, so it sits after the worktree/session
    /// sections and before Archived in the same ordinary row shape.
    private var mobilePlainRow: some View {
        Section {
            Button {
                showSupport = true
            } label: {
                HStack(spacing: 9) {
                    RepoTile(name: "plain", size: 22)
                    Text("Plain")
                        .font(.callout.weight(.medium))
                        .foregroundStyle(OS1VisualStyle.textDim)
                    Text("\(supportQueue.threads.count)")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(OS1VisualStyle.textFaint)
                    Spacer()
                    if urgentPlainTicketCount > 0 {
                        Text("\(urgentPlainTicketCount)")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(OS1VisualStyle.red)
                    }
                }
                .padding(.vertical, 11)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(
                urgentPlainTicketCount > 0
                    ? "Open Plain, \(supportQueue.threads.count) tickets, \(urgentPlainTicketCount) urgent"
                    : "Open Plain, \(supportQueue.threads.count) tickets"
            )
            // The long press the web sidebar answers with a right-click on the
            // same band. One item, like that menu: this row leads somewhere
            // rather than holding state, so there is nothing else to offer.
            // Not destructive-styled — the queue keeps running for everyone
            // else, and Settings → Appearance brings the row back.
            .contextMenu {
                Button {
                    withAnimation(.snappy(duration: 0.28)) {
                        SidebarFeeds.setVisible(SidebarFeeds.plain, false)
                    }
                } label: {
                    Label("Hide from sidebar", systemImage: "eye.slash")
                }
            }
        }
        .listRowInsets(EdgeInsets(
            top: 2, leading: sidebarMargin, bottom: 2, trailing: sidebarMargin
        ))
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
    }

    private var urgentPlainTicketCount: Int {
        supportQueue.threads.lazy.filter { $0.lane == .urgent }.count
    }

    /// Read off `@AppStorage` rather than `UserDefaults` so hiding the row
    /// redraws the list — the same value either way.
    private var isPlainHidden: Bool {
        SidebarFeeds.isHidden(SidebarFeeds.plain, in: hiddenFeedsRaw)
    }
    #endif

    /// Counted off the memoized grouping, one predicate per row — see
    /// `CatchUpQueue.unreadRowCount` for why it must not group again here.
    /// Reading `ReadsStore` inside this view is deliberate too: it is
    /// `@Observable`, so a mark landing invalidates the band rather than
    /// everything that could have read it.
    private var catchUpCount: Int {
        let reads = ReadsStore.shared
        guard reads.hasHydrated else { return 0 }
        let config = ServerConfig.shared
        return CatchUpQueue.unreadRowCount(
            in: viewModel.sidebarWorkspaces,
            viewerName: config.userName,
            viewerLogin: config.githubLogin,
            isUnread: { reads.isUnread($0) }
        )
    }

    private func groupHeader(
        title: String,
        count: Int,
        repo: String? = nil,
        collapseKey: String
    ) -> some View {
        HStack(spacing: 6) {
            // Only the naming half of the heading toggles the fold — the
            // repo's "+" stays its own target, and a Button nested inside
            // another swallows its taps on iOS.
            Button {
                toggleCollapsed(collapseKey)
            } label: {
                HStack(spacing: 6) {
                    if let repo {
                        #if os(iOS)
                        RepoTile(name: repo, size: 22)
                        #else
                        RepoTile(name: repo)
                        #endif
                    }
                    Text(repo.map { RepoTile.label(for: $0) } ?? title)
                        #if os(iOS)
                        // A repo band leads somewhere, so it's typed like the
                        // rows under it (web phone: 16px medium), not like the
                        // captions that only label them.
                        .font(.callout.weight(.medium))
                        #else
                        .font(.caption.weight(.semibold))
                        #endif
                    Text("\(count)")
                        #if os(iOS)
                        .font(.footnote.weight(.medium))
                        #else
                        .font(.caption.monospacedDigit())
                        #endif
                    collapseChevron(collapseKey)
                    // Without a trailing "+" to push against, stretch the
                    // heading so the whole line takes the tap.
                    if repo == nil {
                        Spacer(minLength: 0)
                    }
                }
                .foregroundStyle(OS1VisualStyle.textDim)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(collapseLabel(repo.map { RepoTile.label(for: $0) } ?? title, collapseKey))
            if let repo {
                Spacer(minLength: 8)
                Button {
                    newSessionRequest = NewSessionRequest(repo: repo)
                } label: {
                    Image(systemName: "plus")
                        #if os(iOS)
                        .font(.system(size: 18, weight: .medium))
                        .frame(width: 30, height: 30)
                        #else
                        .font(.system(size: 12, weight: .medium))
                        .frame(width: 20, height: 20)
                        #endif
                        .foregroundStyle(OS1VisualStyle.textDim)
                }
                .buttonStyle(.borderless)
                #if os(iOS)
                // The 30pt tap target is ~7.5pt wider than the glyph on each
                // side, so leaving it inside the shared margin parked the
                // "+"'s ink well short of it while the repo tile opposite it
                // sits flush — the whole line read as lopsided. Pull the frame
                // out by that overhang so the INK lands on the margin, the
                // same column the row titles below truncate at.
                .padding(.trailing, -7.5)
                #endif
                .accessibilityLabel("New session in \(RepoTile.label(for: repo))")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textCase(nil)
        .padding(.top, 4)
        #if os(iOS)
        // A section header takes the list's own 16pt inset rather than a row's
        // insets, so it needs the difference added by hand to sit on the same
        // column as the rows under it.
        .padding(.horizontal, sidebarMargin - 16)
        // Lopsided on purpose, like the lane headings below it: a band leads
        // the rows under it, so it sits nearer to them than to whatever came
        // before. The list's own header inset is what's being trimmed, hence
        // the negative value.
        .padding(.bottom, -3)
        #endif
    }

    /// A lane heading labels the rows under it, so its own insets are
    /// lopsided on purpose: air above to separate it from the previous lane,
    /// less below so the label reads as attached to its rows. The pair is
    /// measured off the web sidebar at phone width, where the same caption
    /// sits 19pt below the previous lane's last row and 9pt above its own
    /// first one (`.sidebar-lane-group` header: 8px group margin + 9/5px
    /// padding); the rows' own 2pt insets make up the rest. Those insets only
    /// bite because the list drops its 44pt minimum row height (see `list`) —
    /// that floor stretched the caption to a full row and left the label
    /// marooned in the middle of it.
    private func statusLaneHeader(_ group: SessionGroup) -> some View {
        Button {
            toggleCollapsed(group.id)
        } label: {
            HStack(spacing: 5) {
                // Captions, a size below the rows — the web's
                // `.sidebar-lane-group` pair at its phone step (13px semibold
                // label, 12px count).
                Text(group.title)
                    .font(.footnote.weight(.semibold))
                Text("\(group.workspaces.count)")
                    .font(.caption.monospacedDigit())
                collapseChevron(group.id)
            }
            .foregroundStyle(OS1VisualStyle.textDim)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(collapseLabel(group.title, group.id))
        .listRowInsets(EdgeInsets(
            top: 17, leading: sidebarMargin, bottom: 7, trailing: sidebarMargin
        ))
        .listRowSeparator(.hidden)
        .listRowBackground(Color.clear)
    }

    /// The fold marker: points down when the section is open, right when it's
    /// shut — same language as the web sidebar's group chevron.
    ///
    /// On iOS an open section wears no marker at all. The rows under a repo
    /// already say it's open, so the only thing worth marking is the state
    /// you can't see: a shut band gets the chevron, and the heading beside it
    /// stays a plain name rather than a permanently decorated one.
    @ViewBuilder
    private func collapseChevron(_ key: String) -> some View {
        #if os(iOS)
        if isCollapsed(key) {
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(OS1VisualStyle.textFaint)
                .transition(.opacity)
        }
        #else
        Image(systemName: "chevron.down")
            .font(.system(size: 9, weight: .semibold))
            .foregroundStyle(OS1VisualStyle.textFaint)
            .rotationEffect(.degrees(isCollapsed(key) ? -90 : 0))
        #endif
    }

    private func collapseLabel(_ title: String, _ key: String) -> String {
        isCollapsed(key) ? "\(title), collapsed" : "\(title), expanded"
    }

    private var emptyState: some View {
        ListPlaceholder(
            symbol: "bubble.left.and.bubble.right",
            title: "No sessions",
            message: "Start one and it shows up here."
        ) {
            // The only thing worth offering here. Settings used to sit under
            // it, but the app tile in the corner is already that door — a
            // placeholder shouldn't spend its one moment of attention
            // pointing at chrome that never left the screen.
            Button("New session") { newSessionRequest = NewSessionRequest() }
                .buttonStyle(PlaceholderActionStyle())
            Button("Archived") { showArchived = true }
                .buttonStyle(PlaceholderActionStyle(prominent: false))
        }
    }

    /// The list is empty because nothing came back, which is a different
    /// screen from an empty list: "No sessions" reads as a server with
    /// nothing on it, when the truth is a dropped tailnet or a dead signal
    /// and the fix is nowhere near Settings. So the failure gets the
    /// headline, the server we couldn't reach gets named, and the first
    /// button is the one that answers a connection problem.
    private func unreachableState(_ failure: Reachability.Diagnosis) -> some View {
        ListPlaceholder(
            symbol: failure.isConnection
                ? "wifi.exclamationmark"
                : "exclamationmark.triangle",
            title: failure.title,
            message: failureMessage(failure)
        ) {
            // One button, the one the diagnosis asks for. A wrong address
            // doesn't heal by being retried, and a timeout isn't fixed in
            // Settings — offering both would just make you pick.
            switch failure.remedy {
            case .retry:
                // The poll keeps trying underneath either way; this is for
                // the person who just turned the VPN back on and doesn't
                // want to wonder whether the app noticed.
                Button(action: retryLoad) {
                    if isRetrying {
                        // Same footprint as the label it replaces, so the
                        // capsule doesn't resize when the retry starts.
                        ProgressView().controlSize(.small)
                    } else {
                        Text("Try again")
                    }
                }
                .buttonStyle(PlaceholderActionStyle())
                .disabled(isRetrying)
            case .settings:
                settingsButton
            }
            Button("Archived") { showArchived = true }
                .buttonStyle(PlaceholderActionStyle(prominent: false))
        }
    }

    /// The one line under the headline: the fix when the diagnosis knows one,
    /// otherwise the server that stayed silent — naming it is what tells you
    /// whether the app is pointed where you think it is. The system's own
    /// wording is the last resort, for failures that aren't about the
    /// network at all.
    private func failureMessage(_ failure: Reachability.Diagnosis) -> String {
        if let fix = failure.fix { return fix }
        guard failure.isConnection,
              let host = ServerConfig.shared.baseURL?.host(), !host.isEmpty
        else { return failure.detail }
        return "\(host) didn't answer."
    }

    /// Only shown where Settings is the actual fix — a server that can't be
    /// found, a token that isn't accepted — so it wears the full weight.
    @ViewBuilder
    private var settingsButton: some View {
        #if os(macOS)
        SettingsLink { Text("Open Settings") }
            .buttonStyle(PlaceholderActionStyle())
        #else
        Button("Open Settings") { showSettings = true }
            .buttonStyle(PlaceholderActionStyle())
        #endif
    }

    private func retryLoad() {
        guard !isRetrying else { return }
        isRetrying = true
        Task {
            await viewModel.refresh()
            isRetrying = false
        }
    }
}

private extension Session.PullRequestContextState {
    var suggestsArchive: Bool {
        switch self {
        case .merged, .closed: true
        default: false
        }
    }
}

private struct ArchivedSessionsView: View {
    let sessions: [Session]
    /// Whether the archived index has arrived. Archived rows travel on their
    /// own request, so this screen has a wait of its own now — and "Nothing
    /// archived" would be a claim about a list that hasn't answered yet.
    let loaded: Bool
    let onOpen: (Session) -> Void
    let onRestore: (Session) -> Void
    let loadFailure: String?
    let onRetry: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""
    @State private var owner = "mine"
    @State private var repo = "all"
    @State private var reason = "all"

    private var repositories: [String] {
        Array(Set(sessions.map(\.effectiveRepo))).sorted()
    }

    private var hasAutoArchived: Bool {
        sessions.contains(where: isAutoArchived)
    }

    private var activeFilterCount: Int {
        (owner == "mine" ? 1 : 0) + (repo == "all" ? 0 : 1) + (reason == "all" ? 0 : 1)
    }

    private var filteredSessions: [Session] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let lens = PeopleLens.current()
        return sessions.filter { session in
            if owner == "mine", !lens.isMine(session) { return false }
            if repo != "all", session.effectiveRepo != repo { return false }
            if reason == "auto", !isAutoArchived(session) { return false }
            if reason == "manual", isAutoArchived(session) { return false }
            guard !query.isEmpty else { return true }
            let terms = [session.displayTitle, session.effectiveRepo]
                + [session.branch, session.startedBy].compactMap { $0 }
            return terms
                .map { $0.lowercased() }
                .contains { $0.contains(query) }
        }
    }

    private func isAutoArchived(_ session: Session) -> Bool {
        guard let archivedReason = session.archivedReason else { return false }
        return archivedReason != "manual"
    }

    private func metadata(for session: Session) -> String {
        var parts = [RepoTile.label(for: session.effectiveRepo)]
        if owner == "everyone", let startedBy = session.startedBy { parts.append(startedBy) }
        if reason == "all", isAutoArchived(session) { parts.append("Auto-archived") }
        if let date = session.lastActivityDate {
            parts.append(date.formatted(.relative(presentation: .named)))
        }
        return parts.joined(separator: " · ")
    }

    var body: some View {
        NavigationStack {
            List {
                if let loadFailure {
                    ContentUnavailableView {
                        Label("Couldn't load archived sessions", systemImage: "exclamationmark.triangle")
                    } description: {
                        Text(loadFailure)
                    } actions: {
                        Button("Try again", action: onRetry)
                    }
                    .listRowSeparator(.hidden)
                } else if sessions.isEmpty, !loaded {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Loading archived sessions…")
                            .font(.footnote)
                            .foregroundStyle(OS1VisualStyle.textDim)
                    }
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 24)
                    .listRowSeparator(.hidden)
                } else if filteredSessions.isEmpty {
                    ContentUnavailableView(
                        sessions.isEmpty ? "Nothing archived" : "No matches",
                        systemImage: sessions.isEmpty ? "archivebox" : "magnifyingglass"
                    )
                } else {
                    Section {
                        ForEach(filteredSessions) { session in
                            HStack(spacing: 10) {
                                RepoTile(name: session.effectiveRepo, size: 24)
                                #if os(iOS)
                                Button {
                                    onOpen(session)
                                } label: {
                                    archivedRowLabel(session)
                                }
                                .buttonStyle(.plain)
                                #else
                                archivedRowLabel(session)
                                #endif
                                Button {
                                    onRestore(session)
                                } label: {
                                    WebIcon(kind: .unarchive, size: 18)
                                        .frame(width: 44, height: 44)
                                }
                                .buttonStyle(.borderless)
                                .accessibilityLabel("Restore session")
                            }
                            .padding(.vertical, 2)
                        }
                    } header: {
                        Text(filteredSessions.count == sessions.count
                             ? "\(sessions.count) archived"
                             : "\(filteredSessions.count) of \(sessions.count) archived")
                    }
                }
            }
            #if os(iOS)
            .scrollContentBackground(.hidden)
            .background(OS1VisualStyle.background)
            #endif
            .searchable(text: $searchText, prompt: "Search archived")
            .navigationTitle("Archived")
            .inlineTitleBarCompat()
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Section("Owner") {
                            Picker("Owner", selection: $owner) {
                                Text("My archived").tag("mine")
                                Text("Everyone").tag("everyone")
                            }
                        }
                        if repositories.count > 1 {
                            Section("Repository") {
                                Picker("Repository", selection: $repo) {
                                    Text("All repos").tag("all")
                                    ForEach(repositories, id: \.self) { repository in
                                        Text(RepoTile.label(for: repository)).tag(repository)
                                    }
                                }
                            }
                        }
                        if hasAutoArchived {
                            Section("Reason") {
                                Picker("Reason", selection: $reason) {
                                    Text("All").tag("all")
                                    Text("Auto-archived").tag("auto")
                                    Text("Manual").tag("manual")
                                }
                            }
                        }
                        if activeFilterCount > 0 {
                            Button("Clear filters") {
                                owner = "everyone"
                                repo = "all"
                                reason = "all"
                            }
                        }
                    } label: {
                        Label(
                            activeFilterCount > 0 ? "Filters (\(activeFilterCount))" : "Filters",
                            systemImage: activeFilterCount > 0
                                ? "line.3.horizontal.decrease.circle.fill"
                                : "line.3.horizontal.decrease.circle"
                        )
                    }
                    .accessibilityLabel("Filters, \(activeFilterCount) active")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }

    private func archivedRowLabel(_ session: Session) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(session.displayTitle)
                .font(.body.weight(.medium))
                .foregroundStyle(OS1VisualStyle.text)
                .lineLimit(2)
            Text(metadata(for: session))
                .font(.footnote)
                .foregroundStyle(OS1VisualStyle.textDim)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension Session.Lane {
    /// Dot colors matching the web sidebar's lane dots.
    var color: Color {
        switch self {
        case .needsInput: OS1VisualStyle.blue
        case .inProgress: OS1VisualStyle.yellow
        case .inReview: OS1VisualStyle.green
        case .done: OS1VisualStyle.purple
        case .backlog: OS1VisualStyle.textFaint.opacity(0.7)
        }
    }
}

#if os(iOS)
/// The first load, shaped like what it is loading: a band heading and a run of
/// rows at the list's own metrics, so the screen the data lands in is already
/// standing when it arrives. A centred spinner says only "wait"; this says
/// where.
private struct SessionsSkeleton: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dim = false

    /// Ragged on purpose — a column of equal bars reads as a component, not as
    /// titles about to arrive.
    private let widths: [CGFloat] = [188, 132, 214, 160, 108, 196, 144, 176]

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Capsule()
                .fill(OS1VisualStyle.hover)
                .frame(width: 84, height: 11)
                .padding(.vertical, 9)
            ForEach(Array(widths.enumerated()), id: \.offset) { _, width in
                HStack(spacing: 9) {
                    Circle()
                        .fill(OS1VisualStyle.hover)
                        .frame(width: 7, height: 7)
                        .frame(width: 22, height: 22)
                    Capsule()
                        .fill(OS1VisualStyle.hover)
                        .frame(width: width, height: 13)
                }
                .padding(.vertical, 13)
            }
        }
        .padding(.horizontal, sidebarMargin)
        .padding(.top, 6)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        // One breath across the whole block, not a travelling sheen: the rows
        // are the message, and a shimmer would draw the eye along them.
        .opacity(dim ? 0.5 : 1)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) {
                dim = true
            }
        }
        .accessibilityElement()
        .accessibilityLabel("Loading sessions")
    }
}
#endif

struct SessionRow: View {
    let session: Session
    var title: String? = nil
    /// Every session the row stands for. Unread emphasis is per ROW, like the web
    /// sidebar's `.sidebar-item-unread`: one session with activity past your read
    /// mark bolds the whole workspace. Empty falls back to `session` alone.
    var sessions: [Session] = []
    /// Set in Inbox mode, where the flat list has no repo band above the row:
    /// the row wears its repo's tile in front of the title. The tile can carry
    /// that on its own now that a repo without an icon gets a color of its own
    /// rather than its org's mark — spelling the name out instead cost either
    /// the title's width or a second line, and both read worse than a swatch.
    var repo: String? = nil
    /// iOS: the session you last had open. A neutral plate rather than a hue —
    /// every colour on this list already means something (the status marks and
    /// repo tiles), and "where you were" is chrome, not status. `tertiary`
    /// rather than the `hover` fill: it has to be legible at a glance while
    /// scrolling past, which the faintest step is not.
    var highlighted: Bool = false
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    /// Settings → Appearance → Show last used time. Off by default, like the
    /// web's resting sidebar, and per device like the web's own copy of it.
    @AppStorage("os1.list.lastUsed") private var lastUsedPref = "off"
    /// Mac: hover-revealed archive button (nil hides it).
    var onArchive: (() -> Void)? = nil

    #if os(macOS)
    @State private var hovering = false
    #endif

    var body: some View {
        #if os(macOS)
        content
            .overlay(alignment: .trailing) {
                if hovering, let onArchive {
                    Button(action: onArchive) {
                        WebIcon(kind: .archive, size: 20, color: .secondary)
                    }
                    .buttonStyle(.borderless)
                    .help("Archive")
                    // Keep the action legible over a long title.
                    .padding(4)
                    .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 5))
                }
            }
            // onHover must wrap the overlay, not sit under it: with the button
            // on top of the hover target, reaching it ended the content's
            // hover, which unmounted the button under the cursor (flicker).
            .onHover { hovering = $0 }
        #else
        content
        #endif
    }

    /// Mac sidebar rows are compact and body-sized like Finder/System
    /// Settings; iOS keeps the roomier touch metrics.
    private var content: some View {
        HStack(spacing: 9) {
            statusMark
                .frame(width: markSize, height: markSize)
            if let repo {
                RepoTile(name: repo, size: tileSize)
            }
            Text(rowTitle)
                #if os(iOS)
                // The web sidebar's phone type, exactly: 16px titles (callout)
                // in medium, dimmed — and, when the row has activity you
                // haven't read, semibold at full strength. Same Slack-style
                // pair as `.sidebar-item-title` / `.sidebar-item-unread`.
                .font(.callout.weight(unread ? .semibold : .medium))
                .foregroundStyle(unread ? OS1VisualStyle.text : OS1VisualStyle.textDim)
                #else
                .font(.body.weight(unread ? .semibold : .regular))
                .foregroundStyle(.primary)
                #endif
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            if hasDraft {
                Image(systemName: "pencil")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(OS1VisualStyle.textDim)
                    .accessibilityLabel("Unsent draft")
            }
            // Teammates focused on any session represented by this row.
            if !rowViewers.isEmpty {
                PresenceFacepile(viewers: rowViewers, size: faceSize, stacked: false)
            }
            if showsClock {
                WorkspaceRunElapsedLabel(since: session.runStartedDate)
                    // No trailing pad: the repo header's "+" now hangs its tap
                    // target past the row margin so its INK sits on 16pt, and
                    // this clock's digits end on that same column on their own.
            } else if let idleAgo {
                // The same trailing slot the clock owns, so a row never shifts
                // when a run starts — it swaps grey for the running yellow.
                Text(idleAgo)
                    #if os(iOS)
                    .font(.caption.weight(.medium).monospacedDigit())
                    #else
                    .font(.caption.monospacedDigit())
                    #endif
                    .foregroundStyle(OS1VisualStyle.textFaint)
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
        #if os(iOS)
        // 13, not 11: the list no longer imposes a 44pt minimum row height,
        // so the row's own padding is what keeps its touch target.
        .padding(.vertical, 13)
        // Bleeds into the list's own 16pt margin so the plate reads as the
        // row rather than as a box drawn around its contents.
        .padding(.horizontal, 10)
        .background {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(uiColor: .tertiarySystemFill).opacity(highlighted ? 1 : 0))
        }
        .padding(.horizontal, -10)
        .animation(.easeOut(duration: 0.2), value: highlighted)
        #else
        .padding(.vertical, 3)
        #endif
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(rowTitle)
        .accessibilityValue(accessibilityStatus)
        #if os(macOS)
        .help(rowTitle)
        #endif
    }

    /// Read here rather than at the call site on purpose: `ReadsStore` is
    /// `@Observable`, so a mark landing invalidates the rows that read it
    /// instead of the whole list body.
    private var unread: Bool {
        ReadsStore.shared.isUnread(sessions.isEmpty ? [session] : sessions)
    }

    private var hasDraft: Bool {
        DraftsStore.shared.hasDraft(sessions.isEmpty ? [session] : sessions)
    }

    /// Read here rather than at the call site because `PresenceStore` is
    /// `@Observable`: a global-presence frame invalidates only rows using it.
    private var rowViewers: [String] {
        PresenceStore.shared.viewers(of: sessions.isEmpty ? [session] : sessions)
    }

    private var markSize: CGFloat {
        #if os(iOS)
        22
        #else
        14
        #endif
    }

    /// A step under the repo tile: a face on a row is "who else is here", not
    /// something to read the row by.
    private var faceSize: CGFloat {
        #if os(iOS)
        20
        #else
        15
        #endif
    }

    /// The repo tile sits a step under the status mark beside it, so it reads
    /// as the row's label rather than a second status.
    private var tileSize: CGFloat {
        #if os(iOS)
        18
        #else
        13
        #endif
    }

    private var showsClock: Bool {
        session.lane == .inProgress && showsElapsedTime
    }

    /// How long ago this row last did anything, when the setting asks for it.
    ///
    /// Deliberately no `TimelineView`: the run clock ticks because seconds are
    /// what it counts, but "3h" changes hourly — the list's own 5s poll
    /// re-renders often enough, and a ticker on every idle row would be pure
    /// waste. Integer math on a date the row has already parsed, so no
    /// formatter is allocated here either.
    private var idleAgo: String? {
        guard lastUsedPref == "always", showsElapsedTime else { return nil }
        let rows = sessions.isEmpty ? [session] : sessions
        guard let latest = rows.compactMap(\.lastActivityDate).max() else { return nil }
        return Self.compactAgo(Date().timeIntervalSince(latest))
    }

    static func compactAgo(_ elapsed: TimeInterval) -> String {
        let total = max(0, Int(elapsed))
        if total < 60 { return "now" }
        if total < 3_600 { return "\(total / 60)m" }
        if total < 86_400 { return "\(total / 3_600)h" }
        if total < 604_800 { return "\(total / 86_400)d" }
        return "\(total / 604_800)w"
    }

    private var rowTitle: String {
        (title ?? session.displayTitle).replacingOccurrences(
            of: #"^PR\s*#\d+(:|\s*[—–-])\s*"#,
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
    }

    private var showsElapsedTime: Bool {
        #if os(iOS)
        !dynamicTypeSize.isAccessibilitySize
        #else
        true
        #endif
    }

    @ViewBuilder
    private var statusMark: some View {
        if session.lane == .needsInput {
            PulsingDot(color: OS1VisualStyle.blue, active: animatesStatus)
        } else if session.lane == .inProgress {
            PulsingDot(color: OS1VisualStyle.yellow, active: animatesStatus)
        } else if session.prState == "MERGED" {
            WebIcon(kind: .gitMerge, size: markSize, color: OS1VisualStyle.purple)
        } else if session.prState == "OPEN" {
            WebIcon(kind: .pullRequest, size: markSize, color: OS1VisualStyle.green)
        } else if session.prState == "CLOSED" {
            WebIcon(kind: .pullRequest, size: markSize, color: OS1VisualStyle.red)
        } else {
            PulsingDot(color: OS1VisualStyle.textFaint, active: false)
        }
    }

    private var animatesStatus: Bool {
        #if os(iOS)
        true
        #else
        false
        #endif
    }

    private var accessibilityStatus: String {
        var parts = [session.lane.label, RepoTile.label(for: session.effectiveRepo)]
        // The bold title is the only sighted cue for unread; say it out loud.
        if unread { parts.insert("unread", at: 0) }
        // Same for the plate: colour alone never carries meaning.
        if highlighted { parts.insert("last opened", at: 0) }
        if let prState = session.prState?.lowercased() {
            parts.append("pull request \(prState)")
        }
        // The faces are the only cue that someone else is viewing this row.
        if !rowViewers.isEmpty {
            parts.append(
                "\(ListFormatter.localizedString(byJoining: rowViewers)) viewing"
            )
        }
        if let idleAgo { parts.append("last used \(idleAgo)") }
        return parts.joined(separator: ", ")
    }
}

/// Web workspace rows reserve their trailing slot for a live run clock. An
/// idle row leaves that slot empty unless Appearance → Show last used time
/// asks for it, which is the web's default too.
private struct WorkspaceRunElapsedLabel: View {
    let since: Date?

    var body: some View {
        Group {
            if let since {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(label(context.date.timeIntervalSince(since)))
                }
            } else {
                Text("Running")
            }
        }
        #if os(iOS)
        // 12px, like the web's `.sidebar-ws-ticker` on a phone.
        .font(.caption.weight(.medium).monospacedDigit())
        #else
        .font(.caption.monospacedDigit())
        #endif
        .foregroundStyle(OS1VisualStyle.yellow)
        .fixedSize(horizontal: true, vertical: false)
    }

    private func label(_ elapsed: TimeInterval) -> String {
        let total = max(0, Int(elapsed))
        if total < 60 { return "\(total)s" }
        if total < 3_600 { return "\(total / 60)m \(total % 60)s" }
        return "\(total / 3_600)h \((total % 3_600) / 60)m"
    }
}

/// Status dot that softly pulses while `active` — mirrors the web's
/// `.pulse-dot` (1.4s opacity cycle).
struct PulsingDot: View {
    let color: Color
    var active: Bool = true
    var size: CGFloat = 8
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let dot = Circle()
            .fill(color)
            .frame(width: size, height: size)
        if active && !reduceMotion {
            dot.phaseAnimator([1.0, 0.35]) { view, opacity in
                view.opacity(opacity)
            } animation: { _ in
                .easeInOut(duration: 0.7)
            }
        } else {
            dot
        }
    }
}
