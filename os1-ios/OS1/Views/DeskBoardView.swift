import SwiftUI

/// The Desk's default screen: one flat list of what needs you, and nothing
/// else.
///
/// It was a sectioned board with cards, option chips, counts and a todo list;
/// that was too much to read on a surface you summon for a few seconds. What
/// survives is the only question worth answering here — what should I look at
/// next — as one line per thing, most urgent first. Everything else (which
/// repo, which PR, what it's asking) lives one tap away in the session, which
/// is where you'd act on it anyway.
///
/// When nothing needs you it renders NOTHING: the Desk is then just its
/// composer, which is the right shape for "hand me something".
struct DeskBoardView: View {
    var onOpen: (String) -> Void
    /// Present when a stale conversation is being held back.
    var earlierCount: Int
    var onShowEarlier: () -> Void

    @State private var state: DeskState?

    private let poll = Timer.publish(every: 10, on: .main, in: .common).autoconnect()

    /// One of each thing the Desk does — delegate, ask, capture — so the blank
    /// state teaches the range rather than advertising three features.
    private static let examples = [
        "\u{201C}Look into why the build got slow\u{201D}",
        "\u{201C}What\u{2019}s on my plate?\u{201D}",
        "\u{201C}Remind me to review that PR tomorrow\u{201D}",
    ]

    /// Blocked on you first — work stopped for want of an answer — then
    /// results you haven't read, then what's still going.
    private struct Row: Identifiable {
        let id: String
        let title: String
        let note: String
    }

    private var rows: [Row] {
        guard let state else { return [] }
        let waiting = state.waiting.map {
            Row(id: $0.sessionId, title: $0.title, note: "needs an answer")
        }
        let review = state.review.map {
            Row(id: $0.sessionId, title: $0.title, note: $0.pr.map { "PR #\($0.number)" } ?? "done")
        }
        let running = state.running.map {
            Row(id: $0.sessionId, title: $0.title, note: "running")
        }
        return Array((waiting + review + running).prefix(6))
    }

    /// The note tells you how these rows differ, so it earns its place only
    /// when they do — six lines all reading "needs an answer" is decoration.
    private var showsNotes: Bool { Set(rows.map(\.note)).count > 1 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if earlierCount > 0 {
                Button("Show earlier conversation", action: onShowEarlier)
                    .font(.footnote)
                    .foregroundStyle(OS1VisualStyle.textDim)
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 6)
            }
            // Nothing needs you: the one moment the Desk has nothing to say,
            // and the only place there's room to say what it's for. Plain
            // lines rather than chips — a row of buttons would be permanent
            // chrome for a daily user who stopped needing the hint long ago.
            if state != nil && rows.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Try")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(OS1VisualStyle.textFaint)
                        .padding(.bottom, 2)
                    ForEach(Self.examples, id: \.self) { example in
                        Text(example)
                            .font(.subheadline)
                            .foregroundStyle(OS1VisualStyle.textDim)
                    }
                }
                .padding(.top, 12)
            }
            ForEach(rows) { row in
                Button {
                    onOpen(row.id)
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(row.title)
                            .font(.subheadline)
                            .foregroundStyle(OS1VisualStyle.text)
                            .lineLimit(1)
                        Spacer(minLength: 8)
                        if showsNotes {
                            Text(row.note)
                                .font(.caption2)
                                .foregroundStyle(OS1VisualStyle.textFaint)
                        }
                    }
                    .padding(.vertical, 11)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .task { await load() }
        .onReceive(poll) { _ in Task { await load() } }
    }

    private func load() async {
        // A board that can't load says nothing rather than an error the user
        // can do nothing about — the composer still works.
        state = try? await OS1API.deskState()
    }
}
