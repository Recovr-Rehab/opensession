import SwiftUI

/// The collapsible work fold: one header line standing in for everything a
/// turn did before it answered.
///
/// Folded is the default because the answer is what people came for. The
/// header has to carry enough for the fold to be skippable without opening
/// it — what kind of work (the family glyphs), how much (steps, duration),
/// whether it went wrong (failures, in red), and what it changed (edited
/// files and ± lines).
struct TurnBlockView: View {
    let turn: WorkTurn
    let sessionId: String
    var worktreeDir: String?
    let state: TurnFoldState
    /// The "Fold tool calls" preference: the turn's in-between notes keep
    /// reading as transcript while only its tool calls hide behind the header,
    /// because the narration is the part worth reading and a shell invocation
    /// rarely is. Expanding puts the tools back between those same notes.
    var showsMessagesWhenFolded = false
    var expandsToolRuns = false
    /// Resolves each nested tool row's own detail state, which must survive
    /// the row scrolling out of the lazy stack.
    let expansionState: (String, Bool) -> TurnFoldState

    private enum TurnSection: Identifiable {
        case message(TranscriptEntry)
        case tools([ToolCallItem], kind: ToolRunKind)

        var id: String {
            switch self {
            case .message(let entry): entry.id
            case .tools(let items, _): "tools-\(items.first?.id ?? "empty")"
            }
        }
    }

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var glyphLimit: Int {
        horizontalSizeClass == .compact ? 4 : 6
    }

    /// A folded turn that has notes to show. A turn of pure tool calls keeps
    /// the bare header rather than opening an empty container under it.
    private var showsNotesOnly: Bool {
        guard showsMessagesWhenFolded else { return false }
        return turn.items.contains { if case .message = $0 { true } else { false } }
    }

    private var sections: [TurnSection] {
        var sections: [TurnSection] = []
        for item in turn.items {
            switch item {
            case .message(let entry):
                sections.append(.message(entry))
            case .tool(let call):
                let kind = runKind(call)
                if let last = sections.last,
                   case .tools(let existing, let lastKind) = last,
                   lastKind == kind,
                   kind.groups {
                    var tools = existing
                    tools.append(call)
                    sections[sections.count - 1] = .tools(tools, kind: kind)
                } else {
                    sections.append(.tools([call], kind: kind))
                }
            }
        }
        return sections
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

            if state.expanded || showsNotesOnly {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(sections) { section in
                        switch section {
                        case .message(let entry):
                            // Narration is prose to read, just like the final
                            // answer. The fold and its indent distinguish it;
                            // only tool rows keep the dimmed treatment.
                            MarkdownBody(entry.text)
                                .padding(.trailing, 16)
                        case .tools(let calls, let kind):
                            if state.expanded {
                                if case .edits = kind, calls.count > 1 {
                                    EditRunView(
                                        items: calls,
                                        sessionId: sessionId,
                                        worktreeDir: worktreeDir,
                                        state: expansionState("edits-\(calls[0].id)", expandsToolRuns),
                                        isLive: turn.isLive,
                                        expansionState: expansionState
                                    )
                                } else {
                                    ToolRunView(
                                        items: calls,
                                        sessionId: sessionId,
                                        worktreeDir: worktreeDir,
                                        state: expansionState("run-\(calls[0].id)", expandsToolRuns),
                                        isLive: turn.isLive,
                                        isCompact: kind == .compact,
                                        expansionState: expansionState
                                    )
                                }
                            }
                        }
                    }
                }
                // The indent marks what the header can actually close, so it
                // appears only when the fold is open. Under the "messages"
                // preference a folded turn still shows its notes, and those
                // are NOT collapsible — indenting them would offer a
                // container the header cannot shut. Folded, the notes sit
                // flush and read as ordinary transcript, which is the whole
                // point of that preference.
                .padding(.leading, state.expanded ? 6 : 0)
                .padding(.top, state.expanded ? 8 : 2)
                .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Which run, if any, a call joins. Routine calls share one compact run;
    /// consecutive passes over one file share an edit run, keyed on the tool
    /// and the file so a different file — or a read in between — starts a new
    /// one. Everything else stands alone.
    private func runKind(_ item: ToolCallItem) -> ToolRunKind {
        guard item.assetPath == nil,
              item.subagentId == nil,
              // Media the agent asked to show keeps its own row, as everywhere.
              item.result?.featuredMedia?.isEmpty != false
        else { return .single }
        switch item.presentation.family {
        case .run, .file, .find, .web:
            return .compact
        case .edit:
            // One file, named by the same derivation the footer's chips use —
            // a call whose input arrived clamped has none, and keeps its row.
            guard item.presentation.touchedFiles.count == 1 else { return .single }
            let file = item.presentation.touchedFiles[0].path
            return .edits(key: "\(item.presentation.canonical)\u{0}\(file)")
        default:
            return .single
        }
    }

    @ViewBuilder
    private var header: some View {
        Group {
            if dynamicTypeSize.isAccessibilitySize {
                wrappedHeader
            } else {
                singleLineHeader
            }
        }
        .foregroundStyle(OS1VisualStyle.textDim)
        #if os(iOS)
        // The label is visually one line, but its touch target still needs the
        // platform minimum. The previous 24pt frame made otherwise-working
        // folds easy to miss with a thumb.
        .frame(minHeight: 44)
        #else
        .padding(.vertical, 3)
        #endif
        .contentShape(Rectangle())
    }

    private var singleLineHeader: some View {
        HStack(spacing: 6) {
            chevron

            // Everything on this line is intrinsically sized, so a long turn
            // on a narrow screen used to make the header wider than the
            // transcript itself — and because a vertical ScrollView centers
            // content it can't fit, that dragged every paragraph below the
            // fold off the left edge. Fitting is now the layout's job: the
            // glyphs go first, because a symbol says the least per pixel of
            // anything here, and the numbers are what the fold is for.
            ViewThatFits(in: .horizontal) {
                summary(glyphs: glyphLimit)
                summary(glyphs: 2)
                summary(glyphs: 0)
                compressedSummary
            }
            .layoutPriority(1)

            Spacer(minLength: 6)

            trailingDetail
        }
    }

    /// At an accessibility type size no arrangement of one line fits — the
    /// stats alone can take half the width — and squeezing it turns "Worked"
    /// into "Wo…" and the counters into a lone separator. So it wraps
    /// instead: the fold is metadata, and metadata is allowed a second line.
    /// The glyphs sit this one out because they are drawn at a fixed 11pt and
    /// read as specks beside text this large, and so does the edited-file
    /// name, which the footer's chips give in full anyway.
    private var wrappedHeader: some View {
        FlowLayout(spacing: 6) {
            // One subview, so the chevron can never be left stranded on a
            // line of its own above the word it points at.
            HStack(spacing: 6) {
                chevron
                Text(turn.isLive ? "Working" : "Worked")
                    .font(.subheadline.weight(.medium))
            }
            .fixedSize()

            if !counters.isEmpty {
                Text(counters)
                    .font(.footnote)
                    .fixedSize()
            }

            if turn.failureCount > 0 {
                Text("· \(turn.failureCount) failed")
                    .font(.footnote)
                    .foregroundStyle(OS1VisualStyle.red)
                    .fixedSize()
            }

            if !state.expanded, !turn.lineStats.isEmpty {
                LineStatsView(stats: turn.lineStats)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var chevron: some View {
        Image(systemName: "chevron.down")
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(OS1VisualStyle.textFaint)
            .rotationEffect(.degrees(state.expanded ? 0 : -90))
    }

    /// What the turn did, at a given glyph budget. Rigid by construction —
    /// `ViewThatFits` picks between these by their ideal width, so a flexible
    /// child here would report the width of its untruncated text and make
    /// every candidate look too big.
    private func summary(glyphs: Int) -> some View {
        HStack(spacing: 6) {
            Text(turn.isLive ? "Working" : "Worked")
                .font(.subheadline.weight(.medium))
                .fixedSize()

            if glyphs > 0, !turn.families.isEmpty {
                HStack(spacing: 5) {
                    ForEach(turn.families.prefix(glyphs), id: \.self) { family in
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

            failureLabel
        }
    }

    /// The last resort, and the only summary with any give in it: a narrow
    /// window with nothing left to trade away. The counters yield first —
    /// they are the one piece a reader can do without — and failures hold
    /// their width to the end, because a "1 failed" cut down to "1 fa…"
    /// would be worse than not having said it.
    private var compressedSummary: some View {
        HStack(spacing: 6) {
            Text(turn.isLive ? "Working" : "Worked")
                .font(.subheadline.weight(.medium))
                .lineLimit(1)
                .layoutPriority(1)

            Text(counters)
                .font(.footnote)
                .lineLimit(1)

            failureLabel
                .layoutPriority(2)
        }
    }

    @ViewBuilder
    private var failureLabel: some View {
        if turn.failureCount > 0 {
            Text("· \(turn.failureCount) failed")
                .font(.footnote)
                .foregroundStyle(OS1VisualStyle.red)
                .fixedSize()
        }
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
            } else if turn.touchedFiles.isEmpty {
                lineStats
            } else {
                // A name cut down to "….ts" is noise wearing a filename's
                // clothes, and the footer's chips name every file anyway. So
                // it shows whole, shows head-truncated while that still
                // reads, or steps aside for the counts.
                ViewThatFits(in: .horizontal) {
                    editedFiles(width: nil)
                    editedFiles(width: 72)
                    lineStats
                }
            }
        }
    }

    private func editedFiles(width: CGFloat?) -> some View {
        HStack(spacing: 6) {
            Text(TranscriptFormat.editedFiles(turn.touchedFiles))
                .font(.system(.caption, design: .monospaced))
                .foregroundStyle(OS1VisualStyle.textFaint)
                .lineLimit(1)
                .truncationMode(.head)
                .frame(width: width, alignment: .trailing)
            lineStats
        }
    }

    @ViewBuilder
    private var lineStats: some View {
        if !turn.lineStats.isEmpty {
            LineStatsView(stats: turn.lineStats)
                .layoutPriority(1)
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

/// What kind of run a consecutive stretch of tool calls forms.
private enum ToolRunKind: Equatable {
    /// Routine calls — shell, reads, searches — behind one "N steps" line.
    case compact
    /// Repeated passes over a single file, behind one edit row.
    case edits(key: String)
    /// Stands on its own: an asset write, a worker, anything with media.
    case single

    /// Whether a neighbour of the same kind joins, or starts its own run.
    var groups: Bool {
        if case .single = self { return false }
        return true
    }
}

private struct ToolRunView: View {
    let items: [ToolCallItem]
    let sessionId: String
    var worktreeDir: String?
    let state: TurnFoldState
    let isLive: Bool
    let isCompact: Bool
    let expansionState: (String, Bool) -> TurnFoldState

    var body: some View {
        if isCompact {
            VStack(alignment: .leading, spacing: 4) {
                Button {
                    withAnimation(.snappy(duration: 0.2, extraBounce: 0)) {
                        state.toggle()
                    }
                } label: {
                    HStack(spacing: 7) {
                        Image(systemName: "square.stack")
                            .font(.system(size: 10))
                            .foregroundStyle(OS1VisualStyle.textFaint)
                            .frame(width: 18)
                        Text("\(items.count) step\(items.count == 1 ? "" : "s") · \(label)")
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(OS1VisualStyle.textDim)
                            .lineLimit(1)
                        Spacer(minLength: 4)
                        if mediaCount > 0 {
                            Text(mediaLabel)
                                .font(.caption2)
                                .foregroundStyle(OS1VisualStyle.textFaint)
                                .fixedSize()
                        }
                        if failureCount > 0 {
                            Text("\(failureCount) failed")
                                .font(.caption2)
                                .foregroundStyle(OS1VisualStyle.red)
                                .fixedSize()
                        }
                        if isLive, items.contains(where: \.isPending) {
                            ProgressView()
                                .controlSize(.mini)
                        }
                    }
                    #if os(iOS)
                    .frame(minHeight: 44)
                    #else
                    .padding(.vertical, 2)
                    #endif
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(accessibilityLabel)
                .accessibilityHint(state.expanded ? "Hide the steps" : "Show the steps")

                if state.expanded {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(items) { item in
                            ToolCallRow(
                                item: item,
                                sessionId: sessionId,
                                worktreeDir: worktreeDir,
                                state: expansionState(item.id, false)
                            )
                        }
                    }
                    .padding(.leading, 20)
                    .transition(.opacity)
                }
            }
        } else if let item = items.first {
            ToolCallRow(
                item: item,
                sessionId: sessionId,
                worktreeDir: worktreeDir,
                state: expansionState(item.id, false)
            )
        }
    }

    private var label: String {
        var order: [String] = []
        var counts: [String: Int] = [:]
        for item in items {
            let name = item.presentation.name
            if counts[name] == nil { order.append(name) }
            counts[name, default: 0] += 1
        }
        return order.map { name in
            let count = counts[name, default: 0]
            return count > 1 ? "\(name) ×\(count)" : name
        }.joined(separator: " · ")
    }

    private var failureCount: Int { items.filter(\.isError).count }
    private var mediaCount: Int { items.reduce(0) { $0 + $1.mediaSources.count } }
    private var mediaLabel: String { "\(mediaCount) image\(mediaCount == 1 ? "" : "s")" }
    private var accessibilityLabel: String {
        var parts = ["\(items.count) grouped steps", label]
        if failureCount > 0 { parts.append("\(failureCount) failed") }
        if mediaCount > 0 { parts.append(mediaLabel) }
        if isLive, items.contains(where: \.isPending) { parts.append("running") }
        return parts.joined(separator: ", ")
    }
}

/// Consecutive edits to one file, folded into a single row: the path once,
/// the summed ± lines, and a count.
///
/// Four passes over the same file are one change to a reader, and four rows
/// repeating the same path push the rest of the turn off a phone screen. The
/// row keeps the shape of the single edit it stands in for — same glyph, same
/// name, same dimmed path — so a folded run reads as one more edit rather
/// than as a new kind of row. Every individual call, with its own diff, is
/// one tap inside.
private struct EditRunView: View {
    let items: [ToolCallItem]
    let sessionId: String
    var worktreeDir: String?
    let state: TurnFoldState
    let isLive: Bool
    let expansionState: (String, Bool) -> TurnFoldState

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                withAnimation(.snappy(duration: 0.2, extraBounce: 0)) {
                    state.toggle()
                }
            } label: {
                header
            }
            .buttonStyle(.plain)
            .accessibilityLabel(accessibilityLabel)
            .accessibilityHint(state.expanded ? "Hide the edits" : "Show the edits")

            if state.expanded {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(items) { item in
                        ToolCallRow(
                            item: item,
                            sessionId: sessionId,
                            worktreeDir: worktreeDir,
                            state: expansionState(item.id, false)
                        )
                    }
                }
                .padding(.leading, 20)
                .transition(.opacity)
            }
        }
    }

    private var header: some View {
        HStack(spacing: 7) {
            Image(systemName: state.expanded ? "chevron.down" : presentation.family.symbol)
                .font(.system(size: 11))
                .foregroundStyle(
                    failureCount > 0 ? OS1VisualStyle.red : OS1VisualStyle.textFaint
                )
                .frame(width: 15)

            Text(presentation.name)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(OS1VisualStyle.textDim)
                .fixedSize()

            ToolSummaryText(
                summary: presentation.summary,
                isPath: presentation.summaryIsPath
            )

            // The count belongs to the path it multiplies, so it travels with
            // it rather than sitting out with the trailing meta.
            Text("×\(items.count)")
                .font(.caption2)
                .foregroundStyle(OS1VisualStyle.textFaint)
                .fixedSize()

            Spacer(minLength: 4)

            if !stats.isEmpty {
                LineStatsView(stats: stats)
            }
            if failureCount > 0 {
                Text("\(failureCount) failed")
                    .font(.caption2)
                    .foregroundStyle(OS1VisualStyle.red)
                    .fixedSize()
            }
            if isLive, items.contains(where: \.isPending) {
                ProgressView()
                    .controlSize(.mini)
            }
        }
        #if os(iOS)
        .frame(minHeight: 44)
        #else
        .padding(.vertical, 2)
        #endif
        .contentShape(Rectangle())
    }

    private var presentation: ToolPresentation { items[0].presentation }

    /// Summed from what the rows themselves show, so opening the run adds up
    /// to the counts that were on it.
    private var stats: ToolLineStats {
        items.reduce(ToolLineStats()) { $0 + ($1.presentation.lineStats ?? ToolLineStats()) }
    }

    private var failureCount: Int { items.filter(\.isError).count }

    private var accessibilityLabel: String {
        var parts = ["\(items.count) \(presentation.name) steps", presentation.summary]
        if failureCount > 0 { parts.append("\(failureCount) failed") }
        return parts.filter { !$0.isEmpty }.joined(separator: ", ")
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
    /// Whose scratch folder the asset chips open into.
    let sessionId: String

    /// How many chips a footer draws before it points at the whole list
    /// instead. A refactor can touch thirty files, and thirty wrapped chips
    /// would bury the answer they belong to.
    private static let chipLimit = 8

    /// Assets come first and are never cut. A touched file is named in the
    /// Changes list too, so the chip is a shortcut; a scratch file the turn
    /// wrote is named nowhere else in the transcript, so the chip is the
    /// only way to it.
    private var shownFiles: [TouchedFile] {
        Array(footer.files.prefix(max(0, Self.chipLimit - footer.assets.count)))
    }

    private var hiddenFileCount: Int {
        footer.files.count - shownFiles.count
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            if hasMeta {
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

                    Spacer(minLength: 0)
                }
            }

            if !footer.files.isEmpty || !footer.assets.isEmpty {
                // Wrapped, not scrolled: a strip inside the transcript fights
                // the vertical drag for the same gesture and hides its
                // overflow behind an edge with nothing to say it's there, so
                // the third chip onward simply wasn't reachable. Assets and
                // edits sit together because both are things the turn
                // produced, and both open what they name rather than just
                // labelling it.
                FlowLayout(spacing: 6) {
                    ForEach(footer.assets, id: \.self) { path in
                        AssetChipView(sessionId: sessionId, path: path)
                    }
                    ForEach(shownFiles) { file in
                        FileChipView(file: file)
                    }
                    if hiddenFileCount > 0 {
                        MoreFilesChipView(
                            sessionId: sessionId,
                            count: hiddenFileCount
                        )
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.top, 1)
        .padding(.bottom, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var hasMeta: Bool {
        if footer.duration != nil { return true }
        if let model = footer.model, !model.isEmpty { return true }
        return false
    }
}

/// The files the footer didn't have room to name, as one chip that opens all
/// of them. A cut that admits how much it cut and where the rest went.
struct MoreFilesChipView: View {
    let sessionId: String
    let count: Int

    @Environment(\.openPanel) private var openPanel

    var body: some View {
        Button {
            openPanel(.changes(sessionId: sessionId))
        } label: {
            Text("+\(count) more")
                .font(.caption2)
                .foregroundStyle(OS1VisualStyle.textDim)
                .padding(.horizontal, 7)
                .padding(.vertical, 3)
                .background(
                    OS1VisualStyle.panel,
                    in: RoundedRectangle(cornerRadius: 6, style: .continuous)
                )
        }
        .buttonStyle(.plain)
        // The Mac app installs no handler; a chip that does nothing when
        // tapped is worse than one that plainly can't be.
        .disabled(!openPanel.isAvailable)
        .accessibilityLabel("\(count) more files")
        .accessibilityHint("Opens everything this session changed")
    }
}

/// One touched file: a colored extension badge, the basename, and its ±.
/// Tapping opens what actually changed — on a phone the chips are the only
/// place a turn's edits are named, and a name without a diff is a dead end.
struct FileChipView: View {
    let file: TouchedFile
    @State private var showingDiff = false

    var body: some View {
        Button {
            guard !file.hunks.isEmpty else { return }
            showingDiff = true
        } label: {
            chip
        }
        .buttonStyle(.plain)
        .disabled(file.hunks.isEmpty)
        .sheet(isPresented: $showingDiff) {
            FileDiffSheet(file: file)
        }
    }

    private var chip: some View {
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
    static func color(for ext: String) -> Color {
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

/// One scratch file the turn wrote: the kind's glyph and the file's name.
///
/// Tapping opens the file itself, the same way the tool row's chip does — a
/// picture over the conversation, anything else one level deeper (see
/// `AssetOpen`) — so an artifact can be checked where it was announced instead
/// of hunted for in the Assets tab. Assets live outside every worktree, so
/// unlike a touched file there is no diff to show and nothing else in the app
/// knows what the path means.
struct AssetChipView: View {
    let sessionId: String
    let path: String

    @Environment(\.openPanel) private var openPanel
    /// The file this chip lifted over the conversation.
    @State private var assetOverlay: AssetOverlayItem?

    private var asset: OS1API.SessionAsset {
        OS1API.SessionAsset(path: path, size: 0, mtime: "")
    }

    var body: some View {
        Button {
            AssetOpen.open(
                sessionId: sessionId,
                path: path,
                overlay: $assetOverlay
            )
        } label: {
            chip
        }
        .buttonStyle(.plain)
        // The Mac app can open neither kind; a chip that does nothing when
        // tapped is worse than one that plainly can't be.
        .disabled(!AssetOpen.canOpen(path))
        .assetOverlayPreview($assetOverlay, openPanel: openPanel)
        .accessibilityLabel(Text(verbatim: asset.name))
        .accessibilityHint("Opens this file")
    }

    private var chip: some View {
        HStack(spacing: 5) {
            Image(systemName: AssetKind.of(asset).symbol)
                .font(.system(size: 9))
                .foregroundStyle(OS1VisualStyle.textFaint)
                .frame(minWidth: 12)
            Text(asset.name)
                .font(.caption2)
                .foregroundStyle(OS1VisualStyle.textDim)
                .lineLimit(1)
        }
        .padding(.leading, 6)
        .padding(.trailing, 7)
        .padding(.vertical, 3)
        .background(
            OS1VisualStyle.panel,
            in: RoundedRectangle(cornerRadius: 6, style: .continuous)
        )
        .accessibilityElement(children: .combine)
    }
}

/// What one file's edits did, reusing the tool row's diff rendering so a chip
/// preview and the Edit call it came from never disagree.
struct FileDiffSheet: View {
    let file: TouchedFile
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(spacing: 6) {
                        Text(file.path)
                            .font(.system(.caption, design: .monospaced))
                            .foregroundStyle(OS1VisualStyle.textDim)
                            .textSelection(.enabled)
                        Spacer(minLength: 8)
                        LineStatsView(
                            stats: ToolLineStats(
                                additions: file.additions,
                                deletions: file.deletions
                            )
                        )
                    }
                    ForEach(Array(file.hunks.enumerated()), id: \.offset) { index, hunk in
                        ToolCodeBox(label: file.hunks.count > 1 ? "Change \(index + 1)" : "Diff") {
                            DiffText(patch: hunk)
                        }
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .background(OS1VisualStyle.background.ignoresSafeArea())
            .navigationTitle(file.basename)
            .inlineTitleBarCompat()
            .toolbar {
                ToolbarItem(placement: .topTrailingCompat) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}
