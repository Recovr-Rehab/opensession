import { describe, expect, test } from "bun:test";
import {
  SIDEBAR_STICKY_LANE,
  SIDEBAR_STUCK_BACKING,
} from "../lib/sidebar-classes";

const source = await Bun.file(new URL("./Sidebar.tsx", import.meta.url)).text();

describe("sidebar sticky headings", () => {
  test("keeps the stuck marker across React className updates", () => {
    // React replaces an element's managed className on any sidebar rerender.
    // The scroll position may not change afterward, so an imperative class
    // would disappear without another scroll event to restore the backing.
    expect(source).toContain('el.hasAttribute("data-stuck")');
    expect(source).toContain('el.toggleAttribute("data-stuck", stuck)');
    expect(source).not.toContain('classList.toggle("is-stuck"');
  });

  test("keys both sticky surfaces from the persistent marker", () => {
    expect(SIDEBAR_STICKY_LANE).toContain("data-[stuck]:after");
    expect(SIDEBAR_STUCK_BACKING).toContain("data-[stuck]:before");
    expect(`${SIDEBAR_STICKY_LANE} ${SIDEBAR_STUCK_BACKING}`).not.toContain(
      "is-stuck",
    );
  });

  test("reveals keyboard-selected rows below the sticky caption", () => {
    expect(source).toContain('"desktop:scroll-pt-[var(--sidebar-cap-h)]"');
  });
});
