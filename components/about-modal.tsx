"use client";

import { Info, Database, Search, Sparkles, ShieldCheck, LineChart } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

const PIPELINE_STEPS = [
  {
    icon: <Database className="h-4 w-4" />,
    title: "Ingestion",
    body: "PDF / DOCX / TXT / MD are parsed, recursively chunked at ~600 tokens with ~15% overlap, embedded with Gemini gemini-embedding-001 (768d) and stored in Supabase pgvector with a full-text index.",
  },
  {
    icon: <Search className="h-4 w-4" />,
    title: "Hybrid retrieval + rerank",
    body: "The query is rewritten for clarity, then cosine-similarity and Postgres full-text search results are fused via Reciprocal Rank Fusion over ~20 candidates. Cohere Rerank narrows to the top 5 (with graceful fallback to hybrid order on free-tier quota exhaustion).",
  },
  {
    icon: <Sparkles className="h-4 w-4" />,
    title: "Agentic generation",
    body: "Grounded prompting answers strictly from <context> blocks with inline citations. A multi-hop loop checks for missing evidence and re-searches (capped at 2 hops), then a final pass scores faithfulness (0-1) and flags unsupported sentences.",
  },
  {
    icon: <ShieldCheck className="h-4 w-4" />,
    title: "Guardrails",
    body: "Retrieved content is wrapped in delimited context tags, instruction-like patterns are neutralized before prompting, and every external call is traced with tokens, latency and estimated cost.",
  },
  {
    icon: <LineChart className="h-4 w-4" />,
    title: "Observability",
    body: "Every Gemini/Cohere call flows through Langfuse. The dashboard shows per-stage latency, cumulative token cost, recent queries and Ragas eval scores.",
  },
];

const STACK = [
  "Next.js 14",
  "Supabase + pgvector",
  "Gemini 3.5 Flash Lite",
  "gemini-embedding-001",
  "Cohere Rerank",
  "Langfuse",
  "shadcn/ui",
  "Ragas (offline)",
];

export function AboutModal() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="About DocuMind">
          <Info className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>DocuMind — Architecture</DialogTitle>
          <DialogDescription>
            Enterprise Agentic RAG research assistant. Everything runs on free tiers.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {PIPELINE_STEPS.map((step, i) => (
            <div key={step.title} className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {step.icon}
              </div>
              <div>
                <p className="text-sm font-semibold">
                  {i + 1}. {step.title}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </div>
            </div>
          ))}
          <Separator />
          <div>
            <p className="mb-2 text-sm font-semibold">Stack</p>
            <div className="flex flex-wrap gap-1.5">
              {STACK.map((s) => (
                <Badge key={s} variant="secondary">
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}