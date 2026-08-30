import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw new Error(error.message);
    return NextResponse.json({ conversations: data ?? [] });
  } catch (error) {
    console.error("[conversations]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list conversations" },
      { status: 500 }
    );
  }
}