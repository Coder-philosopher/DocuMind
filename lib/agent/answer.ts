import { generateText, streamText } from "@/lib/gemini";
import { buildGroundedPrompt, parseCitations } from "@/lib/agent/prompts";
import { traceEvent } from "@/lib/observability/langfuse";
import type { AgentStep, Citation, RetrievalResult } from "@/lib/types";

export interface AnswerGenerationInput {
  query: string;
  results: RetrievalResult[];
  conversationHistory?: { role: "user" | "assistant"; content: string }[];
}

export interface AnswerGenerationOutput {
  content: string;
  citations: Citation[];
  agentSteps: AgentStep[];
  usage: { input: number; output: number };
}

/**
 * Core RAG answer generation. Given retrieved chunks, build a strict grounded
 * prompt and have Gemini produce an answer with inline [n] citations.
 *
 * Citations are parsed from the output and mapped back to the retrieved chunks.
 * If nothing was retrieved, we explicitly refuse to fabricate.
 */
export async function generateAnswer(
  input: AnswerGenerationInput
): Promise<AnswerGenerationOutput> {
  const agentSteps: AgentStep[] = [];

  if (input.results.length === 0) {
    const content =
      "I could not find any relevant information in the uploaded documents to answer that question. Please try rephrasing, check that a document covering this topic is uploaded, or try a more specific query.";
    return {
      content,
      citations: [],
      agentSteps: [
        { label: "Searched", detail: "Retrieval returned no relevant chunks." },
        { label: "Answered", detail: "No sources found — returned an explicit 'not found' response." },
      ],
      usage: { input: 0, output: 0 },
    };
  }

  const trace = await traceEvent({
    name: "agent.generate",
    input: { query: input.query, resultCount: input.results.length },
    tags: ["generate"],
  });

  const { systemPrompt, userPrompt } = buildGroundedPrompt(
    input.query,
    input.results,
    input.conversationHistory
  );

  try {
    const { text: rawText, inputTokens, outputTokens } = await generateText({
      systemPrompt,
      prompt: userPrompt,
      temperature: 0.3,
    });

    const { text, citationNumbers } = parseCitations(rawText);

    const citations: Citation[] = citationNumbers
      .map((n) => {
        const result = input.results[n - 1];
        if (!result) return null;
        return {
          chunk_id: result.chunkId,
          snippet: result.content.slice(0, 400),
          page: result.pageNumber,
          document_id: result.documentId,
          document_name: result.documentName,
        } as Citation;
      })
      .filter((c): c is Citation => c !== null);

    agentSteps.push(
      { label: "Searched", detail: `${input.results.length} chunks retrieved.` },
      { label: `Evidence: ${citations.length} source${citations.length === 1 ? "" : "s"}`, detail: citations.map((c) => c.document_name).filter(Boolean).join(", ") }
    );

    await trace.update({
      output: { citationCount: citations.length },
      usage: { input: inputTokens, output: outputTokens },
    });

    return {
      content: text,
      citations,
      agentSteps,
      usage: { input: inputTokens, output: outputTokens },
    };
  } catch (error) {
    await trace.error(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    await trace.flush();
  }
}

/**
 * Streaming variant of generateAnswer: produce one chunk of text at a time so
 * the UI can render tokens as they are generated. The returned `done` promise
 * resolves with the complete, citation-annotated answer once the stream ends.
 */
export function generateAnswerStreamed(
  input: AnswerGenerationInput
): {
  deltas: AsyncGenerator<string>;
  done: Promise<AnswerGenerationOutput>;
} {
  if (input.results.length === 0) {
    const content =
      "I could not find any relevant information in the uploaded documents to answer that question. Please try rephrasing, check that a document covering this topic is uploaded, or try a more specific query.";
    const output: AnswerGenerationOutput = {
      content,
      citations: [],
      agentSteps: [
        { label: "Searched", detail: "Retrieval returned no relevant chunks." },
        { label: "Answered", detail: "No sources found — returned an explicit 'not found' response." },
      ],
      usage: { input: 0, output: 0 },
    };
    return { deltas: emitSingleText(content), done: Promise.resolve(output) };
  }

  const { systemPrompt, userPrompt } = buildGroundedPrompt(
    input.query,
    input.results,
    input.conversationHistory
  );

  const { deltas, done } = streamText({
    systemPrompt,
    prompt: userPrompt,
    temperature: 0.3,
  });

  const doneAnswer = done.then(async ({ fullText, inputTokens, outputTokens }) => {
    const { citationNumbers } = parseCitations(fullText);
    const citations: Citation[] = citationNumbers
      .map((n) => {
        const result = input.results[n - 1];
        if (!result) return null;
        return {
          chunk_id: result.chunkId,
          snippet: result.content.slice(0, 400),
          page: result.pageNumber,
          document_id: result.documentId,
          document_name: result.documentName,
        } as Citation;
      })
      .filter((c): c is Citation => c !== null);

    const agentSteps: AgentStep[] = [
      { label: "Searched", detail: `${input.results.length} chunks retrieved.` },
      {
        label: `Evidence: ${citations.length} source${citations.length === 1 ? "" : "s"}`,
        detail: citations.map((c) => c.document_name).filter(Boolean).join(", "),
      },
    ];

    return { content: fullText, citations, agentSteps, usage: { input: inputTokens, output: outputTokens } };
  });

  return { deltas, done: doneAnswer };
}

async function* emitSingleText(text: string): AsyncGenerator<string> {
  yield text;
}