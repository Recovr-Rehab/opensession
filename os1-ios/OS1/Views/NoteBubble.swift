import SwiftUI

/// A team note interleaved into the transcript — a human-to-human message the
/// agent never sees. It wears a deliberate yellow tint (the web viewer's
/// choice) so it can't be mistaken for a prompt or an answer: the whole point
/// of a note is that it is addressed to people, not to the model.
struct NoteBubble: View {
    let note: SessionNote

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Text(note.user.isEmpty ? "Note" : note.user)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(OS1VisualStyle.text)
                Text("note")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(OS1VisualStyle.yellow)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(
                        OS1VisualStyle.yellow.opacity(0.16),
                        in: Capsule()
                    )
                Spacer(minLength: 4)
                Text(Self.time(note.date))
                    .font(.caption2)
                    .foregroundStyle(OS1VisualStyle.textFaint)
            }
            NoteText(text: note.text)
                .font(.callout)
                .foregroundStyle(OS1VisualStyle.text)
                .textSelection(.enabled)
            // Note attachments aren't rendered natively yet; name them rather
            // than dropping them silently, so nobody reads a note as complete
            // when it isn't.
            ForEach(note.images ?? []) { image in
                Label(image.name, systemImage: "paperclip")
                    .font(.caption)
                    .foregroundStyle(OS1VisualStyle.textDim)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(
            OS1VisualStyle.yellow.opacity(0.10),
            in: RoundedRectangle(cornerRadius: 12, style: .continuous)
        )
        .overlay(alignment: .leading) {
            // A left rule rather than a full border: it marks the block as
            // an aside without boxing it in.
            RoundedRectangle(cornerRadius: 1, style: .continuous)
                .fill(OS1VisualStyle.yellow.opacity(0.55))
                .frame(width: 2)
                .padding(.vertical, 6)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Note from \(note.user): \(note.text)")
    }

    private static func time(_ date: Date) -> String {
        let formatter = DateFormatter()
        if Calendar.current.isDateInToday(date) {
            formatter.dateFormat = "HH:mm"
        } else {
            formatter.setLocalizedDateFormatFromTemplate("MMM d HH:mm")
        }
        return formatter.string(from: date)
    }
}

/// Note text with `@Name` emphasized and bare URLs tappable — notes are short
/// plain messages, so they get this instead of the full markdown pipeline.
private struct NoteText: View {
    let text: String

    var body: some View {
        Text(attributed)
    }

    private var attributed: AttributedString {
        var result = AttributedString(text)
        let pattern = #"(@[A-Za-z][\w.-]*|https?://[^\s<>"')\]]+)"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else {
            return result
        }
        let ns = text as NSString
        for match in regex.matches(
            in: text, range: NSRange(location: 0, length: ns.length)
        ) {
            let token = ns.substring(with: match.range)
            guard let range = Range(match.range, in: text),
                  let attributedRange = Range(range, in: result)
            else { continue }
            if token.hasPrefix("@") {
                result[attributedRange].font = .callout.weight(.semibold)
            } else if let url = URL(string: token) {
                result[attributedRange].link = url
                result[attributedRange].foregroundColor = OS1VisualStyle.accent
                result[attributedRange].underlineStyle = .single
            }
        }
        return result
    }
}
