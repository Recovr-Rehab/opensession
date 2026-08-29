/** Strip HTML to readable text for previews, prompts, and the in-app timeline. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/p\s*>/gi, "\n")
    .replace(/<\s*\/div\s*>/gi, "\n")
    .replace(/<\s*li\s*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** One `<img>` from a Featurebase body. */
export interface HtmlImage {
  /** The presigned URL, or "" when Featurebase did not mint one. */
  src: string;
  /** The original filename, which is all we can show without a URL. */
  name: string;
}

/**
 * The images in an HTML body, in document order.
 *
 * Featurebase signs attachment URLs in conversation PARTS but not in a
 * conversation's `source`: there the `<img>` carries `src=""` and names the
 * file in `data-featurebase-content-filename`. The bytes sit in a bucket that
 * rejects unsigned reads (403), and minting a signature needs AWS credentials
 * we do not hold - so a source image can be named, never fetched.
 */
export function imagesFromHtml(html: string): HtmlImage[] {
  const out: HtmlImage[] = [];
  for (const tag of html.match(/<img\b[^>]*>/gi) || []) {
    const src = tag.match(/\ssrc\s*=\s*"([^"]*)"/i)?.[1] || "";
    const name =
      tag.match(/\sdata-featurebase-content-filename\s*=\s*"([^"]*)"/i)?.[1] ||
      tag.match(/\salt\s*=\s*"([^"]*)"/i)?.[1] ||
      "";
    out.push({ src, name: name || "Attachment" });
  }
  return out;
}

/**
 * Repair a Featurebase markdown body against the HTML it came from.
 *
 * Featurebase renders an attachment into `bodyMarkdown` as `![Image]()` - an
 * image with no URL, which reads as literal punctuation and shows nothing.
 * The matching `<img>` in `bodyHtml` still has the filename, and sometimes a
 * usable `src`, so fill each empty-URL image in from there in order: a real
 * link when we have one, otherwise the filename, which at least says an
 * attachment exists and what it was called.
 */
export function withHtmlImages(markdown: string, html: string): string {
  const images = imagesFromHtml(html);
  if (images.length === 0) return markdown;
  let i = 0;
  const filled = markdown.replace(/!\[([^\]]*)\]\(\s*\)/g, (whole, alt) => {
    const image = images[i++];
    if (!image) return whole;
    const label = image.name || alt || "Attachment";
    return image.src ? `![${label}](${image.src})` : `📎 ${label}`;
  });
  // An attachment can be the only content, with no placeholder to fill.
  if (i === 0 && !/!\[[^\]]*\]\([^)]+\)/.test(filled)) {
    const extra = images
      .map((image) =>
        image.src ? `![${image.name}](${image.src})` : `📎 ${image.name}`,
      )
      .join("\n");
    return filled.trim() ? `${filled.trim()}\n\n${extra}` : extra;
  }
  // Two attachments in a row arrive as `![Image]()![Image]()`, which would
  // otherwise render as one run-on line.
  return filled.replace(/(\S)📎/g, "$1\n📎");
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Turn a human-typed message into the HTML body Featurebase's reply APIs expect. */
export function textToHtml(text: string): string {
  const blocks = text.trim().split(/\n{2,}/);
  return blocks
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}
