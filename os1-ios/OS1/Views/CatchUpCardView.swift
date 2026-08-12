import SwiftUI

/// One card in the catch-up deck.
///
/// The workspace's main chat in a vertically scrolling card. Decisions swipe
/// horizontally, so reading never advances the deck by accident.
///
/// Only the top card draws its content. The ones behind are a title and a few
/// grey lines: nobody can read them, and rendering markdown three times over
/// for a stack that is about to move is exactly the kind of work that makes a
/// gesture stutter.
struct CatchUpCardView: View {
    let card: CatchUpCard
    let conversation: CatchUpViewModel.Conversation?
    let isTop: Bool
    let onOpen: () -> Void
    let onReply: (String) -> Void

    @State private var folds = FoldStateStore()
    @State private var reply = ""

    private let shape = RoundedRectangle(cornerRadius: 26, style: .continuous)

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            headerRow
            if isTop {
                Divider().overlay(OS1VisualStyle.border.opacity(0.6))
                bodyColumn
                footerRow
            } else {
                placeholderColumn
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(OS1VisualStyle.background)
        .clipShape(shape)
        .overlay(shape.strokeBorder(OS1VisualStyle.border.opacity(0.5), lineWidth: 0.5))
        // A card in hand casts more shadow than the ones under it, which is
        // most of what says which one you are holding.
        .shadow(
            color: .black.opacity(isTop ? 0.18 : 0.08),
            radius: isTop ? 26 : 12,
            y: isTop ? 14 : 6
        )
    }

    // MARK: - Header

    private var headerRow: some View {
        VStack(spacing: 5) {
            ZStack {
                HStack {
                    RepoTile(name: card.repo, size: 28)
                    Spacer()
                    Button(action: onOpen) {
                        Image(systemName: "arrow.up.forward")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(OS1VisualStyle.textDim)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open main chat")
                }
                HStack(spacing: 5) {
                    Text("#").foregroundStyle(OS1VisualStyle.textDim)
                    Text(card.title).lineLimit(1)
                }
                .font(.headline.weight(.semibold))
                .foregroundStyle(OS1VisualStyle.text)
                .padding(.horizontal, 52)
            }
            if isTop {
                metaRow
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 10)
        .padding(.bottom, 11)
    }

    private var metaRow: some View {
        HStack(spacing: 6) {
            if card.isRunning {
                PulsingDot(color: OS1VisualStyle.yellow, size: 7)
                runningLabel
            } else {
                Circle()
                    .fill(laneColor)
                    .frame(width: 7, height: 7)
                Text(card.lane.label)
                    .font(.caption.weight(.medium))
                    .foregroundStyle(OS1VisualStyle.textDim)
            }
            Text("·").foregroundStyle(OS1VisualStyle.textFaint)
            Text(RepoTile.label(for: card.repo))
                .font(.caption)
                .foregroundStyle(OS1VisualStyle.textFaint)
                .lineLimit(1)
            if card.sessionCount > 1 {
                Text("·").foregroundStyle(OS1VisualStyle.textFaint)
                Text("\(card.sessionCount) chats")
                    .font(.caption)
                    .foregroundStyle(OS1VisualStyle.textFaint)
            }
            // "How long ago" only when nothing is happening. Beside a run
            // clock it is a second duration meaning something else entirely,
            // and the pair reads as one broken number.
            if !card.isRunning {
                Text("·").foregroundStyle(OS1VisualStyle.textFaint)
                Text(SessionRow.compactAgo(Date().timeIntervalSince(card.lastActivity)))
                    .font(.caption)
                    .foregroundStyle(OS1VisualStyle.textFaint)
            }
        }
        .font(.caption)
    }

    /// Ticks only while the row is actually mid-run, and only on the top card —
    /// a second clock behind the one you are reading is pure battery.
    @ViewBuilder
    private var runningLabel: some View {
        if isTop, let since = card.runStartedAt {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                // Named, not a bare duration: unlabelled, it reads as "last
                // active" — the opposite of what it means.
                Text("Working \(elapsed(context.date.timeIntervalSince(since)))")
            }
            .font(.caption.weight(.medium).monospacedDigit())
            .foregroundStyle(OS1VisualStyle.yellow)
        } else {
            Text("Working")
                .font(.caption.weight(.medium))
                .foregroundStyle(OS1VisualStyle.yellow)
        }
    }

    private func elapsed(_ interval: TimeInterval) -> String {
        let total = max(0, Int(interval))
        if total < 60 { return "\(total)s" }
        if total < 3_600 { return "\(total / 60)m" }
        return "\(total / 3_600)h \((total % 3_600) / 60)m"
    }

    private var laneColor: Color {
        switch card.lane {
        case .needsInput: OS1VisualStyle.blue
        case .inProgress: OS1VisualStyle.yellow
        case .inReview: OS1VisualStyle.purple
        case .done: OS1VisualStyle.green
        case .backlog: OS1VisualStyle.textFaint
        }
    }

    // MARK: - Body

    /// The normal transcript inside the card. It starts at the conversation's
    /// beginning so Catch Up can be read top to bottom without opening it.
    private var bodyColumn: some View {
        ScrollView(.vertical) {
            bodyContent
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .scrollIndicators(.visible)
        .defaultScrollAnchor(.top)
    }

    private var bodyContent: some View {
        LazyVStack(alignment: .leading, spacing: 10) {
            if let conversation {
                if conversation.failed {
                    caption("Couldn't load this conversation.")
                } else if conversation.blocks.isEmpty {
                    caption("Nothing in this conversation yet.")
                } else {
                    ForEach(conversation.blocks) { block in
                        TranscriptRow(
                            block: block,
                            sessionId: card.target.id,
                            worktreeDir: card.target.worktreeDir,
                            foldState: { folds.fold(for: $0, preference: "collapsed") },
                            expansionState: {
                                folds.expansion(id: $0, defaultExpanded: $1)
                            },
                            owner: card.target.isAutomation ? nil : card.target.startedBy
                        )
                        .id(block.id)
                    }
                }
            } else {
                CatchUpConversationPlaceholder()
            }
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private func caption(_ text: String) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(OS1VisualStyle.textFaint)
    }

    // MARK: - Footer

    private var footerRow: some View {
        HStack(spacing: 10) {
            Image(systemName: "plus")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(OS1VisualStyle.textDim)
                .frame(width: 36, height: 36)
                .background(Circle().fill(OS1VisualStyle.hover))
            TextField("Message main chat", text: $reply, axis: .vertical)
                .lineLimit(1...4)
                .font(.body)
                .submitLabel(.send)
                .onSubmit(sendReply)
            Button(action: sendReply) {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(
                        canReply ? OS1VisualStyle.accent : OS1VisualStyle.textFaint
                    )
                    .frame(width: 36, height: 36)
            }
            .buttonStyle(.plain)
            .disabled(!canReply)
            .accessibilityLabel("Send reply")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(OS1VisualStyle.raised)
                .overlay {
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(OS1VisualStyle.border.opacity(0.4), lineWidth: 0.5)
                }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private var canReply: Bool {
        !reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func sendReply() {
        let text = reply.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        Haptics.play(.send)
        onReply(text)
        reply = ""
    }

    // MARK: - Behind the top card

    private var placeholderColumn: some View {
        VStack(alignment: .leading, spacing: 9) {
            ForEach([0.72, 0.94, 0.55], id: \.self) { fraction in
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(OS1VisualStyle.hover)
                    .frame(height: 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .scaleEffect(x: fraction, anchor: .leading)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18)
        .padding(.top, 4)
    }
}

/// What a card shows while its conversation is still loading. Deliberately the
/// same shapes the loaded card uses, so nothing shifts when the text lands.
private struct CatchUpConversationPlaceholder: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ForEach([0.35, 0.9, 0.78, 0.5], id: \.self) { fraction in
                RoundedRectangle(cornerRadius: 5, style: .continuous)
                    .fill(OS1VisualStyle.hover)
                    .frame(height: 11)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .scaleEffect(x: fraction, anchor: .leading)
            }
        }
        .opacity(reduceMotion ? 0.8 : 1)
        .modifier(CatchUpBreathing(active: !reduceMotion))
        .accessibilityLabel("Loading")
    }
}

/// A slow, low-contrast pulse — enough to say "still loading", far enough from
/// a flashing element to leave alone under reduced motion.
private struct CatchUpBreathing: ViewModifier {
    let active: Bool

    func body(content: Content) -> some View {
        if active {
            content.phaseAnimator([1.0, 0.45]) { view, opacity in
                view.opacity(opacity)
            } animation: { _ in
                .easeInOut(duration: 0.85)
            }
        } else {
            content
        }
    }
}
