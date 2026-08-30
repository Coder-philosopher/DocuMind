import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Aggregated dashboard data: recent query logs, cumulative token cost, and the
 * latest eval run. Renders the /dashboard page.
 */
export async function GET() {
  try {
    const supabase = createServerSupabase();

    const [logsRes, totalsRes, evalRes] = await Promise.all([
      supabase
        .from("query_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("query_logs")
        .select("tokens_in, tokens_out, latency_ms, created_at, query, rerank_fallback")
        .order("created_at", { ascending: true })
        .limit(500),
      supabase
        .from("eval_runs")
        .select("*")
        .order("run_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (logsRes.error) throw new Error(logsRes.error.message);
    if (totalsRes.error) throw new Error(totalsRes.error.message);
    if (evalRes.error) throw new Error(evalRes.error.message);

    const rows = totalsRes.data ?? [];
    const totalTokensIn = rows.reduce((s, r) => s + (r.tokens_in ?? 0), 0);
    const totalTokensOut = rows.reduce((s, r) => s + (r.tokens_out ?? 0), 0);
    const avgLatency =
      rows.length > 0
        ? Math.round(
            rows.reduce((s, r) => {
              const lat = r.latency_ms as Record<string, number> | null;
              const total = Object.values(lat ?? {}).reduce((a, b) => a + b, 0);
              return s + total;
            }, 0) / rows.length
          )
        : 0;

    return NextResponse.json({
      logs: logsRes.data ?? [],
      totals: {
        totalTokensIn,
        totalTokensOut,
        totalQueries: rows.length,
        avgLatencyMs: avgLatency,
      },
      latestEvalRun: evalRes.data ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load dashboard" },
      { status: 500 }
    );
  }
}