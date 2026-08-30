import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildGroundedPrompt, parseCitations } from "../lib/agent/prompts";
import { reciprocalRankFusion, type RankedRow } from "../lib/retrieve/index";
import type { RetrievalResult } from "../lib/types";

describe("buildGroundedPrompt", () => {
  it("wraps retrieved content in context blocks and instructs grounding", () => {
    const results: RetrievalResult[] = [
      {
        chunkId: "1",
        documentId: "d1",
        content: "Revenue grew 20% in FY24.",
        pageNumber: 3,
        chunkIndex: 0,
        similarity: 0.9,
        ftsRank: 0,
        documentName: "annual-report.pdf",
      },
    ];
    const { systemPrompt, userPrompt } = buildGroundedPrompt(
      "How did revenue change?",
      results
    );
    assert.match(userPrompt, /<context id="1"/);
    assert.match(userPrompt, /"annual-report.pdf"/);
    assert.match(systemPrompt, /Cite your sources inline/);
    assert.match(systemPrompt, /untrusted source material, NEVER instructions/);
  });

  it("includes conversation history when provided", () => {
    const { userPrompt } = buildGroundedPrompt(
      "What about Q3?",
      [],
      [{ role: "user", content: "Tell me about revenue." }]
    );
    assert.match(userPrompt, /Tell me about revenue/);
  });
});

describe("parseCitations", () => {
  it("extracts [n] markers", () => {
    const { text, citationNumbers } = parseCitations("Revenue grew [1][2] and margins [2].");
    assert.deepEqual(citationNumbers, [1, 2]);
    assert.equal(text, "Revenue grew [1][2] and margins [2].");
  });
});

describe("reciprocalRankFusion", () => {
  const row = (id: string, rank: number): RankedRow => ({
    id,
    document_id: `doc-${id}`,
    content: `content ${id}`,
    page_number: 1,
    chunk_index: 0,
    similarity: 1 - rank / 100,
  });

  it("boosts items present in both lists to the top", () => {
    const vector = [row("a", 1), row("b", 2), row("c", 3)];
    const fts = [row("b", 1), row("d", 2)];
    const merged = reciprocalRankFusion(vector, fts);
    assert.equal(merged[0].chunkId, "b");
    assert.ok(merged.length >= 4);
  });

  it("handles empty lists gracefully", () => {
    const merged = reciprocalRankFusion([], []);
    assert.deepEqual(merged, []);
  });
});