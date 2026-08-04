import SwiftUI

/// The collapsible work fold: one header line standing in for everything a
/// turn did before it answered.
///
/// Collapsed is the default because the answer is what people came for. The
/// header has to carry enough for the fold to be skippable without opening
/// it — what kind of work (the family glyphs), how much (steps, duration),
/// whether it went wrong (failures, in red), and what it changed (edited
/// files and ± lines).
struct TurnBlockView: View {
    let turn: WorkTurn
    let sessionId: String
    let state: TurnFoldState
    /// Resolves each nested tool row's own detail state, which must survive
    /// the row scrolling out of the lazy stack.
    let detailState: (ToolCallItem) -> TurnFoldState

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    private var glyphLimit: Int {
        horizontalSizeClass == .compact ? 4 : 6
    }

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
            .accessibilityHint(state.expanded ? "Hide the work" : "Show the work")

            if state.expanded {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(turn.items) { item in
                        switch item {
                        case .message(let entry):
                            // Narration between tool calls reads dimmer than
                            // a final answer — it is context, not conclusion.
                            MarkdownBody(entry.text, dimmed: true)
                                .padding(.trailing, 16)
                        case .tool(let call):
                            ToolCallRow(
                                item: call,
                                sessionId: sessionId,
                                state: detailState(call)
                            )
                        }
                    }
                }
                .padding(.leading, 8)
                .padding(.top, 2)
                .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var header: some View {
        HStack(spacing: 6) {
            Image(systemName: "chevron.down")
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(OS1VisualStyle.textFaint)
                .rotationEffect(.degrees(state.expanded ? 0 : -90))

            Text(turn.isLive ? "Working" : "Worked")
                .font(.subheadline.weight(.medium))
                .fixedSize()

            if !turn.families.isEmpty {
                HStack(spacing: 5) {
                    ForEach(turn.families.prefix(glyphLimit), id: \.self) { family in
                        Image(systemName: family.symbol)
                            .font(.system(size: 11))
                    }
                }
                .foregroundStyle(OS1VisualStyle.textFaint)
                .fixedSize()
            }

            Text(counters)
                .font(.footnote)
                .fixedSize()

            if turn.failureCount > 0 {
                Text("· \(turn.failureCount) failed")
                    .font(.footnote)
                    .foregroundStyle(OS1VisualStyle.red)
                    .fixedSize()
            }

            Spacer(minLength: 6)

            trailingDetail
        }
        .foregroundStyle(OS1VisualStyle.textDim)
        .padding(.vertical, 3)
        .contentShape(Rectangle())
    }

    /// "· 12s · 5 steps" — omitted pieces collapse rather than leaving
    /// stray separators.
    private var counters: String {
        var parts: [String] = []
        if let duration = turn.duration, let label = TranscriptFormat.duration(duration) {
            parts.append(label)
        }
        if turn.toolCount > 0 {
            parts.append("\(turn.toolCount) step\(turn.toolCount == 1 ? "" : "s")")
        }
        return parts.isEmpty ? "" : "· " + parts.joined(separator: " · ")
    }

    /// While a collapsed fold is live, what it is doing right now; once it
    /// settles, what it changed. Line stats hold their space, the file names
    /// truncate — a count is useless truncated, a filename still reads.
    @ViewBuilder
    private var trailingDetail: some View {
        if !state.expanded {
            if turn.isLive, let preview = turn.livePreview {
                Text(preview)
                    .font(.system(.caption, design: .monospaced))
                    .foregroundStyle(OS1VisualStyle.textFaint)
                    .lineLimit(1)
                    .truncationMode(.middle)
            } else {
                HStack(spacing: 6) {
                    if !turn.touchedFiles.isEmpty {
                        Text(TranscriptFormat.editedFiles(turn.touchedFiles))
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(OS1VisualStyle.textFaint)
                            .lineLimit(1)
                            .truncationMode(.head)
                    }
                    if !turn.lineStats.isEmpty {
                        LineStatsView(stats: turn.lineStats)
                            .layoutPriority(1)
                    }
                }
            }
        }
    }

    private var accessibilityLabel: String {
        var parts = [turn.isLive ? "Working" : "Worked"]
        if turn.toolCount > 0 {
            parts.append("\(turn.toolCount) step\(turn.toolCount == 1 ? "" : "s")")
        }
        if let duration = turn.duration, let label = TranscriptFormat.duration(duration) {
            parts.append(label)
        }
        if turn.failureCount > 0 { parts.append("\(turn.failureCount) failed") }
        return parts.joined(separator: ", ")
    }
}

/// `+40 −12`. Both halves are omitted when zero — a bare `+0` reads as a
/// claim that nothing changed, which is different from "no counts known".
struct LineStatsView: View {
    let stats: ToolLineStats

    var body: some View {
        HStack(spacing: 4) {
            if stats.additions > 0 {
                Text("+\(stats.additions)")
                    .foregroundStyle(OS1VisualStyle.green)
            }
            if stats.deletions > 0 {
                Text("−\(stats.deletions)")
                    .foregroundStyle(OS1VisualStyle.red)
            }
        }
        .font(.caption2.weight(.medium))
        .monospacedDigit()
        .fixedSize()
    }
}

// MARK: - Turn footer

/// The metadata row closing a settled turn: how long it took, which model
/// wrote it, and which files it touched.
struct TurnFooterView: View {
    let footer: TurnFooter

    var body: some View {
        HStack(spacing: 8) {
            if let duration = footer.duration,
               let label = TranscriptFormat.duration(duration) {
                Text(label)
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(OS1VisualStyle.textFaint)
                    .fixedSize()
            }

            if let model = footer.model, !model.isEmpty {
                Text(TranscriptFormat.modelLabel(model))
                    .font(.caption2)
                    .foregroundStyle(OS1VisualStyle.textFaint)
                    .lineLimit(1)
                    .fixedSize()
            }

            if !footer.files.isEmpty {
                // Horizontal scroll rather than a "+N" cut: on a phone the
                // chips are the only place a turn's file changes are named.
                ScrollView(.horizontal) {
                    HStack(spacing: 6) {
                        ForEach(footer.files) { file in
                            FileChipView(file: file)
                        }
                    }
                    .padding(.trailing, 8)
                }
                .scrollIndicators(.hidden)
            }

            Spacer(minLength: 0)
        }
        .padding(.top, 1)
        .padding(.bottom, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One touched file: a colored extension badge, the basename, and its ±.
struct FileChipView: View {
    let file: TouchedFile

    var body: some View {
        HStack(spacing: 5) {
            Text(file.extensionBadge)
                .font(.system(size: 8, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .padding(.horizontal, 3)
                .frame(minWidth: 18, minHeight: 14)
                .background(
                    Self.color(for: file.extensionBadge),
                    in: RoundedRectangle(cornerRadius: 3, style: .continuous)
                )
            Text(file.basename)
                .font(.caption2)
                .foregroundStyle(OS1VisualStyle.textDim)
                .lineLimit(1)
            if file.additions > 0 || file.deletions > 0 {
                LineStatsView(
                    stats: ToolLineStats(
                        additions: file.additions,
                        deletions: file.deletions
                    )
                )
            }
        }
        .padding(.leading, 3)
        .padding(.trailing, 7)
        .padding(.vertical, 3)
        .background(
            OS1VisualStyle.panel,
            in: RoundedRectangle(cornerRadius: 6, style: .continuous)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel(Text(verbatim: file.path))
    }

    /// Linguist-ish hues, darkened so the white badge label clears contrast.
    private static func color(for ext: String) -> Color {
        switch ext {
        case "TS", "TSX": Color(red: 0.13, green: 0.34, blue: 0.66)
        case "JS", "JSX", "MJS": Color(red: 0.62, green: 0.53, blue: 0.05)
        case "SWIF": Color(red: 0.78, green: 0.29, blue: 0.13)
        case "RES", "RESI": Color(red: 0.78, green: 0.18, blue: 0.29)
        case "CSS", "SCSS": Color(red: 0.37, green: 0.24, blue: 0.60)
        case "HTML": Color(red: 0.79, green: 0.32, blue: 0.13)
        case "JSON", "YAML", "YML", "TOML": Color(red: 0.35, green: 0.40, blue: 0.45)
        case "MD", "MDX": Color(red: 0.24, green: 0.40, blue: 0.55)
        case "PY": Color(red: 0.19, green: 0.35, blue: 0.53)
        case "RS": Color(red: 0.51, green: 0.29, blue: 0.16)
        case "GO": Color(red: 0.0, green: 0.42, blue: 0.53)
        case "SH", "BASH": Color(red: 0.24, green: 0.44, blue: 0.24)
        default: Color(red: 0.36, green: 0.38, blue: 0.42)
        }
    }
}
