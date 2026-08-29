import { describe, expect, it } from "bun:test";
import {
  htmlToText,
  imagesFromHtml,
  textToHtml,
  withHtmlImages,
} from "./html";

describe("htmlToText", () => {
  it("strips tags and unescapes entities", () => {
    expect(htmlToText("<p>Hello&nbsp;<b>world</b></p>")).toBe("Hello world");
  });

  it("turns breaks into newlines", () => {
    expect(htmlToText("a<br>b")).toBe("a\nb");
  });
});

describe("textToHtml", () => {
  it("wraps paragraphs and escapes markup", () => {
    expect(textToHtml("a < b\n\nc")).toBe("<p>a &lt; b</p><p>c</p>");
  });
});

describe("imagesFromHtml", () => {
  it("reads the filename when Featurebase leaves src empty", () => {
    const html =
      '<p></p><img data-featurebase-content-filename="Screenshot.png" alt="" src=""><p></p>';
    expect(imagesFromHtml(html)).toEqual([{ src: "", name: "Screenshot.png" }]);
  });

  it("keeps a presigned src when there is one", () => {
    const html = '<img src="https://x.test/a.png?X-Amz-Signature=abc" alt="a">';
    expect(imagesFromHtml(html)).toEqual([
      { src: "https://x.test/a.png?X-Amz-Signature=abc", name: "a" },
    ]);
  });

  it("falls back to a generic name with nothing to go on", () => {
    expect(imagesFromHtml("<img src=\"\">")).toEqual([
      { src: "", name: "Attachment" },
    ]);
  });

  it("finds nothing in a body with no images", () => {
    expect(imagesFromHtml("<p>plain</p>")).toEqual([]);
  });
});

describe("withHtmlImages", () => {
  it("names an attachment the markdown left with an empty URL", () => {
    const out = withHtmlImages(
      "\n![Image]()\n",
      '<img data-featurebase-content-filename="Shot.png" src="">',
    );
    expect(out.trim()).toBe("📎 Shot.png");
  });

  it("restores a real URL when the HTML has one", () => {
    const out = withHtmlImages(
      "![Image]()",
      '<img src="https://x.test/a.png" data-featurebase-content-filename="a.png">',
    );
    expect(out).toBe("![a.png](https://x.test/a.png)");
  });

  it("separates two attachments that arrived back to back", () => {
    const out = withHtmlImages(
      "![Image]()![Image]()",
      '<img src="" data-featurebase-content-filename="one.png">' +
        '<img src="" data-featurebase-content-filename="two.png">',
    );
    expect(out).toBe("📎 one.png\n📎 two.png");
  });

  it("appends an attachment the markdown never mentioned", () => {
    const out = withHtmlImages(
      "See attached",
      '<img src="" data-featurebase-content-filename="only.png">',
    );
    expect(out).toBe("See attached\n\n📎 only.png");
  });

  it("leaves a body with no images alone", () => {
    expect(withHtmlImages("just text", "<p>just text</p>")).toBe("just text");
  });

  it("keeps a markdown image that already has a URL", () => {
    const md = "![a](https://x.test/a.png)";
    expect(withHtmlImages(md, '<img src="https://x.test/a.png" alt="a">')).toBe(
      md,
    );
  });
});
