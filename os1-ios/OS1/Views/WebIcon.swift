import SwiftUI

/// The escape hatch for a glyph SF Symbols does not have.
///
/// Icons in this app are SF Symbols. That is the platform's own set, it
/// carries weight, scale and accessibility sizing for free, and it is what
/// every other iOS app draws, so a symbol reads as the system rather than as
/// our web client transplanted onto a phone. The web client is the mirror
/// image: it draws iconic-pro, because that is ITS platform convention.
/// Neither set should follow the other across.
///
/// What is left here is the case that rule cannot serve: a metaphor SF Symbols
/// has no glyph for at all. Adding a kind means having looked and found
/// nothing, not having preferred the web's drawing. It is stroked at 1.5 on a
/// 24-point grid to sit at a symbol's weight beside one.
enum WebIconKind {
    /// Machine-owned session (an automation run). SF Symbols has no robot:
    /// the nearest thing is `robotic.vacuum`, which is a floor cleaner.
    case robot
}

struct WebIcon: View {
    let kind: WebIconKind
    var size: CGFloat = 22
    var color: Color = .primary

    var body: some View {
        Canvas { context, canvasSize in
            let scale = min(canvasSize.width, canvasSize.height) / 24
            let offset = CGPoint(
                x: (canvasSize.width - 24 * scale) / 2,
                y: (canvasSize.height - 24 * scale) / 2
            )
            func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
                CGPoint(x: offset.x + x * scale, y: offset.y + y * scale)
            }
            func rect(_ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat) -> CGRect {
                CGRect(
                    x: offset.x + x * scale,
                    y: offset.y + y * scale,
                    width: width * scale,
                    height: height * scale
                )
            }
            let stroke = StrokeStyle(
                lineWidth: 1.5 * scale,
                lineCap: .round,
                lineJoin: .round
            )

            switch kind {
            case .robot:
                // Head, antenna, side ears, mouth — stroked; eyes filled. Same
                // 24-point geometry as the web's IconRobot, so a run marked as
                // automation wears the same face in both clients.
                var outline = Path()
                outline.move(to: point(12, 4.75))
                outline.addLine(to: point(12, 7.25))
                addCircle(to: &outline, center: point(12, 4.75), radius: scale)
                outline.addRoundedRect(
                    in: rect(5.25, 7.25, 13.5, 11.5),
                    cornerSize: CGSize(width: 3 * scale, height: 3 * scale)
                )
                outline.move(to: point(5.25, 11))
                outline.addLine(to: point(3.75, 11))
                outline.addLine(to: point(3.75, 15))
                outline.addLine(to: point(5.25, 15))
                outline.move(to: point(18.75, 11))
                outline.addLine(to: point(20.25, 11))
                outline.addLine(to: point(20.25, 15))
                outline.addLine(to: point(18.75, 15))
                outline.move(to: point(9.5, 15.75))
                outline.addLine(to: point(14.5, 15.75))
                context.stroke(outline, with: .color(color), style: stroke)
                var eyes = Path()
                addCircle(to: &eyes, center: point(9, 12.25), radius: scale)
                addCircle(to: &eyes, center: point(15, 12.25), radius: scale)
                context.fill(eyes, with: .color(color))
            }
        }
        .frame(width: size, height: size)
    }

    private func addCircle(to path: inout Path, center: CGPoint, radius: CGFloat) {
        path.addEllipse(
            in: CGRect(
                x: center.x - radius,
                y: center.y - radius,
                width: radius * 2,
                height: radius * 2
            )
        )
    }
}
