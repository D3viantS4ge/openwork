import { describe, expect, test } from "bun:test";

import { renderMarkdownHtml, type MarkdownPresentation } from "../src/components/markdown/markdown-primitive";

const presentations: MarkdownPresentation[] = ["chat", "surface"];

describe("markdown emoji", () => {
  for (const presentation of presentations) {
    test(`keeps numeric emoji shortcodes literal in ${presentation}`, () => {
      const html = renderMarkdownHtml("a :2: b and a ratio 1:2:3", presentation);

      expect(html).toContain(":2:");
      expect(html).toContain("1:2:3");
      expect(html).not.toContain("🕑");
    });

    test(`keeps keyword emoji shortcodes literal in ${presentation}`, () => {
      const html = renderMarkdownHtml(":smile: :time: :face:", presentation);

      expect(html).toContain(":smile:");
      expect(html).toContain(":time:");
      expect(html).toContain(":face:");
      expect(html).not.toContain("😀");
      expect(html).not.toContain("⌛");
    });

    test(`renders unicode emoji unchanged in ${presentation}`, () => {
      const html = renderMarkdownHtml("😀 🕑", presentation);

      expect(html).toContain("😀");
      expect(html).toContain("🕑");
    });

    test(`keeps shortcodes literal inside code spans in ${presentation}`, () => {
      const html = renderMarkdownHtml("`:2:`", presentation);

      expect(html).toContain(":2:");
      expect(html).not.toContain("🕑");
    });
  }
});
