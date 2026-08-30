import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";

import { env } from "@/lib/config";
import { withRetry } from "@/lib/utils/retry";

export const GENERATION_MODEL = "gemini-2.0-flash";
export const EMBEDDING_MODEL = "text-embedding-004";
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

export async function embedTexts(texts: string[]): Promise<number[][]> {
  const model = getGeminiModel(EMBEDDING_MODEL);
  const embeddings: number[][] = [];
  for (const text of texts) {
    const result = await withRetry(() => model.embedContent(text), {
      label: "gemini.embedContent",
    });
    embeddings.push(result.embedding.values);
  }
  return embeddings;
}