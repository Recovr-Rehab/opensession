import { describe, expect, it } from "bun:test";
import { firstMentions } from "./commit-sessions";

const SHA = "ad85e5d51c76de8fd66fea6f9f1c777f1d174910";
const at = Date.parse("2026-08-15T17:37:00Z");
const wanted = new Map([[SHA.slice(0, 7), { sha: SHA, at }]]);

const row = (
  session: string,
  offsetMs: number,
  data: string,
): { session: string; ts: number; data: string } => ({
  session,
  ts: at + offsetMs,
  data,
});

describe("firstMentions", () => {
  it("credits the session that said the sha first", () => {
    // Everyone in a shared checkout sees the sha once they run `git log`. The
    // one that made it is the one that saw it the moment it landed.
    const found = firstMentions(
      [
        row("os-reader", 60_000, `commit ${SHA}\nAuthor: Michiel`),
        row("os-maker", 500, `[main ad85e5d5] Ask card\n 4 files changed`),
      ],
      wanted,
    );
    expect(found.get(SHA)?.session).toBe("os-maker");
  });

  it("ignores a mention far from the commit", () => {
    expect(firstMentions([row("os-later", 3_600_000, SHA)], wanted).size).toBe(0);
  });

  it("does not read a uuid's hex as a sha it happens to start like", () => {
    // Split by its dashes, a uuid offers exactly the kind of bounded hex run a
    // short sha is, so a prefix match alone would credit the wrong session.
    const uuid = `${SHA.slice(0, 8)}9-0000-4000-8000-000000000000`;
    expect(firstMentions([row("os-noise", 0, uuid)], wanted).size).toBe(0);
  });

  it("reads an abbreviation and a full sha as the same commit", () => {
    for (const text of ["[main ad85e5d5] Ask card", SHA, "reverts `ad85e5d`"]) {
      expect(firstMentions([row("os-maker", 0, text)], wanted).get(SHA)?.session).toBe(
        "os-maker",
      );
    }
  });

  it("keeps the earliest mention when one session says it twice", () => {
    const found = firstMentions(
      [row("os-maker", 5_000, SHA), row("os-maker", 100, SHA)],
      wanted,
    );
    expect(found.get(SHA)?.ts).toBe(at + 100);
  });
});
