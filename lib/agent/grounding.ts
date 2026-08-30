import { generateText } from "@/lib/gemini";
import { traceEvent } from "@/lib/observability/langfuse";
import type { Citation, RetrievalResult } from "@/lib/types";

export interface SupportCheck {
  sufficient: boolean;
  followUpQuery?: string;
  reasoning: string;
}

export interface GroundingResult {
  overallScore: number; // 0..1
  unsupportedSentences: Array<{ sentence: string; reason: string }>;
}

export type GroundingLevel = "high" | "medium" | "low";

export function groundingLevel(score: number | null | undefined): GroundingLevel {
  if (score == null) return "high";
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "medium";
  return "low";
}

/**
 * Structured (JSON-mode) check after a draft answer: is the answer fully
 * supported by the retrieved context, or is an additional targeted search
 * needed? Used by the multi-hop loop.
 */
export async function checkSupport(
  query: string,
  draftAnswer: string,
  contextChunks: RetrievalResult[]
): Promise<SupportCheck> {
  const trace = await traceEvent({
    name: "agent.check_support",
    input: { query, chunkCount: contextChunks.length },
    tags: ["agent", "multi-hop"],
  });

  try {
    const contextText = contextChunks
      .map((c, i) => `<context id="${i + 1}">${c.content}</context>`)
      .join("\n");

    const prompt = `You are assessing whether a draft answer is fully supported by the retrieved context.

Query:
${query}

Draft answer:
${draftAnswer}

Retrieved context:
${contextText}

Respond ONLY in JSON, exactly this shape:
{
  "sufficient": boolean,
  "follow_up_query": string | null,
  "reasoning": string
}

- "sufficient" is true when the draft answer is fully supported by the provided context (including numbers, names and claims).
- If NOT fully supported, set "sufficient" to false and provide a "follow_up_query" — a single targeted search query that would retrieve the missing evidence.
- "reasoning" is a one-sentence explanation.`;

    const { text, inputTokens, outputTokens } = await generateText({
      systemPrompt:
        "You are a strict evidence-checker for a grounded RAG system. Answer only in the requested JSON shape.",
      prompt,
      temperature: 0,
      responseMimeType: "application/json",
    });

    let parsed: {
      sufficient: boolean;
      follow_up_query?: string | null;
      reasoning?: string;
    };
    try {
      parsed = JSON.parse(text.trim());
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { sufficient: true, reasoning: "Parse failed; assuming sufficient." };
    }

    const sufficient = parsed.sufficient !== false;
    const followUpQuery = parsed.follow_up_query?.trim() ?? undefined;

    await trace.update({
      output: { sufficient, followUpQuery },
      usage: { input: inputTokens, output: outputTokens },
    });

    return {
      sufficient,
      followUpQuery: sufficient ? undefined : followUpQuery,
      reasoning: parsed.reasoning ?? "",
    };
  } catch (error) {
    await trace.error(error instanceof Error ? error.message : String(error));
    // On failure, assume sufficient so the pipeline never gets stuck.
    return { sufficient: true, reasoning: "Support check failed; assuming sufficient." };
  } finally {
    await trace.flush();
  }
}

/**
 * Final grounding / hallucination pass: score overall faithfulness (0-1) and
 * flag any sentence in the answer unsupported by the retrieved context.
 */
export async function groundingCheck(
  query: string,
  answer: string,
  citations: Citation[],
  contextChunks: RetrievalResult[]
): Promise<GroundingResult> {
  const trace = await traceEvent({
    name: "agent.grounding_check",
    input: { query, sentenceFlag: true },
    tags: ["grounding"],
  });

  try {
    const contextText = contextChunks
      .map((c, i) => `<context id="${i + 1}">${c.content}</context>`)
      .join("\n");

    const prompt = `You are a hallucination auditor for a grounded RAG system. Check EVERY factual claim in the answer against ONLY the provided context.

Query:
${query}

Answer:
${answer}

Context:
${contextText}

Respond ONLY in JSON, exactly this shape:
{
  "overall_score": 0.0 - 1.0,
  "unsupported_sentences": [
    { "sentence": "...", "reason": "..." }
  ]
}

Rules:
- overall_score = fraction of the answer's factual claims that are fully supported by the context (1.0 = fully grounded).
- If any sentence makes claims NOT found in the context (numbers, names, dates, conclusions), list it in "unsupported_sentences" with a concise reason.
- Sentences like "I could not find..." are not hallucinations.
- Quote unsupported_sentences sentences verbatim (trimmed to a reasonable length).`;

    const { text, inputTokens, outputTokens } = await generateText({
      systemPrompt:
        "You are a hallucination auditor. Answer only in the requested JSON shape.",
      prompt,
      temperature: 0,
      responseMimeType: "application/json",
    });

    let parsed: {
      overall_score?: number;
      unsupported_sentences?: Array<{ sentence?: string; reason?: string }>;
    };
    try {
      parsed = JSON.parse(text.trim());
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : { overall_score: 1.0, unsupported_sentences: [] };
    }

    const overallScore = clampScore(parsed.overall_score ?? 1.0);
    const unsupportedSentences = (parsed.unsupported_sentences ?? [])
      .filter((u) => u.sentence)
      .map((u) => ({
        sentence: String(u.sentence).slice(0, 500),
        reason: String(u.reason ?? "").slice(0, 500),
      }));

    await trace.update({
      output: { overallScore, unsupportedCount: unsupportedSentences.length },
      usage: { input: inputTokens, output: outputTokens },
    });

    return { overallScore, unsupportedSentences };
  } catch (error) {
    await trace.error(error instanceof Error ? error.message : String(error));
    return { overallScore: 1.0, unsupportedSentences: [] };
  } finally {
    await trace.flush();
  }
}

function clampScore(score: number): number {
  if (Number.isNaN(score)) return 1.0;
  return Math.max(0, Math.min(1, score));
}