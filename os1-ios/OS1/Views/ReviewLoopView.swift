import SwiftUI

/// A PR review handoff and the work it triggered, folded like a worker.
///
/// A review round arrives as a pile of ordinary rows — the handoff notice, the
/// fix turns, the push, then the next handoff — which is the noisiest thing a
/// phone transcript can hold, and none of it is what the reader came for.
/// Closed, this row says what the loop concluded; opened, it shows the same
/// icon-led step rows as any other turn, with the verdict at the end. Mirrors
/// the web viewer's `ReviewLoopBlock`.
struct ReviewLoopView: View {
    let loop: ReviewLoop
    let sessionId: String
    var worktreeDir: String?
    let state: TurnFoldState
    /// Resolves each nested row's own detail state, which must survive the row
    /// scrolling out of the lazy stack.
    let expansionState: (String, Bool) -> TurnFoldState

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                withAnimation(.snappy(duration: 0.22, extraBounce: 0)) {
                    state.toggle()
                }
            } label: {
                header
            }
            .buttonStyle(.plain)
            .accessibilityLabel(accessibilityLabel)
            .accessibilityHint(state.expanded ? "Hide the review work" : "Show the review work")

            if state.expanded {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(loop.blocks) { block in
                        // The handoff itself is what the header stands for;
                        // drawing it again inside would say the same thing
                        // twice, one indent apart.
                        if !isHandoff(block) {
                            row(for: block)
                        }
                    }
                    if let result = loop.result {
                        ReviewLoopResultRow(result: result, rounds: loop.rounds)
                    }
                }
                .padding(.leading, 6)
                .padding(.top, 8)
                .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Review work uses the turn's own step rows, without a second worker
    /// disclosure inside this one.
    @ViewBuilder
    private func row(for block: TranscriptBlock) -> some View {
        switch block {
        case .work(let turn):
            TurnStepsView(
                items: turn.items,
                sessionId: sessionId,
                worktreeDir: worktreeDir,
                isLive: loop.isLive,
                expansionState: expansionState
            )
        case .tool(let item):
            ToolCallRow(
                item: item,
                sessionId: sessionId,
                worktreeDir: worktreeDir,
                state: expansionState(item.id, false)
            )
        case .footer(let footer):
            TurnFooterView(footer: footer, sessionId: sessionId)
        case .message(let entry):
            if let notice = entry.notice {
                NoticeRow(
                    entry: entry,
                    notice: notice,
                    state: expansionState("notice-\(entry.id)", false)
                )
            } else {
                // A plain prompt can never be in here — one ends the loop —
                // so anything left is the agent's own prose.
                AssistantMessage(
                    entry: entry,
                    sessionId: sessionId,
                    state: expansionState("body-\(entry.id)", false)
                )
            }
        // Notes and walkthroughs are never grouped into a loop, and a loop
        // never nests.
        default:
            EmptyView()
        }
    }

    private var header: some View {
        HStack(spacing: 6) {
            Image(systemName: "chevron.down")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(OS1VisualStyle.textFaint)
                .rotationEffect(.degrees(state.expanded ? 0 : -90))

            Text("Review loop")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(OS1VisualStyle.textDim)
                .fixedSize()

            // Opened, a settled loop trades its verdict for the round count:
            // the verdict then has its own row at the end of the work.
            Text(visibleDetail)
                .font(.footnote)
                .foregroundStyle(OS1VisualStyle.textFaint)
                .lineLimit(1)

            Spacer(minLength: 6)

            if let prNumber = loop.prNumber {
                // Verbatim: interpolated into a LocalizedStringKey the number
                // runs through the device's locale and #5496 reads "PR #5.496"
                // (same trap as PrPanel's title).
                Text(verbatim: "PR #\(prNumber)")
                    .font(.caption2)
                    .foregroundStyle(OS1VisualStyle.textFaint)
                    .fixedSize()
            }

            if loop.isLive {
                ProgressView()
                    .controlSize(.mini)
            }
        }
        #if os(iOS)
        .frame(minHeight: 44)
        #else
        .padding(.vertical, 3)
        #endif
        .contentShape(Rectangle())
    }

    private var visibleDetail: String {
        state.expanded && loop.isSettled ? loop.roundsLabel : loop.detail
    }

    private func isHandoff(_ block: TranscriptBlock) -> Bool {
        guard case .message(let entry) = block else { return false }
        return entry.notice?.kind == "review-handoff"
    }

    private var accessibilityLabel: String {
        var parts = ["Review loop", loop.isLive ? "Working" : loop.detail]
        if let prNumber = loop.prNumber { parts.append("PR #\(prNumber)") }
        return parts.joined(separator: ", ")
    }
}

/// What the loop concluded, once GitHub has settled: the result first, the
/// numbers behind it as meta.
private struct ReviewLoopResultRow: View {
    let result: ReviewLoopResult
    let rounds: Int

    private var passed: Bool { result.status == .passed }

    var body: some View {
        HStack(spacing: 7) {
            Image(systemName: passed ? "checkmark.circle" : "xmark.circle")
                .font(.system(size: 12))
                .foregroundStyle(passed ? OS1VisualStyle.textFaint : OS1VisualStyle.red)
                .frame(width: 15)

            Text(passed ? "Ready to merge" : "Needs changes")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(OS1VisualStyle.textDim)
                .fixedSize()

            Text(result.facts(rounds: rounds))
                .font(.caption2)
                .foregroundStyle(OS1VisualStyle.textFaint)
                .lineLimit(1)

            Spacer(minLength: 4)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(passed ? "Review passed" : "Review failed")
    }
}
