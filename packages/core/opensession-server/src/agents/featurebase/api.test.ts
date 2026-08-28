import { describe, expect, it } from "bun:test";
import { isTerminalStatusType, normalizePost, normalizeTicket, ticketPathId } from "./api";

describe("normalizeTicket", () => {
  it("flattens a Featurebase ticket into the UI shape", () => {
    const ticket = normalizeTicket({
      id: "t1",
      ticketNumber: 42,
      title: "Login broken",
      content: "<p>Cannot sign in</p>",
      ticketUrl: "https://feedback.example/t/42",
      open: true,
      status: { id: "s1", name: "In Review", color: "Yellow", type: "reviewing" },
      author: { id: "u1", name: "Ada", email: "ada@example.com", type: "customer" },
      conversationParts: [
        {
          id: "p1",
          partType: "user_msg",
          bodyMarkdown: "Still broken",
          createdAt: "2026-08-01T00:00:00.000Z",
          author: { name: "Ada", type: "customer" },
        },
      ],
    });
    expect(ticket?.id).toBe("t1");
    expect(ticket?.ticketNumber).toBe(42);
    expect(ticket?.preview).toContain("Cannot sign in");
    expect(ticket?.status.type).toBe("reviewing");
    expect(ticket?.parts).toHaveLength(1);
    expect(ticket?.parts[0].actorType).toBe("customer");
  });

  it("returns null without an id", () => {
    expect(normalizeTicket({ title: "no id" })).toBeNull();
  });
});

describe("normalizePost", () => {
  it("flattens a feedback post", () => {
    const post = normalizePost({
      id: "p1",
      title: "Dark mode",
      content: "<p>Please add it</p>",
      boardId: "b1",
      board: { id: "b1", name: "Feature Request" },
      status: { name: "In Review", type: "reviewing" },
      upvotes: 12,
    });
    expect(post?.title).toBe("Dark mode");
    expect(post?.boardName).toBe("Feature Request");
    expect(post?.upvoteCount).toBe(12);
  });
});

describe("ticketPathId", () => {
  it("uses the numeric ticket number, not the Mongo id", () => {
    expect(ticketPathId("821")).toBe("821");
    expect(ticketPathId("6a8bba13da61e920fefee3c9", 821)).toBe("821");
    expect(() => ticketPathId("6a8bba13da61e920fefee3c9")).toThrow(/ticket number/);
  });
});

describe("isTerminalStatusType", () => {
  it("treats completed and canceled as done", () => {
    expect(isTerminalStatusType("completed")).toBe(true);
    expect(isTerminalStatusType("canceled")).toBe(true);
    expect(isTerminalStatusType("Cancelled")).toBe(true);
    expect(isTerminalStatusType("reviewing")).toBe(false);
    expect(isTerminalStatusType(null)).toBe(false);
  });
});
