import SwiftUI

/// The Desk's default screen: the work you handed off, not a list of things
/// you meant to do.
///
/// Sections render only when they hold something, so a quiet world gives a
/// quiet screen rather than a wall of zeros — and the board drains by itself
/// as questions are answered and results are read, which is the thing a todo
/// list can't do. Shown where the Desk's transcript would be when there is no
/// conversation on screen (SessionView's `emptyContent`).
///
/// Order is deliberate: a blocked question is work that has STOPPED for want
/// of you, which outranks output that is merely unread.
struct DeskBoardView: View {
    /// Answer a question inline. `human` asks resolve over REST; a session's
    /// own ask goes back over the Desk's socket (SessionViewModel).
    var onAnswer: (DeskState.WorkItem, String) -> Void
    var onOpen: (String) -> Void
    /// Present when a stale conversation is being held back.
    var earlierCount: Int
    var onShowEarlier: () -> Void

    @State private var state: DeskState?
    @State private var failed = false
    /// Answered here and hidden at once: the poll is up to 10s behind, and a
    /// question that stays put after you answer it reads as broken.
    @State private var answered: Set<String> = []

    private let poll = Timer.publish(every: 10, on: .main, in: .common).autoconnect()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if earlierCount > 0 {
                Button("Show earlier conversation", action: onShowEarlier)
                    .font(.footnote)
                    .foregroundStyle(OS1VisualStyle.textDim)
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 4)
            }
            if failed && state == nil {
                Text("Couldn't load your Desk.")
                    .font(.footnote)
                    .foregroundStyle(OS1VisualStyle.textDim)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 40)
            } else if let state {
                content(state)
            }
        }
        .task { await load() }
        .onReceive(poll) { _ in Task { await load() } }
    }

    @ViewBuilder
    private func content(_ state: DeskState) -> some View {
        let waiting = state.waiting.filter { !answered.contains($0.sessionId) }
        if state.isEmpty && waiting.isEmpty {
            allClear
        } else {
            VStack(alignment: .leading, spacing: 0) {
                if !waiting.isEmpty {
                    section("Waiting on you", dot: OS1VisualStyle.yellow) {
                        ForEach(waiting) { card($0, answerable: true) }
                    }
                }
                if !state.review.isEmpty {
                    section("Needs your eyes", dot: OS1VisualStyle.textFaint) {
                        ForEach(state.review) { card($0, answerable: false) }
                    }
                }
                if !state.running.isEmpty {
                    section(
                        "Running",
                        dot: OS1VisualStyle.green,
                        count: state.running.count + (state.more?.running ?? 0)
                    ) {
                        ForEach(state.running) { runningRow($0) }
                    }
                }
                if state.isQuiet && waiting.isEmpty {
                    Text("Nothing running, nothing waiting on you.")
                        .font(.footnote)
                        .foregroundStyle(OS1VisualStyle.textFaint)
                        .padding(.vertical, 6)
                }
                if !state.todos.isEmpty {
                    section(
                        "On your list",
                        dot: nil,
                        count: state.todos.count + (state.more?.todos ?? 0)
                    ) {
                        ForEach(state.todos) { todo in
                            HStack(spacing: 8) {
                                Text(todo.text)
                                    .font(.subheadline)
                                    .foregroundStyle(OS1VisualStyle.textDim)
                                Spacer(minLength: 8)
                                if let due = todo.due {
                                    Text("due \(due)")
                                        .font(.caption2)
                                        .foregroundStyle(OS1VisualStyle.textFaint)
                                }
                            }
                            .padding(.vertical, 8)
                            Divider().opacity(0.4)
                        }
                    }
                }
            }
        }
    }

    private var allClear: some View {
        VStack(spacing: 6) {
            Image(systemName: "lamp.desk")
                .font(.system(size: 28))
                .foregroundStyle(OS1VisualStyle.textFaint.opacity(0.6))
                .padding(.bottom, 4)
            Text("All clear.")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(OS1VisualStyle.textDim)
            Text("Nothing running, nothing waiting on you.\nHand me something and I'll get it started.")
                .font(.footnote)
                .multilineTextAlignment(.center)
                .foregroundStyle(OS1VisualStyle.textFaint)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 48)
    }

    @ViewBuilder
    private func section<Content: View>(
        _ title: String,
        dot: Color?,
        count: Int? = nil,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                if let dot {
                    Circle().fill(dot).frame(width: 7, height: 7)
                }
                Text(title.uppercased())
                    .font(.caption2.weight(.semibold))
                    .kerning(0.6)
                    .foregroundStyle(OS1VisualStyle.textFaint)
                if let count, count > 0 {
                    Text("\(count)")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(OS1VisualStyle.textFaint)
                }
            }
            .padding(.bottom, 6)
            content()
        }
        .padding(.top, 14)
    }

    private func card(_ item: DeskState.WorkItem, answerable: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(item.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(OS1VisualStyle.text)
                    .lineLimit(1)
                Spacer(minLength: 8)
                if let repo = item.repo {
                    Text(repo)
                        .font(.caption2)
                        .foregroundStyle(OS1VisualStyle.textFaint)
                }
            }
            if let sub = item.question?.text ?? item.pr?.label {
                Text(sub)
                    .font(.footnote)
                    .foregroundStyle(OS1VisualStyle.textDim)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if answerable, let question = item.question, !question.options.isEmpty {
                // Wrapping row of one-tap answers. A LazyVGrid rather than an
                // HStack: option labels are full sentences often enough that a
                // single row would truncate them into uselessness.
                LazyVGrid(
                    columns: [GridItem(.adaptive(minimum: 130), spacing: 6)],
                    alignment: .leading,
                    spacing: 6
                ) {
                    ForEach(Array(question.options.enumerated()), id: \.offset) { index, option in
                        Button {
                            answered.insert(item.sessionId)
                            onAnswer(item, option)
                        } label: {
                            Text(option)
                                .font(.footnote.weight(.medium))
                                .lineLimit(2)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 7)
                                .padding(.horizontal, 10)
                                .background(
                                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                                        .fill(index == 0 ? OS1VisualStyle.text : OS1VisualStyle.hover)
                                )
                                .foregroundStyle(
                                    index == 0 ? OS1VisualStyle.background : OS1VisualStyle.text
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.top, 2)
            }
        }
        .padding(11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .fill(OS1VisualStyle.raised)
        )
        .padding(.bottom, 6)
        .contentShape(Rectangle())
        .onTapGesture { onOpen(item.sessionId) }
    }

    private func runningRow(_ item: DeskState.WorkItem) -> some View {
        Button {
            onOpen(item.sessionId)
        } label: {
            HStack(spacing: 10) {
                ProgressView()
                    .controlSize(.mini)
                Text(item.title)
                    .font(.subheadline)
                    .foregroundStyle(OS1VisualStyle.text)
                    .lineLimit(1)
                Spacer(minLength: 8)
                if let repo = item.repo {
                    Text(repo)
                        .font(.caption2)
                        .foregroundStyle(OS1VisualStyle.textFaint)
                }
            }
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .overlay(alignment: .bottom) { Divider().opacity(0.4) }
    }

    private func load() async {
        do {
            let next = try await OS1API.deskState()
            state = next
            failed = false
            // Drop local suppressions the server has caught up with, so a
            // question re-asked in the same session can appear again.
            answered = answered.intersection(Set(next.waiting.map(\.sessionId)))
        } catch {
            if state == nil { failed = true }
        }
    }
}
