import type { PendingComment } from "../components/CommentableDiff";
import type { PrComment, PrDetails } from "./types";

export function formatPendingCommentsPrompt(comments: PendingComment[], pr: PrDetails): string {
  const body = comments
    .map((c, i) => {
      const range =
        c.startLine && c.startLine !== c.endLine
          ? `${c.startLine}-${c.endLine}`
          : String(c.endLine);
      return `${i + 1}. ${c.path}:${range}\n${c.text}`;
    })
    .join("\n\n");
  return `Please address these pending review comments on PR #${pr.number} (${pr.title}).\n\n${body}`;
}

function trimCommentBody(body: string): string {
  return body.trim().replace(/\n{3,}/g, "\n\n");
}

/** Bot comments hide bookkeeping in HTML comments (`<!-- marker -->`) — drop them from previews. */
export function stripHtmlComments(body: string): string {
  return body.replace(/<!--[\s\S]*?-->/g, "").trim();
}

export function formatPrCommentPrompt(comment: PrComment, pr: PrDetails): string {
  const author = comment.author ? ` from ${comment.author}` : "";
  const link = comment.url ? `\nURL: ${comment.url}` : "";
  return `Please address this PR comment${author} on PR #${pr.number} (${pr.title}).${link}\n\n${trimCommentBody(comment.body)}`;
}

export function formatPrCommentsPrompt(comments: PrComment[], pr: PrDetails): string {
  const body = comments
    .map((c, i) => {
      const by = c.author ? ` by ${c.author}` : "";
      const link = c.url ? `\n${c.url}` : "";
      return `${i + 1}. Comment${by}${link}\n${trimCommentBody(c.body)}`;
    })
    .join("\n\n");
  return `Please review these PR comments on PR #${pr.number} (${pr.title}).\n\n${body}`;
}
