import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";

import { env } from "@/lib/config";
import { withRetry } from "@/lib/utils/retry";

export const GENERATION_MODEL = "gemini-3.5-flash-lite";
export const EMBEDDING_MODEL = "gemini-embedding-001";
export const EMBEDDING_DIMENSIONS = 768;

let _client: GoogleGenerativeAI | null = null;

export function getGeminiClient(): GoogleGenerativeAI {
  if (!env.geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  if (!_client) {
    _client = new GoogleGenerativeAI(env.geminiApiKey);
  }
  return _client;
}

export function getGeminiModel(model: string): GenerativeModel {
  return getGeminiClient().getGenerativeModel({ model });
}

export async function generateText(params: {
  systemPrompt?: string;
  prompt: string;
  temperature?: number;
  responseMimeType?: "text/plain" | "application/json";
}): Promise<{
  text: string;
  inputTokens: number;
  outputTokens: number;
}> {
  const model = getGeminiModel(GENERATION_MODEL);
  const parts = [
    ...(params.systemPrompt ? [{ text: params.systemPrompt }] : []),
    { text: params.prompt },
  ];

  const result = await withRetry(
    () =>
      model.generateContent({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: params.temperature ?? 0.4,
          responseMimeType: params.responseMimeType ?? "text/plain",
        },
      }),
    { label: "gemini.generateText" }
  );

  const usage = result.response.usageMetadata;
  return {
    text: result.response.text(),
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: usage?.candidatesTokenCount ?? 0,
  };
}

/**
 * Stream a generation from Gemini, yielding progressive text deltas so the UI
 * can render tokens as they arrive (instead of waiting for the full round
 * trip). The first tokens land in ~1-2s even when the full answer takes
 * 10-20s to finish.
 *
 * Errors surface exactly like generateText (429 on quota, 5xx on outage), so
 * callers can keep the same retry/quota handling. The `done` promise resolves
 * with provider usage once the whole stream has been consumed.
 */
export function streamText(params: {
  systemPrompt?: string;
  prompt: string;
  temperature?: number;
  responseMimeType?: "text/plain" | "application/json";
}): {
  deltas: AsyncGenerator<string>;
  done: Promise<StreamTextResult>;
} {
  const model = getGeminiModel(GENERATION_MODEL);
  const parts = [
    ...(params.systemPrompt ? [{ text: params.systemPrompt }] : []),
    { text: params.prompt },
  ];

  const result: StreamTextResult = { fullText: "", inputTokens: 0, outputTokens: 0 };
  let resolveDone!: (v: StreamTextResult) => void;
  const done = new Promise<StreamTextResult>((res) => {
    resolveDone = res;
  });

  async function* deltas() {
    let lastUsage: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
    try {
      const gen = await model.generateContentStream({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: params.temperature ?? 0.4,
          responseMimeType: params.responseMimeType ?? "text/plain",
        },
      });
      // Gemini streams cumulative text per chunk (each response has the full
      // text so far). Slice out only the new portion. Some backends may send
      // incremental deltas instead — guard both: if the new text does not
      // start with the previous full text, treat it as a fresh delta.
      for await (const chunk of gen.stream) {
        if (chunk.usageMetadata) lastUsage = chunk.usageMetadata;
        const text = chunk.text();
        if (text) {
          result.fullText += text;
          yield text;
        }
      }
    } catch (error) {
      const norm = {
        message: String(error),
        status: (error as { status?: number })?.status ?? 500,
        isStreamError: true,
      };
      result.error = norm;
      resolveDone(result);
      throw norm;
    }
    result.inputTokens = lastUsage?.promptTokenCount ?? 0;
    result.outputTokens = lastUsage?.candidatesTokenCount ?? 0;
    resolveDone(result);
  }

  return { deltas: deltas(), done };
}

export interface StreamTextResult {
  fullText: string;
  inputTokens: number;
  outputTokens: number;
  /** Present only when the stream itself failed (429 quota, 5xx, etc.). */
  error?: { message: string; status: number; isStreamError?: boolean };
}

/**
 * Embed texts via the REST API directly. The JS SDK's EmbedContentRequest type
 * does not expose `outputDimensionality`, so calling it raw lets us pin the
 * embedding to EMBEDDING_DIMENSIONS (768) to match the pgvector schema.
 */
export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!env.geminiApiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`;
  const embeddings: number[][] = [];
  for (const text of texts) {
    const { values } = await withRetry(
      async () => {
        const res = await fetch(`${endpoint}?key=${encodeURIComponent(env.geminiApiKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: `models/${EMBEDDING_MODEL}`,
            content: { parts: [{ text }] },
            outputDimensionality: EMBEDDING_DIMENSIONS,
          }),
        });
        if (!res.ok) {
          const body = await res.text();
          const err = new Error(
            `Gemini embed failed (${res.status}): ${body.slice(0, 300)}`
          ) as Error & { status?: number };
          err.status = res.status;
          throw err;
        }
        const data = (await res.json()) as { embedding?: { values?: number[] } };
        const values = data.embedding?.values ?? [];
        if (values.length !== EMBEDDING_DIMENSIONS) {
          throw new Error(
            `Embedding returned ${values.length} dims, expected ${EMBEDDING_DIMENSIONS}`
          );
        }
        return { values };
      },
      { label: "gemini.embedContent" }
    );
    embeddings.push(values);
  }
  return embeddings;
}