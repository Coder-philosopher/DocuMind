"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as ChartTooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { ArrowLeft, Gauge, Activity, Coins, Database, RefreshCw, Timer, GaugeCircle } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface QueryLog {
  id: string;
  query: string;
  rewritten_query: string;
  latency_ms: Record<string, number>;
  tokens_in: number;
  tokens_out: number;
  rerank_fallback: boolean;
  created_at: string;
}

interface EvalRun {
  id: string;
  run_at: string;
  faithfulness: number | null;
  context_precision: number | null;
  answer_relevancy: number | null;
  notes: string | null;
}

export default function DashboardPage() {
  const [logs, setLogs] = useState<QueryLog[]>([]);
  const [totals, setTotals] = useState({
    totalTokensIn: 0,
    totalTokensOut: 0,
    totalQueries: 0,
    avgLatencyMs: 0,
    avgTokensPerQuery: 0,
    latencyBreakdown: {} as Record<string, number>,
    avgStageLatency: {} as Record<string, number>,
    rerankFallbackCount: 0,
    rerankFallbackPct: 0,
  });
  const [latestEvalRun, setLatestEvalRun] = useState<EvalRun | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/dashboard");
        if (res.ok) {
          const data = await res.json();
          setLogs(data.logs ?? []);
          setTotals(data.totals ?? {});
          setLatestEvalRun(data.latestEvalRun ?? null);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const latencySeries = logs
    .slice()
    .reverse()
    .map((log, i) => {
      const lat = log.latency_ms ?? {};
      return {
        name: `#${i + 1}`,
        retrieve: Math.round(lat.retrieve ?? 0),
        rerank: Math.round(lat.rerank ?? 0),
        generate: Math.round(lat.generate ?? 0),
        grounding: Math.round(lat.grounding ?? 0),
      };
    });

  // Pricing: gemini-3.5-flash-lite is free, but model these rates for cost
  // projection (input cheaper than output).
  const INPUT_RATE_PER_1K = 0.00025; // $ / 1k input tokens
  const OUTPUT_RATE_PER_1K = 0.001; // $ / 1k output tokens
  const costIn = (totals.totalTokensIn / 1000) * INPUT_RATE_PER_1K;
  const costOut = (totals.totalTokensOut / 1000) * OUTPUT_RATE_PER_1K;
  const totalCost = costIn + costOut;
  const avgCostPerQuery = totals.totalQueries > 0 ? totalCost / totals.totalQueries : 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <Link href="/">
              <Button variant="ghost" size="sm" className="mb-2 -ml-2">
                <ArrowLeft className="mr-1 h-4 w-4" /> Back to chat
              </Button>
            </Link>
            <h1 className="text-2xl font-bold tracking-tight">Observability Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              Query traces, per-stage latency, token cost and Ragas evaluation results.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={<Database className="h-4 w-4" />}
                label="Queries logged"
                value={String(totals.totalQueries)}
                sub="total requests"
              />
              <StatCard
                icon={<Timer className="h-4 w-4" />}
                label="Avg latency"
                value={`${totals.avgLatencyMs}ms`}
                sub="per query, all stages"
              />
              <StatCard
                icon={<Coins className="h-4 w-4" />}
                label="Total tokens"
                value={(totals.totalTokensIn + totals.totalTokensOut).toLocaleString()}
                sub={`~${totals.avgTokensPerQuery.toLocaleString()} / query`}
              />
              <StatCard
                icon={<Coins className="h-4 w-4" />}
                label="Estimated LLM cost"
                value={`$${totalCost.toFixed(4)}`}
                sub={`avg $${avgCostPerQuery.toFixed(6)} / query`}
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Coins className="h-4 w-4 text-primary" /> Token usage
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <MetricRow label="Input tokens" value={totals.totalTokensIn.toLocaleString()} />
                  <MetricRow label="Output tokens" value={totals.totalTokensOut.toLocaleString()} />
                  <MetricRow label="Avg per query" value={totals.avgTokensPerQuery.toLocaleString()} />
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{
                        width: `${Math.min(
                          100,
                          (totals.totalTokensIn / Math.max(1, totals.totalTokensIn + totals.totalTokensOut)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">Input share of total tokens</p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <GaugeCircle className="h-4 w-4 text-primary" /> Cost breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <MetricRow label="Input cost" value={`$${costIn.toFixed(4)}`} />
                  <MetricRow label="Output cost" value={`$${costOut.toFixed(4)}`} />
                  <MetricRow label="Total cost" value={`$${totalCost.toFixed(4)}`} />
                  <p className="rounded-md bg-muted/60 px-2 py-1.5 text-[11px] text-muted-foreground">
                    Est. model rates ${INPUT_RATE_PER_1K}/1k in, ${OUTPUT_RATE_PER_1K}/1k out.
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <RefreshCw className="h-4 w-4 text-primary" /> Retrieval quality
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <MetricRow
                    label="Rerank fallbacks"
                    value={`${totals.rerankFallbackCount} (${totals.rerankFallbackPct}%)`}
                  />
                  <MetricRow label="Rerank success" value={`${100 - totals.rerankFallbackPct}%`} />
                  <p className="rounded-md bg-muted/60 px-2 py-1.5 text-[11px] text-muted-foreground">
                    Fallback = Cohere unavailable, used hybrid order instead.
                  </p>
                </CardContent>
              </Card>
            </div>

            {latestEvalRun && (
              <div className="mt-6 grid gap-4 sm:grid-cols-3">
                <EvalCard
                  label="Faithfulness"
                  value={latestEvalRun.faithfulness}
                  note={latestEvalRun.notes}
                />
                <EvalCard
                  label="Context Precision"
                  value={latestEvalRun.context_precision}
                  note={latestEvalRun.notes}
                />
                <EvalCard
                  label="Answer Relevancy"
                  value={latestEvalRun.answer_relevancy}
                  note={latestEvalRun.notes}
                />
              </div>
            )}

            <Tabs defaultValue="latency" className="mt-8">
              <TabsList>
                <TabsTrigger value="latency">
                  <Gauge className="mr-1.5 h-4 w-4" /> Latency
                </TabsTrigger>
                <TabsTrigger value="queries">
                  <Activity className="mr-1.5 h-4 w-4" /> Recent queries
                </TabsTrigger>
              </TabsList>

              <TabsContent value="latency" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Latency breakdown by pipeline stage</CardTitle>
                    <CardDescription>
                      Milliseconds per stage across recent queries.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="h-[320px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={latencySeries} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                        <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <ChartTooltip />
                        <Legend />
                        <Line type="monotone" dataKey="retrieve" stroke="#2563eb" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="rerank" stroke="#7c3aed" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="generate" stroke="#059669" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="grounding" stroke="#d97706" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="queries" className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle>Recent queries</CardTitle>
                    <CardDescription>
                      The latest 50 calls with per-query stage latency and token usage.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Query</TableHead>
                          <TableHead>Rewritten</TableHead>
                          <TableHead>Total ms</TableHead>
                          <TableHead>Tokens</TableHead>
                          <TableHead>Rerank</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {logs.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                              No queries logged yet. Ask something in the chat first.
                            </TableCell>
                          </TableRow>
                        )}
                        {logs.map((log) => {
                          const total = Object.values(log.latency_ms ?? {}).reduce((a, b) => a + b, 0);
                          return (
                            <TableRow key={log.id}>
                              <TableCell className="max-w-[220px] truncate" title={log.query}>
                                {log.query}
                              </TableCell>
                              <TableCell className="max-w-[180px] truncate text-muted-foreground" title={log.rewritten_query}>
                                {log.rewritten_query === log.query ? "—" : log.rewritten_query}
                              </TableCell>
                              <TableCell>{Math.round(total)}ms</TableCell>
                              <TableCell>
                                {(log.tokens_in ?? 0) + (log.tokens_out ?? 0)}
                              </TableCell>
                              <TableCell>
                                {log.rerank_fallback ? (
                                  <Badge variant="warning">fallback</Badge>
                                ) : (
                                  <Badge variant="success">cohere</Badge>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-xl font-semibold">{value}</p>
          {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

function EvalCard({
  label,
  value,
  note,
}: {
  label: string;
  value: number | null;
  note: string | null;
}) {
  const score = value == null ? 0 : Math.round(value * 100);
  return (
    <Card className="border-primary/20">
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p className="mt-1 text-2xl font-bold">{value == null ? "—" : `${score}%`}</p>
        {note && <p className="mt-1 text-[11px] text-muted-foreground">{note}</p>}
      </CardContent>
    </Card>
  );
}