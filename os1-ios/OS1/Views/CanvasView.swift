import SwiftUI

/// Sessions as movable cards in the shared Canvas room. The web renders the
/// same records with tldraw; native keeps the spatial collaboration but uses
/// platform gestures and controls instead of embedding that web editor.
struct SessionCanvasView: View {
    let sessions: [Session]
    let onOpenSession: (Session) -> Void

    @State private var sync = CanvasSyncClient()

    var body: some View {
        CanvasBoard(
            cards: visibleCards,
            sessions: Dictionary(uniqueKeysWithValues: sessions.map { ($0.id, $0) }),
            collaborators: sync.collaborators,
            connection: sync.state,
            onMove: sync.move,
            onSelect: sync.select,
            onOpen: { card in
                guard let session = sessions.first(where: { $0.id == card.sessionId }) else {
                    return
                }
                onOpenSession(session)
            },
            onArrange: sync.arrangeByActivity
        )
        .navigationTitle("Canvas")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task { sync.start(sessions: sessions) }
        .onChange(of: sessions) { _, next in sync.update(sessions: next) }
        .onChange(of: LaneStore.shared.claims) { sync.update(sessions: sessions) }
        .onDisappear { sync.stop() }
    }

    private var visibleCards: [CanvasCardRecord] {
        let ids = Set(sessions.map(\.id))
        return sync.cards.filter { ids.contains($0.sessionId) }
    }
}

private struct CanvasBoard: View {
    let cards: [CanvasCardRecord]
    let sessions: [String: Session]
    let collaborators: [String]
    let connection: CanvasConnectionState
    let onMove: (CanvasCardRecord, CGSize) -> Void
    let onSelect: (CanvasCardRecord?) -> Void
    let onOpen: (CanvasCardRecord) -> Void
    let onArrange: () -> Void

    @State private var center = CGPoint.zero
    @State private var zoom: CGFloat = 0.72
    @State private var selectedCardId: String?
    @State private var fitted = false
    @GestureState private var panTranslation = CGSize.zero
    @GestureState private var magnification: CGFloat = 1

    var body: some View {
        GeometryReader { geometry in
            let effectiveZoom = min(max(zoom * magnification, 0.18), 1.6)
            ZStack(alignment: .topLeading) {
                background(zoom: effectiveZoom)

                ForEach(visibleCards(in: geometry.size, zoom: effectiveZoom)) { card in
                    PositionedCanvasCard(
                        card: card,
                        session: session(for: card),
                        viewers: viewers(for: card),
                        zoom: effectiveZoom,
                        center: center,
                        viewport: geometry.size,
                        panTranslation: panTranslation,
                        selected: selectedCardId == card.id,
                        compact: effectiveZoom < 0.42,
                        onMove: { translation in onMove(card, translation) },
                        onSelect: {
                            selectedCardId = card.id
                            onSelect(card)
                        },
                        onOpen: { onOpen(card) }
                    )
                }

                chrome(size: geometry.size)
            }
            .clipped()
            .simultaneousGesture(
                MagnifyGesture()
                    .updating($magnification) { value, state, _ in state = value.magnification }
                    .onEnded { value in
                        zoom = min(max(zoom * value.magnification, 0.18), 1.6)
                    }
            )
            .onAppear { fitLeadingCards(in: geometry.size) }
            .onChange(of: cards.map(\.id)) {
                if !fitted { fitLeadingCards(in: geometry.size) }
            }
        }
        .background(OS1VisualStyle.chatCanvas)
    }

    private func background(zoom: Double) -> some View {
        CanvasDotField(zoom: zoom)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 2)
                    .updating($panTranslation) { value, state, _ in state = value.translation }
                    .onEnded { value in
                        center.x -= value.translation.width / zoom
                        center.y -= value.translation.height / zoom
                        selectedCardId = nil
                        onSelect(nil)
                    }
            )
    }

    @ViewBuilder
    private func chrome(size: CGSize) -> some View {
        if !collaborators.isEmpty {
            PresenceFacepile(viewers: collaborators, size: 26)
                .padding(12)
                .background(.regularMaterial, in: Capsule())
                .padding(12)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
        }

        if case .offline(let message) = connection {
            Label(message, systemImage: "wifi.exclamationmark")
                .font(.footnote.weight(.medium))
                .foregroundStyle(OS1VisualStyle.textDim)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(.regularMaterial, in: Capsule())
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .top)
        } else if connection == .incompatible {
            Label("Canvas needs an app update", systemImage: "exclamationmark.triangle")
                .font(.footnote.weight(.medium))
                .foregroundStyle(OS1VisualStyle.textDim)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(.regularMaterial, in: Capsule())
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .top)
        }

        HStack(spacing: 6) {
            Button { zoom = max(0.18, zoom / 1.25) } label: {
                Image(systemName: "minus")
            }
            .accessibilityLabel("Zoom out")
            Button { zoom = min(1.6, zoom * 1.25) } label: {
                Image(systemName: "plus")
            }
            .accessibilityLabel("Zoom in")
            Button("Fit") { fitAll(in: size) }
            Button("Sort") {
                onArrange()
            }
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
        .padding(10)
        .background(.regularMaterial, in: Capsule())
        .padding(12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomLeading)
    }

    private var orderedCards: [CanvasCardRecord] {
        cards.sorted {
            if $0.id == selectedCardId { return false }
            if $1.id == selectedCardId { return true }
            return $0.index < $1.index
        }
    }

    private func visibleCards(in size: CGSize, zoom: CGFloat) -> [CanvasCardRecord] {
        let margin: CGFloat = 120
        return orderedCards.filter { card in
            let x = (card.x - center.x) * zoom + size.width / 2 + panTranslation.width
            let y = (card.y - center.y) * zoom + size.height / 2 + panTranslation.height
            return x + card.width * zoom >= -margin
                && y + card.height * zoom >= -margin
                && x <= size.width + margin
                && y <= size.height + margin
        }
    }

    private func session(for card: CanvasCardRecord) -> Session? {
        sessions[card.sessionId]
    }

    private func viewers(for card: CanvasCardRecord) -> [String] {
        guard let session = session(for: card) else { return [] }
        return PresenceStore.shared.viewers(of: [session])
    }

    private func fitLeadingCards(in size: CGSize) {
        guard !cards.isEmpty, size.width > 0, size.height > 0 else { return }
        fitted = true
        fit(Array(cards.prefix(size.width > 700 ? 4 : 2)), in: size, maximumZoom: 0.9)
    }

    private func fitAll(in size: CGSize) {
        fit(cards, in: size, maximumZoom: 1)
    }

    private func fit(_ cards: [CanvasCardRecord], in size: CGSize, maximumZoom: CGFloat) {
        guard let bounds = CanvasBounds(cards: cards) else { return }
        let availableWidth = max(size.width - 48, 1)
        let availableHeight = max(size.height - 96, 1)
        zoom = min(maximumZoom, max(0.18, min(
            availableWidth / bounds.width,
            availableHeight / bounds.height
        )))
        center = bounds.center
    }
}

/// A quiet spatial cue that moves with the camera but never competes with the
/// cards. Canvas rather than an image keeps it crisp at every native scale.
private struct CanvasDotField: View {
    let zoom: Double

    var body: some View {
        Canvas { context, size in
            let spacing = max(18, 36 * zoom)
            var path = Path()
            var y = spacing / 2
            while y < size.height {
                var x = spacing / 2
                while x < size.width {
                    path.addEllipse(in: CGRect(x: x, y: y, width: 1.5, height: 1.5))
                    x += spacing
                }
                y += spacing
            }
            context.fill(path, with: .color(OS1VisualStyle.textFaint.opacity(0.2)))
        }
    }
}

private struct PositionedCanvasCard: View {
    let card: CanvasCardRecord
    let session: Session?
    let viewers: [String]
    let zoom: Double
    let center: CGPoint
    let viewport: CGSize
    let panTranslation: CGSize
    let selected: Bool
    let compact: Bool
    let onMove: (CGSize) -> Void
    let onSelect: () -> Void
    let onOpen: () -> Void

    @GestureState private var dragTranslation = CGSize.zero

    var body: some View {
        CanvasSessionCard(
            session: session,
            viewers: viewers,
            selected: selected,
            compact: compact,
            onOpen: onOpen
        )
        .frame(width: card.width, height: card.height)
        .scaleEffect(zoom, anchor: .topLeading)
        .offset(
            x: (card.x - center.x) * zoom + viewport.width / 2
                + panTranslation.width + dragTranslation.width,
            y: (card.y - center.y) * zoom + viewport.height / 2
                + panTranslation.height + dragTranslation.height
        )
        .gesture(
            DragGesture(minimumDistance: 6)
                .updating($dragTranslation) { value, state, _ in state = value.translation }
                .onChanged { _ in onSelect() }
                .onEnded { value in
                    onMove(CGSize(
                        width: value.translation.width / zoom,
                        height: value.translation.height / zoom
                    ))
                }
        )
        .onTapGesture { onSelect() }
    }
}

private struct CanvasSessionCard: View {
    let session: Session?
    let viewers: [String]
    let selected: Bool
    let compact: Bool
    let onOpen: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider().opacity(0.45)
            if compact {
                stateSummary
                    .padding(22)
                Spacer(minLength: 0)
            } else {
                VStack(alignment: .leading, spacing: 18) {
                    stateSummary
                    Spacer(minLength: 8)
                    metadata
                    Button("Open session", action: onOpen)
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                }
                .padding(22)
            }
        }
        .background(OS1VisualStyle.background)
        .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
        .shadow(
            color: .black.opacity(selected ? 0.2 : 0.1),
            radius: selected ? 22 : 14,
            y: selected ? 10 : 7
        )
        .overlay {
            if selected {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(OS1VisualStyle.accent.opacity(0.65), lineWidth: 2)
            }
        }
        .animation(.smooth(duration: 0.22), value: selected)
        .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private var header: some View {
        HStack(spacing: 12) {
            RepoTile(name: session?.effectiveRepo ?? "opensession", size: 34)
            VStack(alignment: .leading, spacing: 3) {
                Text(session?.displayTitle ?? "Session unavailable")
                    .font(.headline)
                    .foregroundStyle(OS1VisualStyle.text)
                    .lineLimit(2)
                Text(session?.effectiveRepo ?? "No longer in the session list")
                    .font(.caption)
                    .foregroundStyle(OS1VisualStyle.textFaint)
                    .lineLimit(1)
            }
            Spacer(minLength: 8)
            if !viewers.isEmpty {
                PresenceFacepile(viewers: viewers, size: 24)
            }
            Image(systemName: "arrow.up.and.down.and.arrow.left.and.right")
                .font(.callout)
                .foregroundStyle(OS1VisualStyle.textFaint)
                .frame(width: 30, height: 30)
                .accessibilityHidden(true)
        }
        .padding(18)
    }

    @ViewBuilder
    private var stateSummary: some View {
        if let session {
            HStack(spacing: 12) {
                Image(systemName: stateSymbol(session))
                    .font(.system(size: 26, weight: .medium))
                    .foregroundStyle(stateColor(session))
                    .frame(width: 36, height: 36)
                VStack(alignment: .leading, spacing: 3) {
                    Text(stateTitle(session))
                        .font(.title3.weight(.semibold))
                    Text(stateDetail(session))
                        .font(.callout)
                        .foregroundStyle(OS1VisualStyle.textDim)
                        .lineLimit(2)
                }
            }
        } else {
            Label("This session is no longer available", systemImage: "questionmark.folder")
                .foregroundStyle(OS1VisualStyle.textDim)
        }
    }

    @ViewBuilder
    private var metadata: some View {
        if let session {
            VStack(alignment: .leading, spacing: 9) {
                if let branch = session.branch, !branch.isEmpty {
                    Label(branch, systemImage: "arrow.triangle.branch")
                }
                if let person = session.createdBy ?? session.startedBy, !person.isEmpty {
                    HStack(spacing: 7) {
                        UserAvatar(person: person, size: 22)
                        Text(person)
                    }
                }
                if let date = session.lastActivityDate {
                    Label(date.formatted(.relative(presentation: .named)), systemImage: "clock")
                }
            }
            .font(.callout)
            .foregroundStyle(OS1VisualStyle.textDim)
            .lineLimit(1)
        }
    }

    private func stateTitle(_ session: Session) -> String {
        if session.waitingForInput == true { return "Needs your input" }
        if session.isRunning == true { return "Working" }
        if session.prState == "OPEN" { return "In review" }
        if session.prState == "MERGED" { return "Merged" }
        return "Ready"
    }

    private func stateDetail(_ session: Session) -> String {
        if session.waitingForInput == true { return "The agent is waiting on a decision." }
        if session.isRunning == true { return "The current turn is still in progress." }
        if session.prState == "OPEN" { return "A pull request is open for review." }
        if session.prState == "MERGED" { return "The pull request has landed." }
        return "Open the conversation or move the card to arrange the board."
    }

    private func stateSymbol(_ session: Session) -> String {
        if session.waitingForInput == true { return "questionmark.circle.fill" }
        if session.isRunning == true { return "circle.dotted" }
        if session.prState == "OPEN" { return "arrow.trianglehead.pull" }
        if session.prState == "MERGED" { return "checkmark.circle.fill" }
        return "bubble.left.and.bubble.right"
    }

    private func stateColor(_ session: Session) -> Color {
        if session.waitingForInput == true { return OS1VisualStyle.accent }
        if session.prState == "MERGED" { return OS1VisualStyle.greenInk }
        return OS1VisualStyle.textDim
    }
}

private struct CanvasBounds {
    let minX: CGFloat
    let minY: CGFloat
    let maxX: CGFloat
    let maxY: CGFloat

    init?(cards: [CanvasCardRecord]) {
        guard let first = cards.first else { return nil }
        minX = cards.dropFirst().reduce(first.x) { min($0, $1.x) }
        minY = cards.dropFirst().reduce(first.y) { min($0, $1.y) }
        maxX = cards.dropFirst().reduce(first.x + first.width) { max($0, $1.x + $1.width) }
        maxY = cards.dropFirst().reduce(first.y + first.height) { max($0, $1.y + $1.height) }
    }

    var width: Double { max(maxX - minX, 1) }
    var height: Double { max(maxY - minY, 1) }
    var center: CGPoint { CGPoint(x: (minX + maxX) / 2, y: (minY + maxY) / 2) }
}
