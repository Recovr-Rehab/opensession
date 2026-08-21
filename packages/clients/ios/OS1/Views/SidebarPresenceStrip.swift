import SwiftUI
#if os(iOS)

/// Who is around, and how you narrow a list to one of them.
///
/// The web puts this row of faces at the top of the Feed and turns the sidebar
/// to whoever you pick (`components/Feed.tsx`). The phone had neither half: the
/// sessions list could only reach a teammate through the filter sheet, and
/// nothing on it said who was actually here. This is both halves in one strip.
///
/// A face carries presence the way the web's chip does — a dot in the corner,
/// green while that person has something open right now, drawn as a gap in the
/// picture rather than a mark on it. `PresenceStore` is `@Observable`, so a
/// frame landing repaints the strip and nothing else.
struct SidebarPresenceStrip: View {
    /// The person key this strip sets. The sessions list hands it the account
    /// lens; the Feed hands it its own local scope, because that screen is
    /// pushed over the list rather than beside it.
    @Binding var person: String
    /// Whoever is signed in, so "you" is one row rather than two spellings.
    let currentUser: String

    private var presence: PresenceStore { PresenceStore.shared }

    /// You first, then whoever is here, then the rest of the roster in its own
    /// order. Presence is the sort because the strip's job is to say who is
    /// around; a name that never moves reads as furniture wherever it sits.
    private var teammates: [String] {
        TeamDirectory.shared.names
            .filter { !SidebarPersonLens.nameMatches($0, key: currentUser) }
            .enumerated()
            .sorted { lhs, rhs in
                let left = presence.isPresent(lhs.element)
                let right = presence.isPresent(rhs.element)
                if left != right { return left }
                return lhs.offset < rhs.offset
            }
            .map(\.element)
    }

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 10) {
                everyoneChip
                if !currentUser.isEmpty {
                    chip(
                        name: currentUser,
                        key: SidebarPersonLens.me,
                        label: "You",
                        present: true
                    )
                }
                ForEach(teammates, id: \.self) { name in
                    chip(
                        name: name,
                        key: name.lowercased(),
                        label: name,
                        present: presence.isPresent(name)
                    )
                }
            }
            // The strip bleeds to the screen edge and pads itself, so a face
            // scrolled to the end sits on the list's own margin rather than
            // stopping short of it.
            .padding(.horizontal, 16)
            .padding(.vertical, 2)
        }
        .scrollIndicators(.hidden)
        .task { await TeamDirectory.shared.ensureLoaded() }
    }

    private var everyoneChip: some View {
        let selected = person == SidebarPersonLens.everyone
        return Button {
            pick(SidebarPersonLens.everyone)
        } label: {
            Image(systemName: "person.2")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(selected ? OS1VisualStyle.onAccent : OS1VisualStyle.textDim)
                .frame(width: faceSize, height: faceSize)
                .background(
                    Circle().fill(selected ? OS1VisualStyle.accent : OS1VisualStyle.hover)
                )
                .ring(selected: selected)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(selected ? "Everyone, selected" : "Everyone")
    }

    private func chip(
        name: String,
        key: String,
        label: String,
        present: Bool
    ) -> some View {
        let selected = person == key
        return Button {
            pick(key)
        } label: {
            UserAvatar(person: name, size: faceSize)
                .ring(selected: selected)
                .overlay(alignment: .bottomTrailing) {
                    if present {
                        // Ringed in the list's own canvas so it reads as a
                        // hole punched in the face, the way the web's
                        // StatusDot does against its chip fill.
                        Circle()
                            .fill(OS1VisualStyle.green)
                            .frame(width: 9, height: 9)
                            .background(
                                Circle()
                                    .fill(OS1VisualStyle.background)
                                    .frame(width: 13, height: 13)
                            )
                            .offset(x: 1, y: 1)
                    }
                }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(accessibilityLabel(label, present: present, selected: selected))
    }

    private func accessibilityLabel(
        _ label: String,
        present: Bool,
        selected: Bool
    ) -> String {
        var parts = [label]
        if present { parts.append("here now") }
        if selected { parts.append("selected") }
        return parts.joined(separator: ", ")
    }

    /// Tapping the person you are already on clears back to everyone, so the
    /// strip is its own undo and never strands a list you cannot widen.
    private func pick(_ key: String) {
        Haptics.play(.selection)
        withAnimation(.snappy(duration: 0.22)) {
            person = person == key && key != SidebarPersonLens.everyone
                ? SidebarPersonLens.everyone
                : key
        }
    }

    private let faceSize: CGFloat = 34
}

private extension View {
    /// The accent ring a picked face wears. Struck outside the avatar rather
    /// than on it, so the picture keeps its full size whether or not it is
    /// the one selected and the strip never shifts when you tap along it.
    func ring(selected: Bool) -> some View {
        overlay {
            if selected {
                Circle()
                    .strokeBorder(OS1VisualStyle.accent, lineWidth: 2)
                    .padding(-3)
            }
        }
    }
}
#endif
