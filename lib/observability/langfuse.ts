import { Langfuse } from "langfuse";

import { env, hasLangfuse } from "@/lib/config";

let _client: Langfuse | null = null;

export function getLangfuseClient(): Langfuse | null {
  if (!hasLangfuse()) return null;
  if (!_client) {
    _client = new Langfuse({
      publicKey: env.langfusePublicKey,
      secretKey: env.langfuseSecretKey,
      baseUrl: env.langfuseHost,
    });
  }
  return _client;
}

export interface TraceEventOptions {
  name: string;
  input?: unknown;
  sessionId?: string;
  tags?: string[];
}

export interface TraceHandle {
  update: (params: { output?: unknown; usage?: { input: number; output: number } }) => Promise<void>;
  error: (message: string) => Promise<void>;
  flush: () => Promise<void>;
  id: string;
}

/**
 * Creates a trace (span) in Langfuse. No-ops gracefully when Langfuse
 * credentials are absent so the app keeps working without telemetry.
 */
export async function traceEvent(options: TraceEventOptions): Promise<TraceHandle> {
  const client = getLangfuseClient();
  const id = crypto.randomUUID();

  if (!client) {
    return {
      id,
      update: async () => {},
      error: async () => {},
      flush: async () => {},
    };
  }

  const trace = client.trace({
    name: options.name,
    input: options.input,
    sessionId: options.sessionId,
    tags: options.tags,
  });
  // Use a generation span for LLM-style calls.
  const generation = trace.generation({
    name: options.name,
    input: options.input,
    model: "",
  });

  return {
    id,
    update: async (params) => {
      const usage = params.usage
        ? { input: params.usage.input, output: params.usage.output }
        : undefined;
      generation.update({
        output: params.output,
        usage,
      });
    },
    error: async (message) => {
      generation.update({ level: "ERROR", statusMessage: message });
    },
    flush: async () => {
      await client.flushAsync();
    },
  };
}