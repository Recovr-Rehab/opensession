import SwiftUI

/// One card in the catch-up deck.
///
/// A glance, not a transcript: what you asked, where things stand, and how to
/// get to the rest. Two reasons it stops there — a card you can scroll is a
/// card you can't swipe, and triage is a decision, not a read.
///
/// Only the top card draws its content. The ones behind are a title and a few
/// grey lines: nobody can read them, and rendering markdown three times over
/// for a stack that is about to move is exactly the kind of work that makes a
/// gesture stutter.
struct CatchUpCardView: View {
    let card: CatchUpCard
    let preview: CatchUpViewModel.Preview?
    let isTop: Bool
    let onOpen: () -> Void
    let onReply: () -> Void

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
        HStack(alignment: .top, spacing: 11) {
            RepoTile(name: card.repo, size: 28)
            VStack(alignment: .leading, spacing: 3) {
                Text(card.title)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(OS1VisualStyle.text)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                metaRow
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 18)
        .padding(.top, 18)
        .padding(.bottom, 14)
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
                Text("\(card.sessionCount) sessions")
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

    /// The glance, in a scroll view that is not scrollable.
    ///
    /// Not decoration: a fixed `.frame` does NOT constrain a child that wants
    /// more room, it just lets it overflow, and a long answer rendered through
    /// the markdown view is exactly that child — it drew itself over the whole
    /// screen, deck chrome included. A `ScrollView` takes the size it is
    /// offered, clips to it, and never reports its content's height outward,
    /// which is the containment a card needs. Scrolling stays OFF because the
    /// card's job is to be swiped; the rest of the conversation is behind
    /// "Open".
    private var bodyColumn: some View {
        ScrollView(.vertical) {
            bodyContent
        }
        .scrollDisabled(true)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        // What's cut off should look cut off. A hard edge reads as a bug; a
        // fade reads as "there is more, and it is in the session".
        .mask(
            LinearGradient(
                stops: [
                    .init(color: .black, location: 0),
                    .init(color: .black, location: 0.86),
                    .init(color: .black.opacity(0), location: 1),
                ],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }

    private var bodyContent: some View {
        VStack(alignment: .leading, spacing: 16) {
            if let preview {
                if preview.failed {
                    caption("Couldn't load this conversation.")
                } else {
                    if let prompt = preview.prompt {
                        section("You asked") {
                            Text(prompt)
                                .font(.subheadline)
                                .foregroundStyle(OS1VisualStyle.textNarration)
                                .lineLimit(3)
                        }
                    }
                    if let latest = preview.latest {
                        section("Latest") {
                            MarkdownBody(latest)
                        }
                    } else if preview.prompt != nil {
                        caption("No reply yet.")
                    } else {
                        caption("Nothing in this conversation yet.")
                    }
                }
            } else {
                CatchUpPreviewPlaceholder()
            }
        }
        .padding(.horizontal, 18)
        .padding(.top, 16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private func section<Content: View>(
        _ title: String, @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(OS1VisualStyle.textFaint)
                .textCase(.uppercase)
                .tracking(0.6)
            content()
        }
    }

    private func caption(_ text: String) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(OS1VisualStyle.textFaint)
    }

    // MARK: - Footer

    private var footerRow: some View {
        HStack(spacing: 10) {
            Button(action: onOpen) {
                Label("Open", systemImage: "arrow.up.forward")
                    .labelStyle(.titleAndIcon)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(OS1VisualStyle.text)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(Capsule().fill(OS1VisualStyle.hover))
            }
            .buttonStyle(.plain)
            Spacer(minLength: 0)
            Button(action: onReply) {
                Label("Reply", systemImage: "arrowshape.turn.up.left.fill")
                    .labelStyle(.titleAndIcon)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(OS1VisualStyle.onAccent)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 9)
                    .background(Capsule().fill(OS1VisualStyle.accent))
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 18)
        .padding(.top, 10)
        .padding(.bottom, 16)
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
private struct CatchUpPreviewPlaceholder: View {
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
