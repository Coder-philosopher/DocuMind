import { generateText } from "@/lib/gemini";
import { traceEvent } from "@/lib/observability/langfuse";

/**
 * Query rewriting: disambiguate the raw query into a standalone search query
 * using the last few conversation turns. Returns the original query unchanged
 * if rewriting fails, so retrieval always proceeds.
 */
export async function rewriteQuery(
  rawQuery: string,
  history: { role: "user" | "assistant"; content: string }[]
): Promise<{ rewrittenQuery: string; usedRewrite: boolean }> {
  const trace = await traceEvent({
    name: "agent.rewrite",
    input: { rawQuery, historyTurns: history.length },
    tags: ["rewrite"],
  });

  try {
    const context = history.slice(-4);
    if (context.length === 0) {
      return { rewrittenQuery: rawQuery, usedRewrite: false };
    }

    const historyText = context
      .map((m) => `**${m.role === "user" ? "User" : "Assistant"}**: ${m.content}`)
      .join("\n");

    const prompt = `The user is chatting with an enterprise document assistant. Rewrite the latest user query into a single, standalone, search-ready query that captures the user's real intent, resolving pronouns and implicit references using the conversation history.

Conversation history:
${historyText}

Latest user query:
${rawQuery}

Respond with ONLY the rewritten query as plain text — no quotes, no prefixes, no explanation. If the query is already self-contained, reproduce it verbatim.`;

    const { text, inputTokens, outputTokens } = await generateText({
      systemPrompt:
        "You are a query rewriting component for a retrieval system. Output only the rewritten query text.",
      prompt,
      temperature: 0.2,
    });

    const rewritten = text.trim().replace(/^[">\s]+|[">\s]+$/g, "");
    const usedRewrite = rewritten !== rawQuery && rewritten.length > 0;

    await trace.update({
      output: { usedRewrite },
      usage: { input: inputTokens, output: outputTokens },
    });

    return {
      rewrittenQuery: usedRewrite ? rewritten : rawQuery,
      usedRewrite,
    };
  } catch (error) {
    await trace.error(error instanceof Error ? error.message : String(error));
    // On any failure, fall back to the raw query — never crash retrieval.
    return { rewrittenQuery: rawQuery, usedRewrite: false };
  } finally {
    await trace.flush();
  }
}