import { CohereClient } from "cohere-ai";

import { env } from "@/lib/config";
import { traceEvent } from "@/lib/observability/langfuse";
import type { RetrievalResult } from "@/lib/types";

const RERANK_MODEL = "rerank-english-v3.0";

/**
 * Rerank a candidate list with Cohere Rerank, down to `topN`.
 *
 * Graceful degradation: if no COHERE_API_KEY is configured, or the request
 * fails (free-tier quota exhaustion, rate limit, etc.), we fall back to the
 * incoming hybrid-search order and report `reranked=false` to the caller so it
 * can be surfaced quietly in the trace log rather than to the end user.
 */
export async function rerankResults(
  query: string,
  candidates: RetrievalResult[],
  topN = 5
): Promise<{
  results: RetrievalResult[];
  reranked: boolean;
  fallbackReason?: string;
}> {
  if (candidates.length === 0) {
    return { results: [], reranked: true };
  }

  if (!env.cohereApiKey) {
    return {
      results: candidates.slice(0, topN),
      reranked: false,
      fallbackReason: "COHERE_API_KEY not configured",
    };
  }

  const trace = await traceEvent({
    name: "rerank.cohere",
    input: { query, candidateCount: candidates.length, topN },
    tags: ["rerank"],
  });

  const client = new CohereClient({ token: env.cohereApiKey });

  try {
    const response = await client.rerank({
      model: RERANK_MODEL,
      query,
      documents: candidates.map((c) => c.content),
      topN,
    });

    const ranked: RetrievalResult[] = (response.results ?? [])
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .map((r) => candidates[r.index])
      .filter((c): c is RetrievalResult => Boolean(c));

    await trace.update({ output: { rankCount: ranked.length } });
    return { results: ranked, reranked: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown Cohere error";
    await trace.error(message);
    return {
      results: candidates.slice(0, topN),
      reranked: false,
      fallbackReason: `Cohere rerank failed (${message.slice(0, 120)})`,
    };
  } finally {
    await trace.flush();
  }
}