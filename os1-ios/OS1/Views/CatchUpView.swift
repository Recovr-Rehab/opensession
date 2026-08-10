import SwiftUI

/// Catch up — swipe through everything unread, one workspace at a time.
///
/// The screen is deliberately a DECK rather than a list: a list asks you to
/// choose what to look at next, and the whole point of catching up is that you
/// don't want to choose, you want to be handed the next thing. Three decisions
/// leave the deck — archive, mark read, keep unread — and each is available
/// both as a throw and as a button, sharing one motion path so the gesture and
/// the control never look like two different features.
///
/// The card itself is a GLANCE (what you asked, where things stand), not a
/// transcript. That is what keeps the gesture pure — nothing inside the card
/// competes for the drag — and the full conversation stays one tap away.
struct CatchUpView: View {
    let list: SessionsListViewModel
    /// Leave the deck for the real conversation. The CALLER closes this screen
    /// and pushes the session — the deck must not dismiss itself first, or the
    /// push races the cover's own dismissal and lands nowhere.
    let onOpenSession: (Session) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var model = CatchUpViewModel()
    @State private var replying = false

    var body: some View {
        VStack(spacing: 0) {
            header
            content
        }
        .background(OS1VisualStyle.chatCanvas)
        .task { await model.settle(from: list) }
        // Not `.success` on every finish: the chime belongs to the moment the
        // last card leaves, and only when there was something to clear.
        .haptic(trigger: model.isDone) { was, now in
            now && !was && model.handled > 0 ? .commit : nil
        }
        .sheet(isPresented: $replying) {
            if let card = model.current {
                CatchUpReplySheet(card: card) { text in
                    model.reply(text)
                }
            }
        }
    }

    // MARK: - Chrome

    private var header: some View {
        VStack(spacing: 10) {
            ZStack {
                Text(counterLabel)
                    .font(.headline)
                    .foregroundStyle(OS1VisualStyle.text)
                    // The count is the one number on screen that changes as you
                    // work, so it rolls rather than cutting.
                    .contentTransition(.numericText(countsDown: true))
                    .animation(.snappy(duration: 0.3), value: model.remaining)
                HStack {
                    Button { dismiss() } label: {
                        Image(systemName: "chevron.down")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(OS1VisualStyle.textDim)
                            .frame(width: 44, height: 44)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Close catch up")
                    Spacer()
                }
            }
            progressBar
        }
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, 12)
    }

    /// How far through the deck you are. A finish line is most of what makes a
    /// queue feel finishable.
    private var progressBar: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(OS1VisualStyle.hover)
                Capsule()
                    .fill(OS1VisualStyle.accent)
                    .frame(width: max(0, geo.size.width * fractionDone))
            }
        }
        .frame(height: 3)
        .padding(.horizontal, 8)
        .animation(.snappy(duration: 0.38), value: fractionDone)
        .opacity(model.isEmpty ? 0 : 1)
        .accessibilityHidden(true)
    }

    private var fractionDone: Double {
        guard !model.cards.isEmpty else { return 0 }
        return Double(model.cards.count - model.remaining) / Double(model.cards.count)
    }

    private var counterLabel: String {
        if model.isSettling && model.isEmpty { return "Catch up" }
        if model.isEmpty || model.isDone { return "All caught up" }
        return "\(model.remaining) left"
    }

    // MARK: - Body

    @ViewBuilder
    private var content: some View {
        if model.isSettling && model.isEmpty {
            // The shape the first card will take, not a spinner: nothing moves
            // when the real one arrives.
            CatchUpLoadingCard()
                .transition(.opacity)
        } else if model.isEmpty || model.isDone {
            CatchUpFinishedView(handled: model.handled, onDone: { dismiss() })
                .transition(
                    reduceMotion
                        ? .opacity
                        : .scale(scale: 0.94).combined(with: .opacity)
                )
        } else {
            CatchUpDeckView(
                model: model,
                onOpen: onOpenSession,
                onReply: { replying = true }
            )
        }
    }
}

// MARK: - Loading

/// What the deck shows while the sessions list and the read marks are still in
/// flight. Deliberately the card's own silhouette: the first real card lands in
/// the same place at the same size, so nothing jumps.
private struct CatchUpLoadingCard: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathing = false

    var body: some View {
        RoundedRectangle(cornerRadius: 26, style: .continuous)
            .fill(OS1VisualStyle.background)
            .overlay(
                RoundedRectangle(cornerRadius: 26, style: .continuous)
                    .strokeBorder(OS1VisualStyle.border.opacity(0.5), lineWidth: 0.5)
            )
            .shadow(color: .black.opacity(0.1), radius: 18, y: 10)
            .padding(.horizontal, 16)
            .padding(.bottom, 34)
            .opacity(breathing ? 0.55 : 1)
            .accessibilityLabel("Loading your unread work")
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) {
                    breathing = true
                }
            }
    }
}

// MARK: - Finished

/// The end of the deck. Restrained on purpose — the reward for clearing a queue
/// is the empty queue, not a firework.
private struct CatchUpFinishedView: View {
    let handled: Int
    let onDone: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var landed = false

    var body: some View {
        VStack(spacing: 14) {
            Spacer()
            ZStack {
                // One soft ring, expanding out of the seal as it lands: the
                // motion says "that's the last one" without an animation the
                // eye has to follow.
                Circle()
                    .stroke(OS1VisualStyle.accent.opacity(landed ? 0 : 0.35), lineWidth: 2)
                    .frame(width: 86, height: 86)
                    .scaleEffect(landed ? 1.55 : 0.7)
                Image(systemName: "checkmark")
                    .font(.system(size: 34, weight: .semibold))
                    .foregroundStyle(OS1VisualStyle.onAccent)
                    .frame(width: 86, height: 86)
                    .background(Circle().fill(OS1VisualStyle.accent))
                    .scaleEffect(landed ? 1 : 0.6)
                    .opacity(landed ? 1 : 0)
            }
            Text("All caught up")
                .font(.title2.weight(.semibold))
                .foregroundStyle(OS1VisualStyle.text)
            Text(subtitle)
                .font(.callout)
                .foregroundStyle(OS1VisualStyle.textDim)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 40)
            Spacer()
            Button(action: onDone) {
                Text("Done")
                    .font(.body.weight(.semibold))
                    .foregroundStyle(OS1VisualStyle.onAccent)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
                    .background(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .fill(OS1VisualStyle.accent)
                    )
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 20)
            .padding(.bottom, 12)
        }
        .opacity(landed ? 1 : 0)
        .onAppear {
            guard !reduceMotion else {
                landed = true
                return
            }
            withAnimation(.spring(response: 0.5, dampingFraction: 0.62)) { landed = true }
        }
    }

    private var subtitle: String {
        switch handled {
        case 0: "Nothing unread right now."
        case 1: "You went through one workspace."
        default: "You went through \(handled) workspaces."
        }
    }
}

// MARK: - Reply

/// A reply from the deck, as a small sheet rather than a field on the card.
/// The card is a drag surface; a keyboard and a text field on top of it would
/// be two gestures fighting over the same pixels, and a detent-sized sheet is
/// what the system already does well here.
private struct CatchUpReplySheet: View {
    let card: CatchUpCard
    let onSend: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 10) {
                Text(card.title)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(OS1VisualStyle.textDim)
                    .lineLimit(1)
                TextField("Reply…", text: $text, axis: .vertical)
                    .font(.body)
                    .lineLimit(1...6)
                    .focused($focused)
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(OS1VisualStyle.raised)
                    )
                Spacer(minLength: 0)
            }
            .padding(16)
            .inlineTitleBarCompat()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Send") {
                        // The sheet is gone before a trigger could fire.
                        Haptics.play(.send)
                        onSend(text)
                        dismiss()
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .presentationDetents([.height(240)])
        .presentationDragIndicator(.visible)
        .onAppear { focused = true }
    }
}
