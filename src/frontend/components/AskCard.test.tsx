import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AskCard } from "./AskCard";

test("renders a free-text question without options", () => {
  const html = renderToStaticMarkup(
    <AskCard
      questions={[{ question: "What should happen next?" }]}
      onAnswer={() => {}}
    />,
  );

  expect(html).toContain("What should happen next?");
  expect(html).toContain('placeholder="Type your answer…"');
  expect(html).toContain('aria-label="Answer"');
  expect(html).not.toContain('role="group"');
});

test("renders question markdown and selectable options accessibly", () => {
  const html = renderToStaticMarkup(
    <AskCard
      questions={[
        {
          header: "Human ask",
          question: "Should **this change** ship?",
          options: [
            { label: "Ship it", description: "Push the commit now." },
            { label: "Hold it" },
          ],
        },
      ]}
      onAnswer={() => {}}
    />,
  );

  expect(html).toContain("<strong>this change</strong>");
  expect(html).toContain('role="group"');
  expect(html).toContain('aria-pressed="false"');
  expect(html).toContain('aria-label="Custom answer"');
});

test("a lone question's header rides the status row instead of stacking", () => {
  const html = renderToStaticMarkup(
    <AskCard
      questions={[{ header: "repo tile", question: "Branch or PR state?" }]}
      onAnswer={() => {}}
    />,
  );

  // Rendered once, and on the same row as the status label rather than under it.
  expect(html.split("repo tile").length - 1).toBe(1);
  expect(html).toMatch(/needs input<\/span>.*repo tile/s);
});

test("with several questions each section keeps its own header", () => {
  const html = renderToStaticMarkup(
    <AskCard
      questions={[
        { header: "repo tile", question: "Branch or PR state?" },
        { header: "sort order", question: "Newest first?" },
      ]}
      onAnswer={() => {}}
    />,
  );

  expect(html).toContain("repo tile");
  expect(html).toContain("sort order");
  // Neither is pulled up into the status row when there is more than one.
  expect(html).not.toMatch(/needs input<\/span>[^<]*<span[^>]*>·/);
});
