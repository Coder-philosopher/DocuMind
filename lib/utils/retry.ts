/**
 * Minimal retry helper for external LLM/API calls. Free tiers throttle with
 * 429/5xx — retry with exponential backoff + jitter, then give up so the
 * caller can degrade gracefully.
 */
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
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}