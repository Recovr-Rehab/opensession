import SwiftUI

/// The durable, read-only form of `AskQuestionCard`: what was asked, what was
/// offered, and what was chosen, in the live card's own visual language so
/// history reads like the moment it recorded. Every input and action is gone,
/// which is what keeps history from ever looking answerable; the picked rows
/// keep their checkmark, and a typed answer gets a row of its own.
struct AnsweredAskCard: View {
    let ask: AnsweredAsk

    private var cardShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            ForEach(Array(ask.questions.enumerated()), id: \.offset) { _, question in
                let state = AnsweredAsk.state(of: question)
                prompt(question)
                ForEach(question.options ?? [], id: \.label) { option in
                    hairline
                    row(
                        label: option.label,
                        description: option.description,
                        selected: state.selected.contains(option.label)
                    )
                }
                ForEach(state.typed, id: \.self) { typed in
                    hairline
                    row(label: typed, description: "Typed answer", selected: true)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(OS1VisualStyle.flapSurface, in: cardShape)
        .overlay(cardShape.stroke(OS1VisualStyle.border, lineWidth: 0.5))
    }

    private var header: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(OS1VisualStyle.green)
                .frame(width: 6, height: 6)
            Text(
                ask.questions.count == 1
                    ? "Answered"
                    : "Answered \(ask.questions.count) questions"
            )
            .font(.footnote.weight(.semibold))
            .foregroundStyle(OS1VisualStyle.textDim)
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
    }

    private func prompt(_ question: AnsweredAsk.Question) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            if let header = question.header, !header.isEmpty {
                Text(header)
                    .font(.footnote)
                    .foregroundStyle(OS1VisualStyle.textDim)
            }
            Text(question.question)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(OS1VisualStyle.text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 13)
    }

    private func row(label: String, description: String?, selected: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(label)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(
                        selected ? OS1VisualStyle.text : OS1VisualStyle.textDim
                    )
                if let description, !description.isEmpty {
                    Text(description)
                        .font(.footnote)
                        .foregroundStyle(OS1VisualStyle.textFaint)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
            Image(systemName: "checkmark")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(OS1VisualStyle.text)
                .opacity(selected ? 1 : 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 11)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(selected ? "\(label), selected" : label)
    }

    private var hairline: some View {
        Rectangle()
            .fill(OS1VisualStyle.border.opacity(0.6))
            .frame(height: 0.5)
            .padding(.leading, 16)
    }
}
