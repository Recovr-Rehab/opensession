import React, { useEffect, useRef, useState } from "react";

/**
 * Turn-level windowing with measured placeholders. Recent turns stay mounted;
 * older settled turns render within a 1.5-viewport overscan and preserve their
 * exact measured height outside it, so scroll anchors remain stable.
 */
export const VirtualTranscriptBlock = React.memo(function VirtualTranscriptBlock({
	children,
	enabled,
	anchorId,
}: {
	children: React.ReactNode;
	enabled: boolean;
	anchorId: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(true);
	const heightRef = useRef(96);

	useEffect(() => {
		const node = ref.current;
		if (!node || !enabled || typeof IntersectionObserver === "undefined") {
			setVisible(true);
			return;
		}
		const root = node.closest(".viewer-messages");
		const resize = new ResizeObserver(([entry]) => {
			if (entry?.contentRect.height) heightRef.current = entry.contentRect.height;
		});
		resize.observe(node);
		const intersection = new IntersectionObserver(
			([entry]) => setVisible(Boolean(entry?.isIntersecting)),
			{ root, rootMargin: "150% 0px" },
		);
		intersection.observe(node);
		return () => {
			resize.disconnect();
			intersection.disconnect();
		};
	}, [enabled]);

	if (enabled && !visible) {
		return (
			<div
				ref={ref}
				className="transcript-window pointer-events-none"
				data-eid={anchorId}
				aria-hidden
				style={{ height: heightRef.current }}
			/>
		);
	}

	return (
		<div
			ref={ref}
			className={
				enabled
					? // Settled turns get skipped during layout/paint while off-screen,
					  // at their measured height. `transcript-window` stays as a bare
					  // hook: it carries no rules, but TurnFooter's quiet actions key
					  // off hovering this element or the answer window before it.
					  "transcript-window [content-visibility:auto] [contain-intrinsic-size:auto_96px]"
					: "transcript-window"
			}
		>
			{children}
		</div>
	);
});
