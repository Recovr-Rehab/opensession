import { describe, expect, test } from "bun:test";
import { buildRunInstructions } from "./run-instructions";

describe("buildRunInstructions", () => {
  test("keeps a standard interactive prompt minimal", () => {
    const prompt = buildRunInstructions({
      isAsk: false,
      osSessionId: "os-test",
      inProcessMcp: {
        "opensession-sessions": {},
        "opensession-portals": {},
      },
    });

    expect(prompt.match(/^## .+$/gm)).toEqual([
      "## Data handling",
      "## Finish your turns",
      "## References",
      "## PR attribution",
      "## New sessions",
      "## Preview links",
      "## Media",
    ]);
    expect(prompt).toContain(
      "For PRs outside the current primary repository, write `<repo>#<number>`, never bare `#<number>`.",
    );
    expect(prompt).toContain(
      "Set the exact root-relative route, including its query string, so Preview and staging links open the feature you changed.",
    );
    expect(prompt.length).toBeLessThan(900);
  });
});
