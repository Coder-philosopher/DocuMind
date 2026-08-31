import { ProviderError, type ProviderErrorCode } from "@/lib/utils/retry";

/**
 * Map an unknown thrown error to a friendly message + HTTP status + stable code
 * so the UI never surfaces raw provider error text.
 */
function messageText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "object" && "message" in error) {
    const m = String((error as { message?: unknown }).message ?? "");
    return m;
  }
  return String(error);
}

/** Raw provider 429s embed an explicit "per day / per project" quota marker. */
export function isDailyQuotaText(message: string): boolean {
  return (
    message.includes("Quota exceeded") ||
    /Quota(ForRequests)?Exceeded/i.test(message)
  ) && /PerDay|per day|quotaValue|RequestsPerDay/i.test(message);
}

export function classifyError(error: unknown): {
  code: string;
  status: number;
  userMessage: string;
} {
  if (error instanceof ProviderError) {
    switch (error.code) {
      case "LLM_QUOTA_EXCEEDED":
        return {
          code: "llm_quota_exceeded",
          status: 429,
          userMessage:
            "Your Gemini free-tier daily quota is used up, so DocuMind can't generate a response right now. It resets automatically — try again in a few hours, or add a paid Google AI key in the project settings.",
        };
      case "LLM_UNAVAILABLE":
      case "EMBED_UNAVAILABLE":
        return {
          code: "ai_unavailable",
          status: 503,
          userMessage:
            "The AI model is temporarily unavailable. Please try again in a moment.",
        };
      case "RERANK_UNAVAILABLE":
        return {
          code: "rerank_unavailable",
          status: 200,
          userMessage:
            "Source ordering is a bit less precise right now (Cohere rerank is unavailable), but retrieval still worked.",
        };
      default:
        return { code: "ai_error", status: 503, userMessage: "The AI service is temporarily unavailable." };
    }
  }

  const status = (error as { status?: number })?.status;
  const message = messageText(error);
  if ((status === 429 || /429/i.test(message)) && isDailyQuotaText(message)) {
    return {
      code: "llm_quota_exceeded",
      status: 429,
      userMessage:
        "Your Gemini free-tier daily quota is used up, so DocuMind can't generate a response right now. It resets automatically — try again in a few hours, or add a paid Google AI key in the project settings.",
    };
  }
  if (status === 429 || /429/i.test(message)) {
    return {
      code: "llm_quota_exceeded",
      status: 429,
      userMessage:
        "The AI provider is receiving too many requests right now. Please wait a moment and try again.",
    };
  }
  if (status && status >= 400 && status < 500) {
    return {
      code: "request_rejected",
      status,
      userMessage: "The AI provider rejected the request. Please try again.",
    };
  }
  return { code: "internal_error", status: 500, userMessage: "Something went wrong on our end. Please try again." };
}

/** Convert a classified error to JSON-friendly metadata for logs/traces. */
export function toUserError(error: unknown) {
  return classifyError(error);
}

export type { ProviderErrorCode };