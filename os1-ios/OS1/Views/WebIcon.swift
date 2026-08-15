import SwiftUI

/// The same 24-point icon geometry used by the web client's iconic-pro set.
/// Keeping these paths shared in spirit avoids mismatched SF Symbol metaphors
/// for product-specific states such as pull requests and merges.
enum WebIconKind {
    case search
    case filter
    case pullRequest
    case gitMerge
    case archive
    case unarchive
    /// A document. Ported from the web's `IconFile`, which is what its
    /// Reports tool wears: the row and the sidebar entry lead to the same
    /// documents, so they should not be drawn from two different sets.
    case file
    /// Machine-owned session (an automation run). Ported from the web's
    /// `IconRobot`, because SF Symbols has no robot: the only match is
    /// `robotic.vacuum`, and the row's other identity glyphs are this set
    /// already.
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
            case .filter:
                var bars = Path()
                bars.addRoundedRect(in: rect(4, 6, 16, 1.5), cornerSize: CGSize(width: 0.75, height: 0.75))
                bars.addRoundedRect(in: rect(6, 11.25, 12, 1.5), cornerSize: CGSize(width: 0.75, height: 0.75))
                bars.addRoundedRect(in: rect(8, 16.5, 8, 1.5), cornerSize: CGSize(width: 0.75, height: 0.75))
                context.fill(bars, with: .color(color))
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
            default:
                var path = Path()
                switch kind {
                case .search:
                    path.addEllipse(in: rect(4.75, 4.75, 11.5, 11.5))
                    path.move(to: point(14.85, 14.85))
                    path.addLine(to: point(18.75, 18.75))
                case .pullRequest:
                    addCircle(to: &path, center: point(7, 6.5), radius: 1.75 * scale)
                    addCircle(to: &path, center: point(7, 17.5), radius: 1.75 * scale)
                    addCircle(to: &path, center: point(17, 17.5), radius: 1.75 * scale)
                    path.move(to: point(7, 8.25))
                    path.addLine(to: point(7, 15.75))
                    path.move(to: point(12.25, 6.5))
                    path.addLine(to: point(15, 6.5))
                    path.addCurve(
                        to: point(17, 8.5),
                        control1: point(16.105, 6.5),
                        control2: point(17, 7.395)
                    )
                    path.addLine(to: point(17, 15.75))
                case .gitMerge:
                    addCircle(to: &path, center: point(7, 6.5), radius: 1.75 * scale)
                    addCircle(to: &path, center: point(7, 17.5), radius: 1.75 * scale)
                    addCircle(to: &path, center: point(17, 13), radius: 1.75 * scale)
                    path.move(to: point(7, 8.25))
                    path.addLine(to: point(7, 15.75))
                    path.move(to: point(7, 9))
                    path.addCurve(
                        to: point(15.25, 13),
                        control1: point(7, 11.5),
                        control2: point(10, 13)
                    )
                case .archive:
                    path.addRoundedRect(
                        in: rect(4, 4.75, 16, 4),
                        cornerSize: CGSize(width: scale, height: scale)
                    )
                    path.move(to: point(5.5, 8.75))
                    path.addLine(to: point(5.5, 17.25))
                    path.addCurve(
                        to: point(7.5, 19.25),
                        control1: point(5.5, 18.355),
                        control2: point(6.395, 19.25)
                    )
                    path.addLine(to: point(16.5, 19.25))
                    path.addCurve(
                        to: point(18.5, 17.25),
                        control1: point(17.605, 19.25),
                        control2: point(18.5, 18.355)
                    )
                    path.addLine(to: point(18.5, 8.75))
                    path.move(to: point(10, 12.25))
                    path.addLine(to: point(14, 12.25))
                case .unarchive:
                    path.addRoundedRect(
                        in: rect(4, 4.75, 16, 4),
                        cornerSize: CGSize(width: scale, height: scale)
                    )
                    path.move(to: point(5.5, 8.75))
                    path.addLine(to: point(5.5, 17.25))
                    path.addCurve(
                        to: point(7.5, 19.25),
                        control1: point(5.5, 18.355),
                        control2: point(6.395, 19.25)
                    )
                    path.addLine(to: point(16.5, 19.25))
                    path.addCurve(
                        to: point(18.5, 17.25),
                        control1: point(17.605, 19.25),
                        control2: point(18.5, 18.355)
                    )
                    path.addLine(to: point(18.5, 8.75))
                    path.move(to: point(12, 16.25))
                    path.addLine(to: point(12, 11.75))
                    path.move(to: point(9.75, 14))
                    path.addLine(to: point(12, 11.75))
                    path.addLine(to: point(14.25, 14))
                case .file:
                    // Page with the corner cut away, then the fold itself.
                    path.move(to: point(7.75, 19.25))
                    path.addLine(to: point(16.25, 19.25))
                    path.addCurve(
                        to: point(18.25, 17.25),
                        control1: point(17.355, 19.25),
                        control2: point(18.25, 18.355)
                    )
                    path.addLine(to: point(18.25, 9))
                    path.addLine(to: point(14, 4.75))
                    path.addLine(to: point(7.75, 4.75))
                    path.addCurve(
                        to: point(5.75, 6.75),
                        control1: point(6.645, 4.75),
                        control2: point(5.75, 5.645)
                    )
                    path.addLine(to: point(5.75, 17.25))
                    path.addCurve(
                        to: point(7.75, 19.25),
                        control1: point(5.75, 18.355),
                        control2: point(6.645, 19.25)
                    )
                    path.move(to: point(18, 9.25))
                    path.addLine(to: point(13.75, 9.25))
                    path.addLine(to: point(13.75, 5))
                case .filter, .robot:
                    break
                }
                context.stroke(path, with: .color(color), style: stroke)
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
