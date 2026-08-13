import SwiftUI

#if os(iOS)
/// The services this session exposes, one level deeper than the conversation.
///
/// View-only on purpose. The web panel also starts services from a recipe and
/// stops or restarts the supervised ones; those are administration, and they
/// belong where a person can watch what they did. What a phone is for is the
/// other half: seeing that the dev server came up, and looking at it.
///
/// A live row opens in the browser sheet over the session, the same as a link
/// in the transcript. Rows with nothing behind them say so and do nothing:
/// reading this list must never wake a sleeping sandbox, and the server keeps
/// that promise by answering one from a cached snapshot with no URLs in it.
struct PortalsListView: View {
    let sessionId: String

    @State private var status: PortalStatus?
    @State private var loading = true
    @State private var loadFailed = false
    /// The portal being looked at, over this list.
    @State private var openPortal: SafariLink?

    private var services: [PortalService] { status?.services ?? [] }

    var body: some View {
        Group {
            if loading && status == nil {
                ProgressView()
                    .controlSize(.large)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if loadFailed && status == nil {
                failedPlaceholder
            } else if services.isEmpty {
                emptyPlaceholder
            } else {
                portalList
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(OS1VisualStyle.background)
        .navigationTitle("Portals")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await load() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
            }
        }
        .sheet(item: $openPortal) { link in
            SafariSheet(url: link.url)
        }
        .task(id: sessionId) { await load() }
    }

    // MARK: - The list

    private var portalList: some View {
        List {
            Section {
                ForEach(services) { service in
                    if let url = service.openURL {
                        Button {
                            openPortal = SafariLink(url: url)
                        } label: {
                            PortalRow(service: service, opens: true)
                        }
                        .buttonStyle(.plain)
                    } else {
                        PortalRow(service: service, opens: false)
                    }
                }
            } header: {
                Text(liveHeading)
            } footer: {
                Text(footerText)
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(OS1VisualStyle.background)
        .refreshable { await load() }
    }

    private var liveHeading: String {
        let live = status?.liveCount ?? 0
        return live == 1 ? "1 live portal" : "\(live) live portals"
    }

    private var footerText: String {
        let base = "Services this session exposes. Tap a live one to open it."
        guard services.contains(where: { $0.display == .sleeping }) else { return base }
        return base + " A sleeping sandbox stays asleep: its portals come back "
            + "when the session next runs."
    }

    // MARK: - Placeholders

    private var emptyPlaceholder: some View {
        ListPlaceholder(
            symbol: "globe",
            title: status?.starting == true ? "Starting services…" : "No portals",
            message: status?.starting == true
                ? "They appear here as soon as their ports are ready."
                : "A dev server, a docs site, a dashboard: whatever this "
                    + "session puts on a port shows up here."
        ) {
            EmptyView()
        }
    }

    private var failedPlaceholder: some View {
        ListPlaceholder(
            symbol: "exclamationmark.triangle",
            title: "Couldn't load portals",
            message: "The server didn't answer for this session's services."
        ) {
            Button("Try again") { Task { await load() } }
                .buttonStyle(PlaceholderActionStyle())
        }
    }

    // MARK: - Loading

    private func load() async {
        loading = true
        loadFailed = false
        let loaded = try? await OS1API.portals(sessionId: sessionId)
        guard !Task.isCancelled else { return }
        if let loaded { status = loaded } else { loadFailed = true }
        loading = false
    }
}

/// One service: where it is, what it is, and whether tapping it does anything.
private struct PortalRow: View {
    let service: PortalService
    /// Whether this row opens the portal. A row that doesn't gets no chevron,
    /// because a chevron is a promise that something happens.
    let opens: Bool

    var body: some View {
        HStack(spacing: 11) {
            Circle()
                .fill(dotColor)
                .frame(width: 8, height: 8)
                .frame(width: 22)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(service.name)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(OS1VisualStyle.text)
                    .lineLimit(1)
                Text(subtitle)
                    .font(.caption)
                    .foregroundStyle(OS1VisualStyle.textDim)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if opens {
                Image(systemName: "chevron.right")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(OS1VisualStyle.textFaint)
            }
        }
        .padding(.vertical, 3)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(service.name), \(service.display.label)")
    }

    /// State first, then what the service is. The web panel has the width to
    /// put its description first; a phone row does not, and a repository's
    /// one-line description will happily eat the whole line. The state is
    /// what this row exists to say, so it goes where nothing can truncate it.
    private var subtitle: String {
        let what = service.description ?? "Port \(service.port)"
        return "\(service.display.label) · \(what)"
    }

    private var dotColor: Color {
        switch service.display {
        case .live: OS1VisualStyle.green
        case .starting, .waking: Color.orange
        case .failed: OS1VisualStyle.red
        case .sleeping, .stopped, .unavailable: OS1VisualStyle.textFaint
        }
    }
}
#endif
