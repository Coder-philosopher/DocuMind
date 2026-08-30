import { hybridSearch } from "@/lib/retrieve";
import { rerankResults } from "@/lib/rerank/cohere";
import { generateAnswer } from "@/lib/agent/answer";
import { rewriteQuery } from "@/lib/agent/rewrite";
import { checkSupport, groundingCheck } from "@/lib/agent/grounding";
import { traceEvent } from "@/lib/observability/langfuse";
import type {
  AgentStep,
  AnswerResult,
  Citation,
  RetrievalResult,
} from "@/lib/types";

export const MAX_HOPS = 2; // planning + up to 2 refresh loops = max ~3 generations

export interface AgenticAnswerInput {
  query: string;
  conversationHistory?: { role: "user" | "assistant"; content: string }[];
  initialCandidates?: number;
  finalTopN?: number;
}

export interface AgenticAnswerOutput extends AnswerResult {
  usage: { input: number; output: number };
  rerankFallback?: string;
}

/**
 * Full agentic pipeline:
 *   1. Rewrite query using conversation history.
 *   2. Hybrid search over a wide candidate set.
 *   3. Cohere rerank down to the top N (graceful fallback on quota).
 *   4. Draft answer.
 *   5. Multi-hop: structured check — if evidence is missing and hops remain,
 *      generate a follow-up sub-query, retrieve, merge context, re-answer.
 *   6. Grounding / hallucination check on the final answer.
 *
 * Every step is traced via Langfuse and captured in human-readable agent steps
 * that the UI renders as a collapsible trace.
 */
export async function runAgenticAnswer(
  input: AgenticAnswerInput
): Promise<AgenticAnswerOutput> {
  const agentSteps: AgentStep[] = [];
  const hops = Math.min(Math.max(input.initialCandidates ?? 20, 5), 40);
  const topN = Math.min(Math.max(input.finalTopN ?? 5, 3), 10);
  let usage = { input: 0, output: 0 };

  const trace = await traceEvent({
    name: "agent.run",
    input: { query: input.query, hops, topN },
    tags: ["agent"],
  });

  try {
    // ---- Step 1: query rewriting ----
    const startedRewrites = Date.now();
    const { rewrittenQuery, usedRewrite } = await rewriteQuery(
      input.query,
      input.conversationHistory ?? []
    );
    let queryForSearch = rewrittenQuery;

    if (usedRewrite) {
      agentSteps.push({
        label: "Rewrote query",
        detail: `"${input.query}" → "${rewrittenQuery}"`,
        durationMs: Date.now() - startedRewrites,
      });
    }

    // ---- Step 2+3: hybrid search + rerank ----
    let retrieved: RetrievalResult[] = [];
    const searchAndRerank = async (q: string): Promise<{
      results: RetrievalResult[];
      rerankFallback?: string;
    }> => {
      const candidates = await hybridSearch(q, hops);
      const reranked = await rerankResults(q, candidates, topN);
      return {
        results: reranked.results,
        rerankFallback: reranked.reranked ? undefined : reranked.fallbackReason,
      };
    };

    const firstRound = await searchAndRerank(queryForSearch);
    retrieved = firstRound.results;
    const rerankFallback = firstRound.rerankFallback;

    agentSteps.push(
      {
        label: "Searched",
        detail: `${queryForSearch.length > 60 ? queryForSearch.slice(0, 60) + "…" : queryForSearch} — ${retrieved.length} chunks`,
      },
      {
        label: "Reranked",
        detail: rerankFallback
          ? `Cohere unavailable → hybrid order (${rerankFallback})`
          : `Cohere selected top ${retrieved.length}`,
      },
      {
        label: "Generating",
        detail: "Draft answer from grounded context",
      }
    );

    if (rerankFallback) {
      await trace.update({
        output: { rerankFallback },
      });
    }

    // ---- Step 4: draft answer ----
    const draft = await generateAnswer({
      query: input.query,
      results: retrieved,
      conversationHistory: input.conversationHistory,
    });
    usage = { input: usage.input + draft.usage.input, output: usage.output + draft.usage.output };

    if (draft.citations.length === 0) {
      // Nothing retrieved / nothing usable — answer already explains this.
      return {
        content: draft.content,
        citations: draft.citations,
        groundingScore: 1.0,
        agentSteps,
        usage,
        rerankFallback,
      };
    }

    // ---- Step 5: multi-hop evidence loop ----
    let currentAnswer = draft.content;
    let currentCitations = draft.citations;
    let currentContext = retrieved;
    let hopCount = 0;

    while (hopCount < MAX_HOPS) {
      const check = await checkSupport(
        input.query,
        currentAnswer,
        currentContext
      );
      if (check.sufficient || !check.followUpQuery) {
        if (hopCount > 0) {
          agentSteps.push({
            label: "Enough evidence",
            detail: check.reasoning,
          });
        }
        break;
      }

      hopCount += 1;
      agentSteps.push({
        label: `Needed more evidence (${hopCount})`,
        detail: check.reasoning,
      });

      const followUp = await searchAndRerank(check.followUpQuery);
      const newResults = followUp.results;
      agentSteps.push({
        label: "Searched again",
        detail: `"${check.followUpQuery}" — ${newResults.length} chunks`,
      });
      if (followUp.rerankFallback && !rerankFallback) {
        void followUp.rerankFallback;
      }

      // Merge new evidence with existing, keeping order but removing duplicates.
      currentContext = mergeContexts(currentContext, newResults);
      queryForSearch = check.followUpQuery;

      const refined = await generateAnswer({
        query: input.query,
        results: currentContext,
        conversationHistory: input.conversationHistory,
      });
      usage = { input: usage.input + refined.usage.input, output: usage.output + refined.usage.output };
      currentAnswer = refined.content;
      currentCitations = refined.citations;
    }
    agentSteps.push({
      label: "Answered",
      detail: `Final answer with ${currentCitations.length} citation${currentCitations.length === 1 ? "" : "s"}`,
    });

    // ---- Step 6: grounding check ----
    const groundResult = await groundingCheck(
      input.query,
      currentAnswer,
      currentCitations,
      currentContext
    );
    agentSteps.push({
      label: "Grounded",
      detail: `Faithfulness ${Math.round(groundResult.overallScore * 100)}%${
        groundResult.unsupportedSentences.length > 0
          ? ` · ${groundResult.unsupportedSentences.length} flagged`
          : ""
      }`,
    });

    return {
      content: currentAnswer,
      citations: currentCitations,
      groundingScore: groundResult.overallScore,
      unsupportedSentences: groundResult.unsupportedSentences,
      agentSteps,
      usage,
      rerankFallback,
    };
  } catch (error) {
    await trace.error(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    await trace.flush();
  }
}

function mergeContexts(
  existing: RetrievalResult[],
  additions: RetrievalResult[]
): RetrievalResult[] {
  const seen = new Set(existing.map((r) => r.chunkId));
  const merged = [...existing];
  for (const add of additions) {
    if (!seen.has(add.chunkId)) {
      seen.add(add.chunkId);
      merged.push(add);
    }
  }
  return merged;
}

export type { Citation };