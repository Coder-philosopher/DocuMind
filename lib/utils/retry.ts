export const ProviderErrorCode = {
  LLM_QUOTA: "LLM_QUOTA_EXCEEDED",
  LLM_UNAVAILABLE: "LLM_UNAVAILABLE",
  RERANK_UNAVAILABLE: "RERANK_UNAVAILABLE",
  EMBED_UNAVAILABLE: "EMBED_UNAVAILABLE",
} as const;
export type ProviderErrorCode =
  (typeof ProviderErrorCode)[keyof typeof ProviderErrorCode];

/**
 * Richer error used across the agent pipeline so the API route can send a
 * friendly message to the UI while keeping the full provider detail for logs.
 */
export function providerError(
  code: ProviderErrorCode,
  message: string,
  cause?: unknown
): ProviderError {
  return new ProviderError(code, message, cause);
}

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly cause?: unknown;
  retryInSec?: number;

  constructor(code: ProviderErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.cause = cause;
  }
}

/** Detect free-tier daily/rate-limit quota exhaustion from a provider error. */
export function isQuotaError(error: unknown): error is ProviderError {
  return error instanceof ProviderError && error.code === ProviderErrorCode.LLM_QUOTA;
}

/**
 * Minimal retry helper for external LLM/API calls. Retries transient
 * 5xx/connectivity errors with exponential backoff + jitter. A 429 means a
 * quota budget is exhausted — provider-level budget limits (e.g. a *daily*
 * cap) will not recover on retry, so we fail fast instead of blocking the
 * request for minutes.
 */
function extractRetryAfterSec(error: unknown): number | null {
  if (
    error &&
    typeof error === "object" &&
    "retryInSec" in error &&
    typeof (error as { retryInSec?: unknown }).retryInSec === "number"
  ) {
    const r = (error as { retryInSec: number }).retryInSec;
    if (r > 0) return r;
  }
  if (!error || typeof error !== "object" || !("message" in error)) return null;
  const { message } = error as { message?: string };
  if (typeof message === "string") {
    const m = message.match(/retry in (\d+(?:\.\d+)?)s/i);
    if (m) return parseFloat(m[1]) / 60; // convert to minutes
  }
  return null;
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    retries?: number;
    baseDelayMs?: number;
    label?: string;
    /** On 429: fail immediately instead of retrying (used for provider budgets). */
    failFastOnQuota?: boolean;
  } = {}
): Promise<T> {
  const {
    retries = 3,
    baseDelayMs = 800,
    label = "call",
    failFastOnQuota = true,
  } = opts;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = (error as { status?: number })?.status;
      const is429 = status === 429;

      if (is429) {
        // Quota budget exhausted (esp. daily cap). Don't wait out a long budget
        // window (the provider may ask for ~a minute+); surface immediately.
        if (failFastOnQuota) throw error;
        // else: transient per-minute rate limit — retry below.
      } else if ((status ?? 0) < 500) {
        throw error;
      }

      if (attempt === 0) console.warn(`[retry:${label}] attempt 0 failed`, status);
      if (attempt === retries) break;
      const suggested = extractRetryAfterSec(error);
      const delay =
        suggested != null
          ? Math.min(suggested, 30) * 1000
          : baseDelayMs * Math.pow(2, attempt) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}