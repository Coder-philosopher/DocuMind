import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const supabase = createServerSupabase();
    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", params.id)
      .single();
    if (convError) throw new Error(convError.message);

    const { data: messages, error: msgError } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", params.id)
      .order("created_at", { ascending: true });
    if (msgError) throw new Error(msgError.message);

    return NextResponse.json({ conversation, messages: messages ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load conversation" },
      { status: 500 }
    );
  }
}