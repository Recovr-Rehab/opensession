import SwiftUI

/// A row of capsule tabs in the session strip's idiom: the one you are on is
/// the solid, lighter pill and its siblings sit a step back, so the row reads
/// lit-one and dimmed-rest at a glance rather than by a shade of grey.
///
/// A sibling of `SessionTabBar` rather than a shared primitive. That strip is
/// a rail of open sessions: it scrolls, each pill carries an activity dot and
/// a close affordance, and it keeps the open one centred. This is the plain
/// version for a handful of fixed pages. Making one serve both would mean
/// options for everything the other does not have, and the two are already
/// close enough to read as one pattern.
struct PillTabBar<Value: Hashable>: View {
    struct Item: Identifiable {
        let value: Value
        let title: String
        var symbol: String?
        /// Shown after the title, for a page whose size is worth knowing
        /// before you go to it.
        var count: Int?

        var id: Value { value }
    }

    @Binding var selection: Value
    let items: [Item]

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var shape: Capsule { Capsule(style: .continuous) }

    var body: some View {
        HStack(spacing: 6) {
            ForEach(items) { item in
                pill(item)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.bottom, 8)
        .background(OS1VisualStyle.background)
        .overlay(alignment: .bottom) {
            Divider()
        }
    }

    private func pill(_ item: Item) -> some View {
        let active = item.value == selection
        return Button {
            guard !active else { return }
            if reduceMotion {
                selection = item.value
            } else {
                withAnimation(.snappy) { selection = item.value }
            }
            Haptics.play(.selection)
        } label: {
            HStack(spacing: 6) {
                if let symbol = item.symbol {
                    Image(systemName: symbol)
                        .font(.caption2.weight(.semibold))
                }
                Text(item.title)
                    .font(.footnote.weight(active ? .semibold : .medium))
                if let count = item.count, count > 0 {
                    Text("\(count)")
                        .font(.caption2.weight(.semibold))
                        .monospacedDigit()
                        .foregroundStyle(OS1VisualStyle.textDim)
                }
            }
            .foregroundStyle(active ? Color.accentColor : OS1VisualStyle.textDim)
            .padding(.horizontal, 12)
            .frame(minHeight: 36)
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        // Only the selected pill wears a surface. The session strip gives its
        // idle pills one too, but that strip sits on a busy transcript and
        // needs each pill separated from it; here the row sits on a plain
        // page, and a fill on every pill made the one you are ON the flattest
        // thing in the row. The tint is the accent rather than a grey step:
        // these pages have different backgrounds (the feed is light, the code
        // and the numbers sit on the tinted one), and a neutral fill would
        // disappear into one of them.
        .background {
            if active { shape.fill(Color.accentColor.opacity(0.14)) }
        }
        .accessibilityAddTraits(active ? [.isSelected, .isButton] : .isButton)
    }
}
