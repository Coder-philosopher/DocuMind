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
import { ArrowLeft, Gauge, Activity, Coins, Database } from "lucide-react";

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

  const totalCost = ((totals.totalTokensIn + totals.totalTokensOut) * 0.00000375).toFixed(4);

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
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon={<Database className="h-4 w-4" />}
                label="Queries logged"
                value={String(totals.totalQueries)}
              />
              <StatCard
                icon={<Activity className="h-4 w-4" />}
                label="Avg latency"
                value={`${totals.avgLatencyMs}ms`}
              />
              <StatCard
                icon={<Coins className="h-4 w-4" />}
                label="Tokens (in + out)"
                value={(totals.totalTokensIn + totals.totalTokensOut).toLocaleString()}
              />
              <StatCard
                icon={<Coins className="h-4 w-4" />}
                label="Estimated LLM cost"
                value={`$${totalCost}`}
              />
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

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold">{value}</p>
        </div>
      </CardContent>
    </Card>
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