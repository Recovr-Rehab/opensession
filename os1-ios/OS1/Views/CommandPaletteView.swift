import SwiftUI

#if os(macOS)
import AppKit

/// A palette row and what selecting it does.
struct CommandPaletteItem: Identifiable {
    let entry: CommandPaletteEntry
    let run: () -> Void

    var id: String { entry.id }
}

/// Command-K on the Mac: type a few letters, land on a session or run a
/// command.
///
/// The Mac window is a sidebar and a session. Everything else it can reach —
/// the Desk, the support queue, archived sessions, settings — is a button in
/// the sidebar header or a menu item, and the sessions themselves are a list
/// long enough that finding one is a scroll. The palette is the one control
/// that reaches all of it from the keyboard.
///
/// Its rows are this app's own data, not a copy of the web palette's list. A
/// destination the native app does not have (Notes, Tasks, Reports, Catch up,
/// the session panels the iPhone pushes) gets no row: an entry that opens
/// nothing is worse than an entry that isn't there.
///
/// A floating panel rather than a sheet, for a reason beyond looks: several
/// rows open a sheet of their own, and a sheet that has to finish dismissing
/// before the next one can present turns "New session" into a dropped click.
struct CommandPaletteView: View {
    let items: [CommandPaletteItem]
    let onRun: (CommandPaletteItem) -> Void
    let onClose: () -> Void

    @State private var query = ""
    @State private var selectedID: String?
    @State private var keyMonitor: Any?
    @FocusState private var fieldFocused: Bool

    private var results: [CommandPaletteEntry] {
        CommandPaletteRanking.results(items.map(\.entry), query: query)
    }

    var body: some View {
        VStack(spacing: 0) {
            field
            Divider()
            if results.isEmpty {
                empty
            } else {
                list
            }
            Divider()
            footer
        }
        .frame(width: 620, height: 460)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(OS1VisualStyle.border, lineWidth: 0.5)
        )
        .shadow(color: .black.opacity(0.28), radius: 30, y: 12)
        .onAppear { installKeyMonitor() }
        .onDisappear { removeKeyMonitor() }
        .task {
            // The field is inside a view that appears in the same frame the
            // overlay does; focus set in `onAppear` lands before the field
            // exists and is silently dropped.
            try? await Task.sleep(for: .milliseconds(40))
            fieldFocused = true
        }
    }

    private var field: some View {
        HStack(spacing: 9) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 15))
                .foregroundStyle(OS1VisualStyle.textFaint)
            TextField("Search sessions and commands", text: $query)
                .textFieldStyle(.plain)
                .font(.system(size: 17))
                .focused($fieldFocused)
                // Return is handled by the key monitor, which runs the
                // selected row rather than whatever submit would mean here.
                .onSubmit {}
        }
        .padding(.horizontal, 16)
        .frame(height: 50)
    }

    private var list: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 2) {
                    ForEach(results) { entry in
                        CommandPaletteRow(
                            entry: entry,
                            selected: entry.id == selectionID
                        )
                        .id(entry.id)
                        .contentShape(Rectangle())
                        .onTapGesture { activate(entry.id) }
                        .onHover { inside in
                            if inside { selectedID = entry.id }
                        }
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 8)
            }
            .onChange(of: selectionID) { _, id in
                guard let id else { return }
                proxy.scrollTo(id, anchor: .center)
            }
        }
    }

    private var empty: some View {
        VStack {
            Spacer()
            Text("No matches")
                .font(.system(size: 13))
                .foregroundStyle(OS1VisualStyle.textDim)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    /// The keys this window is listening for, said once at the bottom instead
    /// of on every row.
    private var footer: some View {
        HStack(spacing: 12) {
            hint("↑↓", "Move")
            hint("↩", "Open")
            hint("esc", "Close")
            Spacer()
        }
        .padding(.horizontal, 14)
        .frame(height: 30)
    }

    private func hint(_ keys: String, _ label: String) -> some View {
        HStack(spacing: 5) {
            KeyCap(text: keys, selected: false)
            Text(label)
                .font(.system(size: 11))
                .foregroundStyle(OS1VisualStyle.textFaint)
        }
    }

    /// The highlighted row: whatever the arrows last landed on, or the first
    /// result — a query that drops the selected row must not leave Return
    /// pointing at nothing.
    private var selectionID: String? {
        if let selectedID, results.contains(where: { $0.id == selectedID }) {
            return selectedID
        }
        return results.first?.id
    }

    private func activate(_ id: String) {
        guard let item = items.first(where: { $0.id == id }) else { return }
        onRun(item)
    }

    private func move(_ offset: Int) {
        let rows = results
        guard !rows.isEmpty else { return }
        let current = rows.firstIndex { $0.id == selectionID } ?? 0
        let next = min(max(current + offset, 0), rows.count - 1)
        selectedID = rows[next].id
    }

    /// Arrow keys and Return belong to the list, but focus is in the text
    /// field, which eats both. A local monitor is how this app already reads
    /// keys out from under a focused field (see the composer's Shift-Return
    /// handling) — it sees the event first and consumes what it uses.
    private func installKeyMonitor() {
        guard keyMonitor == nil else { return }
        keyMonitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            MainActor.assumeIsolated {
                let mods = event.modifierFlags
                    .intersection(.deviceIndependentFlagsMask)
                    .subtracting(.capsLock)
                guard mods.isEmpty else { return event }
                switch event.keyCode {
                case 125: move(1); return nil
                case 126: move(-1); return nil
                case 36, 76:
                    if let selectionID { activate(selectionID) }
                    return nil
                case 53: onClose(); return nil
                default: return event
                }
            }
        }
    }

    private func removeKeyMonitor() {
        if let keyMonitor {
            NSEvent.removeMonitor(keyMonitor)
            self.keyMonitor = nil
        }
    }
}

private struct CommandPaletteRow: View {
    let entry: CommandPaletteEntry
    let selected: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: entry.symbol)
                .font(.system(size: 14))
                .frame(width: 18)
                .foregroundStyle(selected ? Color.white : OS1VisualStyle.textDim)
            VStack(alignment: .leading, spacing: 1) {
                Text(verbatim: entry.title)
                    .font(.system(size: 13))
                    .foregroundStyle(selected ? Color.white : OS1VisualStyle.text)
                    .lineLimit(1)
                if let subtitle = entry.subtitle, !subtitle.isEmpty {
                    Text(verbatim: subtitle)
                        .font(.system(size: 11))
                        .foregroundStyle(
                            selected
                                ? Color.white.opacity(0.75)
                                : OS1VisualStyle.textFaint
                        )
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            ForEach(Array(entry.shortcut.enumerated()), id: \.offset) { _, key in
                KeyCap(text: key, selected: selected)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background {
            if selected {
                RoundedRectangle(cornerRadius: 7)
                    .fill(Color(nsColor: .selectedContentBackgroundColor))
            }
        }
    }
}

/// One key, drawn as a cap. Keeps its contrast on a selected row, where the
/// dim border and dim ink both disappear into the accent fill.
private struct KeyCap: View {
    let text: String
    let selected: Bool

    var body: some View {
        Text(verbatim: text)
            .font(.system(size: 11, weight: .medium))
            .foregroundStyle(selected ? Color.white : OS1VisualStyle.textDim)
            .frame(minWidth: 18)
            .padding(.horizontal, 4)
            .padding(.vertical, 2)
            .background {
                RoundedRectangle(cornerRadius: 4)
                    .fill(
                        selected
                            ? Color.white.opacity(0.22)
                            : OS1VisualStyle.hover
                    )
            }
    }
}

#endif
