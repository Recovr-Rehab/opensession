import { expect, test } from "bun:test";

const source = await Bun.file(
  new URL("./useSessionScroll.ts", import.meta.url),
).text();
const viewerSource = await Bun.file(
  new URL("../components/SessionViewer.tsx", import.meta.url),
).text();

test("defers resize fallback writes outside observer delivery", () => {
  expect(source).toContain("resizeFrame = requestAnimationFrame(() => {");
  expect(source).toContain(
    "if (resizeFrame) cancelAnimationFrame(resizeFrame);",
  );
  expect(source).not.toContain(
    "if (followingRef.current || pinnedRef.current) relayout();\n    });",
  );
});

test("following readers stay synchronously pinned through large transcript growth", () => {
  expect(source).toContain(
    "if (!disclosureSettleRef.current) el.scrollTop = el.scrollHeight;",
  );
  expect(source).not.toContain("startFollowGlide");
  expect(source).not.toContain("FOLLOW_GLIDE");
});

test("range hydration preserves an existing live-edge decision", () => {
  expect(viewerSource).toContain(
    "transcriptViewStore.mergeRange(msg.entries);\n          // Range hydration",
  );
  expect(viewerSource).toContain("maintainLiveEdgeAfterLayout();");
  expect(source).toContain(
    "lastGestureRef.current !== gestureAtStart ||\n        lastTouchRef.current !== touchAtStart ||\n        towardHistoryGestureRef.current",
  );
  expect(source).toContain('scrollToLatest("auto");');
});
