import { embedTexts } from "@/lib/gemini";
import { createServerSupabase } from "@/lib/supabase/server";
import { traceEvent } from "@/lib/observability/langfuse";
import type { RetrievalResult } from "@/lib/types";

const RRF_K = 60;
const RRF_WEIGHT_VECTOR = 1.0;
const RRF_WEIGHT_FTS = 1.0;

export interface RankedRow {
  id: string;
  document_id: string;
  content: string;
  page_number: number | null;
  chunk_index: number;
  similarity: number;
}

export function reciprocalRankFusion(
  vectorResults: RankedRow[],
  ftsResults: RankedRow[]
): RetrievalResult[] {
  const scores = new Map<string, { score: number; row: RankedRow }>();

  vectorResults.forEach((row, index) => {
    const rank = index + 1;
    const score = RRF_WEIGHT_VECTOR / (RRF_K + rank);
    const existing = scores.get(row.id);
    if (existing) {
      existing.score += score;
    } else {
      scores.set(row.id, { score, row });
    }
  });

  ftsResults.forEach((row, index) => {
    const rank = index + 1;
    const score = RRF_WEIGHT_FTS / (RRF_K + rank);
    const existing = scores.get(row.id);
    if (existing) {
      existing.score += score;
    } else {
      scores.set(row.id, { score, row });
    }
  });

  return Array.from(scores.values())
    .sort((a, b) => b.score - a.score)
    .map(({ row }) => ({
      chunkId: row.id,
      documentId: row.document_id,
      content: row.content,
      pageNumber: row.page_number,
      chunkIndex: row.chunk_index,
      similarity: row.similarity,
      ftsRank: 0,
    }));
}

export async function enrichWithDocumentNames(
  results: RetrievalResult[]
): Promise<RetrievalResult[]> {
  if (results.length === 0) return results;
  const supabase = createServerSupabase();
  const docIds = Array.from(new Set(results.map((r) => r.documentId)));
  const { data } = await supabase
    .from("documents")
    .select("id, filename")
    .in("id", docIds);
  const nameMap = new Map((data ?? []).map((d) => [d.id, d.filename]));
  return results.map((r) => ({
    ...r,
    documentName: nameMap.get(r.documentId) ?? "Unknown",
  }));
}

/**
 * Hybrid retrieval: cosine similarity + Postgres full-text, merged via RRF.
 * Gracefully degrades if only one source returns results.
 */
export async function hybridSearch(
  query: string,
  matchCount = 20
): Promise<RetrievalResult[]> {
  const supabase = createServerSupabase();
  const trace = await traceEvent({
    name: "retrieve.hybrid",
    input: { query, matchCount },
    tags: ["retrieve"],
  });

  try {
    const [embedding] = await embedTexts([query]);
    const minSimilarity = 0.0;

    const [vectorRes, ftsRes] = await Promise.all([
      supabase.rpc("vector_search", {
        query_embedding: embedding,
        match_count: matchCount,
        min_similarity: minSimilarity,
      }),
      supabase.rpc("full_text_search", {
        query_text: query,
        match_count: matchCount,
      }),
    ]);

    if (vectorRes.error) throw new Error(vectorRes.error.message);
    if (ftsRes.error) throw new Error(ftsRes.error.message);

    const merged = reciprocalRankFusion(
      (vectorRes.data ?? []) as RankedRow[],
      (ftsRes.data ?? []) as RankedRow[]
    );

    const enriched = await enrichWithDocumentNames(merged);

    await trace.update({
      output: { resultCount: enriched.length },
      usage: { input: 1, output: 0 },
    });
    return enriched;
  } catch (error) {
    await trace.error(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    await trace.flush();
  }
}