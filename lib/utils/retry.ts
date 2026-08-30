/**
 * Minimal retry helper for external LLM/API calls. Free tiers throttle with
 * 429/5xx — retry with exponential backoff + jitter, then give up so the
 * caller can degrade gracefully. If the provider tells us how long to wait
 * ("Please retry in 40s"), honor that instead of the default backoff.
 */
function suggestedDelayMs(error: unknown): number | null {
  if (!error || typeof error !== "object" || !("message" in error)) return null;
  const msg = String((error as { message?: unknown }).message ?? "");
  const m = msg.match(/retry in (\d+(?:\.\d+)?)s/i);
  const wait = m ? Math.ceil(parseFloat(m[1]) * 1000) : 0;
  if (wait <= 0 || wait > 120_000) return null;
  return wait;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; baseDelayMs?: number; label?: string } = {}
): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 800;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number })?.status;
      const retryable = status === 429 || (status ?? 0) >= 500 || attempt < retries;
      if (!retryable) throw error;
      if (attempt === retries) break;
      const suggested = suggestedDelayMs(error);
      const delay =
        suggested ?? baseDelayMs * Math.pow(2, attempt) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}