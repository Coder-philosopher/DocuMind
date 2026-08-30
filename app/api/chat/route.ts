import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { hybridSearch } from "@/lib/retrieve";
import { generateAnswer } from "@/lib/agent/answer";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const message = (body.message ?? "").trim();
    const conversationId: string | null = body.conversationId ?? null;

    if (!message) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const supabase = createServerSupabase();

    // Ensure conversation exists (creating it with a title derived from the query).
    let convoId = conversationId;
    if (!convoId) {
      const title = message.length > 60 ? `${message.slice(0, 60)}…` : message;
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

    // Persist the user message.
    const { error: userMsgError } = await supabase
      .from("messages")
      .insert({ conversation_id: convoId, role: "user", content: message });
    if (userMsgError) throw new Error(`Failed to save message: ${userMsgError.message}`);

    // Load recent history for context (last 6 turns).
    const { data: historyRows } = await supabase
      .from("messages")
      .select("role, content")
      .eq("conversation_id", convoId)
      .order("created_at", { ascending: true })
      .limit(10);
    const history = (historyRows ?? [])
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-8)
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    // Retrieve then generate.
    const results = await hybridSearch(message, 5);
    const answer = await generateAnswer({
      query: message,
      results,
      conversationHistory: history.slice(0, -1),
    });

    // Persist the assistant message with citations.
    const { data: savedMsg, error: assistantMsgError } = await supabase
      .from("messages")
      .insert({
        conversation_id: convoId,
        role: "assistant",
        content: answer.content,
        citations: answer.citations,
        grounding_score: null,
      })
      .select()
      .single();
    if (assistantMsgError) {
      throw new Error(`Failed to save assistant message: ${assistantMsgError.message}`);
    }

    return NextResponse.json({
      conversationId: convoId,
      message: savedMsg,
      agentSteps: answer.agentSteps,
      usage: answer.usage,
    });
  } catch (error) {
    console.error("[chat]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chat failed" },
      { status: 500 }
    );
  }
}