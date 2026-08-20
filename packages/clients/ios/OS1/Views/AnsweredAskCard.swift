import SwiftUI

/// A durable receipt for an answer sent through `AskQuestionCard`. It keeps the
/// question and exact answer in the transcript, while dropping the unpicked
/// options that only mattered during the decision.
struct AnsweredAskCard: View {
    let ask: AnsweredAsk

    private var loneQuestion: AnsweredAsk.Question? {
        ask.questions.count == 1 ? ask.questions.first : nil
    }

    private var cardShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header

            ForEach(Array(ask.questions.enumerated()), id: \.offset) { _, question in
                questionReceipt(question)
            }
        }
        .padding(14)
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

            if let topic = loneQuestion?.header, !topic.isEmpty {
                Text("·")
                    .foregroundStyle(OS1VisualStyle.textFaint)
                Text(topic)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(OS1VisualStyle.textFaint)
            }
        }
    }

    private func questionReceipt(_ question: AnsweredAsk.Question) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 3) {
                if loneQuestion == nil,
                   let header = question.header,
                   !header.isEmpty {
                    Text(header)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(OS1VisualStyle.textFaint)
                }
                Text(question.question)
                    .font(.footnote)
                    .foregroundStyle(OS1VisualStyle.textDim)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Text(question.answer.isEmpty ? "No answer" : question.answer)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(OS1VisualStyle.text)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(
                    OS1VisualStyle.hover,
                    in: RoundedRectangle(cornerRadius: 7, style: .continuous)
                )
        }
        .accessibilityElement(children: .combine)
    }
}
