import SwiftUI

/// A durable receipt for an answer sent through `AskQuestionCard`. It keeps the
/// question and exact answer in the transcript, while dropping the unpicked
/// options that only mattered during the decision.
struct AnsweredAskCard: View {
    let ask: AnsweredAsk

    private var cardShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header

            ForEach(Array(ask.questions.enumerated()), id: \.offset) { _, question in
                questionReceipt(question)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: 600, alignment: .leading)
        .background(OS1VisualStyle.flapSurface, in: cardShape)
        .overlay(cardShape.stroke(OS1VisualStyle.border, lineWidth: 0.5))
    }

    private var header: some View {
        HStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(OS1VisualStyle.green)
            Text(
                ask.questions.count == 1
                    ? "Answer sent"
                    : "\(ask.questions.count) answers sent"
            )
            .font(.footnote.weight(.semibold))
            .foregroundStyle(OS1VisualStyle.textDim)
        }
    }

    private func questionReceipt(_ question: AnsweredAsk.Question) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            if let header = question.header, !header.isEmpty {
                Text(header)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(OS1VisualStyle.textFaint)
            }
            Text(question.question)
                .font(.footnote)
                .foregroundStyle(OS1VisualStyle.textDim)
                .fixedSize(horizontal: false, vertical: true)
            Text(question.answer.isEmpty ? "No answer" : question.answer)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(OS1VisualStyle.text)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}
