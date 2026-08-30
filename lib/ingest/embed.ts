import { embedTexts } from "@/lib/gemini";

const BATCH_SIZE = 10;

/**
 * Embed a list of texts in batches to keep requests within free-tier limits.
 * Returns one embedding vector per input text.
 */
export async function embedChunks(texts: string[]): Promise<number[][]> {
  const embeddings: number[][] = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const batchEmbeddings = await embedTexts(batch);
    embeddings.push(...batchEmbeddings);
  }
  return embeddings;
}