import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from("eval_runs")
      .select("*")
      .order("run_at", { ascending: false })
      .limit(20);
    if (error) throw new Error(error.message);
    return NextResponse.json({ runs: data ?? [] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load eval runs" },
      { status: 500 }
    );
  }
}

/** Used by the offline Ragas eval script to store its results. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const faithfulness = Number(body.faithfulness);
    const context_precision = Number(body.context_precision);
    const answer_relevancy = Number(body.answer_relevancy);
    const notes = String(body.notes ?? "");

    if (Number.isNaN(faithfulness) || Number.isNaN(context_precision) || Number.isNaN(answer_relevancy)) {
      return NextResponse.json({ error: "Scores must be numeric" }, { status: 400 });
    }

    const supabase = createServerSupabase();
    const { data, error } = await supabase
      .from("eval_runs")
      .insert({ faithfulness, context_precision, answer_relevancy, notes })
      .select()
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json(data, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to store eval run" },
      { status: 500 }
    );
  }
}