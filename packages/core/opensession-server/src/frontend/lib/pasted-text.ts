import { randomUUID } from "./random-uuid";

export const PASTED_TEXT_THRESHOLD = 2_500;

export interface PastedTextAttachment {
  id: string;
  text: string;
}

export function shouldCollapsePastedText(text: string): boolean {
  return text.length >= PASTED_TEXT_THRESHOLD;
}

export function createPastedTextAttachment(text: string): PastedTextAttachment {
  return { id: randomUUID(), text };
}

export function pastedTextLineLabel(text: string): string {
  const lines = text.split(/\r\n|\r|\n/).length;
  return `+${lines} ${lines === 1 ? "line" : "lines"}`;
}

/** Sits between the message and each pasted block. The rule renders as a
 *  divider in the sender's bubble, and the label tells the model where the
 *  instruction stops and the material starts. The blank line before the rule
 *  matters: directly under a line of text, `---` would turn it into a heading. */
const PASTED_TEXT_DIVIDER = "---\n\nPasted text:";

/**
 * The typed message leads, and each pasted block follows it behind a divider.
 * A quote leads the message because it is what the message is about; a large
 * paste is material the instruction applies to, and reads as an attachment
 * rather than as the opening of the message. Nothing precedes a lone paste, so
 * it goes out bare.
 */
export function composePastedText(
  text: string,
  attachments: PastedTextAttachment[],
): string {
  if (attachments.length === 0) return text;
  const parts = text.length > 0 ? [text] : [];
  for (const attachment of attachments) {
    if (attachment.text.length === 0) continue;
    parts.push(
      parts.length > 0
        ? `${PASTED_TEXT_DIVIDER}\n\n${attachment.text}`
        : attachment.text,
    );
  }
  return parts.join("\n\n");
}
