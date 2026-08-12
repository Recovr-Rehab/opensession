import { afterEach, describe, expect, test } from "bun:test";
import { postSlackBlocks, slackFileRefs, updateSlackBlocks } from "./slack-api";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("slackFileRefs", () => {
  test("maps Slack file objects to small refs", () => {
    const refs = slackFileRefs([
      {
        id: "F123",
        name: "shot.png",
        mimetype: "image/png",
        url_private_download: "https://files.slack.com/dl/shot.png",
        url_private: "https://files.slack.com/shot.png",
        size: 1234,
      },
    ]);
    expect(refs).toEqual([
      {
        id: "F123",
        name: "shot.png",
        mimetype: "image/png",
        url: "https://files.slack.com/dl/shot.png",
        size: 1234,
      },
    ]);
  });

  test("falls back to url_private and drops entries with no URL", () => {
    const refs = slackFileRefs([
      { id: "F1", name: "a.pdf", mimetype: "application/pdf", url_private: "https://x/a.pdf" },
      { id: "F2", name: "tombstone" },
      null,
    ]);
    expect(refs.map((r) => r.id)).toEqual(["F1"]);
    expect(refs[0]!.url).toBe("https://x/a.pdf");
    expect(refs[0]!.size).toBe(0);
  });

  test("handles undefined", () => {
    expect(slackFileRefs(undefined)).toEqual([]);
  });
});

describe("Slack block message options", () => {
  test("disables unfurls when posting a progress card", async () => {
    let payload: any;
    globalThis.fetch = (async (_input, init) => {
      payload = JSON.parse(String(init?.body));
      return Response.json({ ok: true, ts: "123.456" });
    }) as typeof fetch;

    await postSlackBlocks("C123", "fallback", [], "111.222", {
      unfurlLinks: false,
      unfurlMedia: false,
    });

    expect(payload).toMatchObject({
      channel: "C123",
      thread_ts: "111.222",
      unfurl_links: false,
      unfurl_media: false,
    });
  });

  test("keeps unfurls disabled when updating a progress card", async () => {
    let payload: any;
    globalThis.fetch = (async (_input, init) => {
      payload = JSON.parse(String(init?.body));
      return Response.json({ ok: true });
    }) as typeof fetch;

    await updateSlackBlocks("C123", "123.456", "Working", [], {
      unfurlLinks: false,
      unfurlMedia: false,
    });

    expect(payload).toMatchObject({
      channel: "C123",
      ts: "123.456",
      unfurl_links: false,
      unfurl_media: false,
    });
  });
});
