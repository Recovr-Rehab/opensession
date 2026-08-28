import { describe, expect, it } from "bun:test";
import { htmlToText, textToHtml } from "./html";

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
