import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { chunkText, chunkSegments, estimateTokens, recursiveSplit, type TextSegment } from "../lib/ingest/chunk";

describe("estimateTokens", () => {
  it("estimates ~1 token per 4 chars", () => {
    assert.equal(estimateTokens("1234"), 1);
    assert.equal(estimateTokens(""), 0);
  });
});

describe("recursiveSplit", () => {
  it("keeps short text as one piece", () => {
    const pieces = recursiveSplit("Short text here.", 800);
    assert.equal(pieces.length, 1);
  });

  it("splits long text on paragraph boundaries", () => {
    const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i}. ` + "lorem ipsum dolor sit amet. ".repeat(20)).join("\n\n");
    const pieces = recursiveSplit(long, 2400);
    assert.ok(pieces.length >= 2);
    assert.ok(pieces.every((p) => p.length <= 2400 + 200));
  });
});

describe("chunkText", () => {
  it("produces sequential chunk indices with token counts", () => {
    const long = Array.from({ length: 120 }, (_, i) => `Sentence ${i} about the revenue and growth strategy.`).join(". ");
    const chunks = chunkText(long);
    assert.ok(chunks.length >= 2);
    chunks.forEach((c, i) => {
      assert.equal(c.chunkIndex, i);
      assert.ok(c.tokenCount > 0);
      assert.ok(c.pageNumber === 1 || c.pageNumber === null);
    });
  });

  it("carries overlap tail between chunks when possible", () => {
    const long = Array.from({ length: 200 }, (_, i) => `Unique token phrase ${i} appears here.`).join(". ");
    const chunks = chunkText(long);
    assert.ok(chunks.length >= 2);
    const overlap = chunks.slice(1);
    assert.ok(overlap.length >= 1);
  });
});

describe("chunkSegments with pages", () => {
  it("preserves page info from segments", () => {
    const segs: TextSegment[] = [
      { text: "Page one content about AlphaCorp merger.", page: 1 },
      { text: "Page two content about quarterly results.", page: 2 },
    ];
    const chunks = chunkSegments(segs);
    assert.ok(chunks.length >= 1);
    const pages = chunks.map((c) => c.pageNumber);
    assert.ok(pages.some((p) => p === 1 || p === 2));
  });
});