import { Readable } from "stream";

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createServerSupabase } from "@/lib/supabase/server";
import { runAgenticAnswer, runAgenticAnswerStreamed } from "@/lib/agent/multihop";
import { buildSynopsis } from "@/lib/agent/prompts";
import { classifyError } from "@/lib/agent/errors";
import type { Citation } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const RESPONSE_START_PATTERN = /^(?:please\s+|kindly\s+)?(?:summar(?:y|ize|ise)|overview|tell me about)\b/i;
const SYNTHESIS_PATTERN =
  /(summar|overview|o?ver-?all|tell me about|put together|combine|synthesis)/i;

function isSynopsisQuery(message: string): boolean {
  const q = message.toLowerCase();
  if ("summarise the docs" === q || "summarize the docs" === q) return true;
  const docCountWords = /\b(the|these|all|our|customer|uploaded)\s+dou?c(?:s|uments)?\b/.test(q);
  return docCountWords && RESPONSE_START_PATTERN.test(q) && SYNTHESIS_PATTERN.test(q);
}

/** Literal, unexpanded "here are your files" fallback for when the LLM quota
 *  forbids actual synthesis. Never fabricates; uses only filenames + sizes. */
async function fetchSynopsisDocuments(supabase: SupabaseClient): Promise<
  { filename: string; content: string }[] | null
> {
  const { data: docs } = await supabase
    .from("documents")
    .select("id, filename")
    .eq("status", "ready");
  if (!docs || docs.length === 0) return null;
  const ids = docs.map((d) => d.id as string);
  const { data: chunks } = await supabase
    .from("chunks")
    .select("content, document_id, chunk_index")
    .in("document_id", ids)
    .order("chunk_index", { ascending: true })
    .limit(80);
  const byDoc = new Map<string, string[]>();
  for (const c of chunks ?? []) {
    const key = String(c.document_id);
    if (!byDoc.has(key)) byDoc.set(key, []);
    const arr = byDoc.get(key)!;
    if (arr.length < 4) arr.push(String(c.content ?? ""));
  }
  const filenames = new Map(docs.map((d) => [String(d.id), String(d.filename)]));
  const out: { filename: string; content: string }[] = [];
  for (const [docId, contents] of Array.from(byDoc.entries())) {
    out.push({
      filename: filenames.get(docId) ?? "document",
      content: contents.join("\n"),
    });
  }
  return out.slice(0, 6);
}

async function persistUserInput(
  supabase: SupabaseClient,
  message: string,
  conversationId: string | null
): Promise<string> {
  let convoId = conversationId;
  if (!convoId) {
    const title = message.length > 60 ? `${message.slice(0, 60)}â€¦` : message;
    const { data: convo, error: convoError } = await supabase
      .from("conversations")
      .insert({ title })
      .select()
      .single();
    if (convoError || !convo) {
      throw new Error(`Failed to create conversation: ${convoError?.message}`);
    }
    convoId = convo.id;
  }
  const { error: userMsgError } = await supabase
    .from("messages")
    .insert({ conversation_id: convoId, role: "user", content: message });
  if (userMsgError) throw new Error(`Failed to save message: ${userMsgError.message}`);
  return convoId as string;
}

async function loadConversationHistory(
  supabase: SupabaseClient,
  convoId: string
): Promise<{ role: "user" | "assistant"; content: string }[]> {
  const { data: historyRows } = await supabase
    .from("messages")
    .select("role, content")
    .eq("conversation_id", convoId)
    .order("created_at", { ascending: true })
    .limit(10);
  return (historyRows ?? [])
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-8)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}

function sseEncode(payload: object): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

interface StreamOutgoing {
  type: "delta" | "reset" | "done" | "error";
  text?: string;
  content?: string;
  citations?: Citation[];
  groundingScore?: number;
  agentSteps?: unknown[];
  conversationId?: string;
  unsupportedSentences?: unknown[];
  error?: string;
  code?: string;
}

async function handlePayloadError(
  supabase: SupabaseClient,
  convoId: string,
  query: string,
  error: unknown
): Promise<NextResponse> {
  const { code, status, userMessage } = classifyError(error);
  console.error("[chat:error]", code, error);

  await supabase
    .from("messages")
    .insert({
      conversation_id: convoId,
      role: "assistant",
      content: userMessage,
      citations: [],
      grounding_score: status === 429 ? 0 : null,
    })
    .then((res) => {
      if (res.error) console.error("[chat] failed to persist error note", res.error.message);
    });

  return NextResponse.json({ error: userMessage, code, message: userMessage }, { status });
}

async function persistAssistantAndLog(
  supabase: SupabaseClient,
  convoId: string,
  query: string,
  answer: {
    content: string;
    citations: Citation[];
    groundingScore: number;
    rewrittenQuery?: string;
    latency?: Record<string, number>;
    usage: { input: number; output: number };
    rerankFallback?: string;
  }
): Promise<{ id: string; created_at: string } | null> {
  const { data: savedMsg, error: assistantMsgError } = await supabase
    .from("messages")
    .insert({
      conversation_id: convoId,
      role: "assistant",
      content: answer.content,
      citations: answer.citations,
      grounding_score: answer.groundingScore,
    })
    .select()
    .single();
  if (assistantMsgError) throw new Error(`Failed to save assistant message: ${assistantMsgError.message}`);

  await supabase.from("query_logs").insert({
    conversation_id: convoId,
    query,
    rewritten_query: (answer.rewrittenQuery ?? query).slice(0, 500),
    latency_ms: answer.latency ?? {},
    tokens_in: answer.usage.input,
    tokens_out: answer.usage.output,
    rerank_fallback: Boolean(answer.rerankFallback),
  });

  return savedMsg ? { id: savedMsg.id, created_at: savedMsg.created_at } : null;
}

export async function GET(request: NextRequest) {
  const supabase = createServerSupabase();
  const conversationId = request.nextUrl.searchParams.get("conversationId");
  if (!conversationId) return new Response("conversationId required", { status: 400 });

  const { data: conv } = await supabase
    .from("conversations")
    .select("id, title, created_at")
    .eq("id", conversationId)
    .single();
  if (!conv) return new Response("conversation not found", { status: 404 });

  const history = await loadConversationHistory(supabase, conversationId);
  return NextResponse.json({ conversation: conv, messages: history });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const message = (body.message ?? "").trim();
    const conversationId: string | null = body.conversationId ?? null;
    const stream = body.stream === true;

    // Ignore Langfuse-style webhook probes (they have no message).
    if (!message && body.subscriptionType) {
      return NextResponse.json({ ok: true });
    }

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const supabase = createServerSupabase();
    const convoId = await persistUserInput(supabase, message, conversationId);
    const history = await loadConversationHistory(supabase, convoId);

    if (stream) {
      const encoder = new TextEncoder();
      const streamInstance = new ReadableStream<StreamOutgoing>({
        async start(controller) {
          const send = (payload: StreamOutgoing) => {
            try {
              controller.enqueue(payload);
            } catch {
              /* client gone */
            }
          };

          let finished = false;
          let closed = false;
          const safeClose = () => {
            if (!closed) {
              closed = true;
              try {
                controller.close();
              } catch {
                /* already closed by the consumer */
              }
            }
          };

          const finalize = async (answer: {
            content: string;
            citations: Citation[];
            groundingScore: number;
            rewrittenQuery?: string;
            latency?: Record<string, number>;
            usage: { input: number; output: number };
            rerankFallback?: string;
            agentSteps?: unknown[];
            unsupportedSentences?: unknown[];
          }) => {
            if (finished) return;
            finished = true;
            let saved: { id: string; created_at: string } | null = null;
            try {
              saved = await persistAssistantAndLog(supabase, convoId, message, answer);
            } catch (persistError) {
              // Never let a persistence hiccup block the answer from reaching
              // the client — best-effort.
              console.error("[chat:stream:persist]", persistError);
            }
            send({
              type: "done",
              conversationId: convoId,
              content: answer.content,
              citations: answer.citations ?? [],
              groundingScore: answer.groundingScore,
              agentSteps: answer.agentSteps ?? [],
              unsupportedSentences: answer.unsupportedSentences ?? [],
              ...(saved ? { messageId: saved.id } : {}),
            });
            safeClose();
          };

          try {
            for await (const event of runAgenticAnswerStreamed({
              query: message,
              conversationHistory: history.slice(0, -1),
            })) {
              if (event.type === "delta" || event.type === "reset") {
                send(event);
              } else if (event.type === "done") {
                await finalize(event);
                return;
              }
            }
            // Guard: stream ended without a done event.
            if (!finished) {
              await finalize({
                content: "I finished but did not produce a complete answer. Please try again.",
                citations: [],
                groundingScore: 0.4,
                usage: { input: 0, output: 0 },
              });
            }
          } catch (error) {
            if (!finished) {
              // Literal fallback for a quota-exhausted summarise request.
              if (classifyError(error).code === "llm_quota_exceeded" && isSynopsisQuery(message)) {
                try {
                  const docs = await fetchSynopsisDocuments(supabase);
                  if (docs && docs.length > 0) {
                    const synopsis = buildSynopsis(docs);
                    await finalize({
                      content: synopsis,
                      citations: [],
                      groundingScore: 1.0,
                      usage: { input: 0, output: 0 },
                    });
                    return;
                  }
                } catch {
                  /* fall through to friendly quota error */
                }
              }
              const { code, userMessage } = classifyError(error);
              console.error("[chat:stream:error]", code, error);
              send({
                type: "error",
                error: userMessage,
                code,
                conversationId: convoId,
              });
            }
          } finally {
            safeClose();
          }
        },
      });

      const nodeStream = Readable.from(async function* () {
        const reader = streamInstance.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            yield encoder.encode(sseEncode(value));
          }
        } finally {
          reader.releaseLock();
        }
      }());

      return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    // ---- Non-streaming (default) ----
    try {
      const answer = await runAgenticAnswer({
        query: message,
        conversationHistory: history.slice(0, -1),
      });
      const saved = await persistAssistantAndLog(supabase, convoId, message, answer);
      return NextResponse.json({
        conversationId: convoId,
        message: { ...saved, content: answer.content, citations: answer.citations, grounding_score: answer.groundingScore },
        agentSteps: answer.agentSteps,
        unsupportedSentences: answer.unsupportedSentences ?? null,
        usage: answer.usage,
      });
    } catch (error) {
      // Literal fallback for a quota-exhausted summarise request.
      if (classifyError(error).code === "llm_quota_exceeded" && isSynopsisQuery(message)) {
        try {
          const docs = await fetchSynopsisDocuments(supabase);
          if (docs && docs.length > 0) {
            const synopsis = buildSynopsis(docs);
            const saved = await persistAssistantAndLog(supabase, convoId, message, {
              content: synopsis,
              citations: [],
              groundingScore: 1.0,
              usage: { input: 0, output: 0 },
            });
            return NextResponse.json({
              conversationId: convoId,
              message: { ...saved, content: synopsis, citations: [], grounding_score: 1.0 },
              agentSteps: [],
              unsupportedSentences: [],
              usage: { input: 0, output: 0 },
            });
          }
        } catch {
          /* fall through to friendly quota error */
        }
      }
      return handlePayloadError(supabase, convoId, message, error);
    }
  } catch (error) {
    console.error("[chat]", error);
    return NextResponse.json({ error: "Something went wrong on our end. Please try again." }, { status: 500 });
  }
}