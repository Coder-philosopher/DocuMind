# DocuMind

**Author: Abdullah**

Enterprise Agentic RAG research assistant. Ask questions over your uploaded PDFs / DOCX / TXT / Markdown documents and get grounded, cited answers with a hallucination check, per-query observability, and offline evaluation. Built entirely on free tiers.

## Architecture


```
                           ┌────────────────────────────────────────────┐
 User ── upload ─────────► │ Ingestion: parse → chunk (~600 tok / 15%   │
   │                        │ overlap) → embed (gemini-embedding-001, 768d)│
   │                        │ → Supabase pgvector + full-text            │
   │                        └────────────────────────────────────────────┘
   │
   │ chat query
   ▼
 ┌─────────────┐   ┌─────────────────────────────────────────────────────┐
 │ /api/chat   ├──►│ Agentic pipeline (lib/agent/multihop.ts)            │
 └─────────────┘   │ rewrite → hybrid retrieve (RRF) → Cohere rerank (   │
                   │ fallback on quota) → grounded generation (citations)│
                   │ → multi-hop evidence check (max 2) → grounding audit│
                   └─────────────────────────────────────────────────────┘
                                   │
                                   ▼  every call
                   ┌─────────────────────────────────────────────────────┐
                   │ Langfuse tracing + query_logs (latency, tokens,     │
                   │ cost) → /dashboard · Ragas offline eval → eval_runs │
                   └─────────────────────────────────────────────────────┘
```

Guardrails: retrieved content is wrapped in delimited `<context>` blocks and instruction-like patterns are neutralized before prompting (`lib/guardrails/sanitize.ts`).

## Getting Started

### 1. Database (Supabase, free tier)

1. Create a project at [supabase.com](https://supabase.com) with the Postgres provider.
2. Enable the vector extension and run `supabase_schema.sql` in the SQL editor. It creates `documents`, `chunks` (pgvector 768 + HNSW + full-text), `conversations`, `messages` (citations + grounding score), `query_logs` (observability), `eval_runs`, and the `vector_search` / `full_text_search` RPCs.

### 2. API keys

All free tiers: Gemini (`GEMINI_API_KEY` from [aistudio.google.com](https://aistudio.google.com)), Cohere (`COHERE_API_KEY`), Langfuse (`LANGFUSE_SECRET_KEY` / `NEXT_PUBLIC_LANGFUSE_PUBLIC_KEY`).

```bash
cp env.local.example .env.local   # then fill in the values
npm install
npm run dev
```

Open http://localhost:3000, upload documents, and chat.

### 3. Tests & build

```bash
npm test          # unit tests: chunking, RRF, prompts, guardrails
npm run build
```

## Observability dashboard

Every chat turn is written to `query_logs`. Open **/dashboard** (bar-chart button in the header) for per-stage latency (rewrite / retrieve / rerank / generate / grounding), cumulative token counts, estimated LLM cost, and the latest Ragas eval run.

## Offline evaluation (Ragas)

```bash
pip install -r eval/requirements.txt
python eval/run_eval.py                 # docs localhost:3000
python eval/run_eval.py --url <deployed-url>
```

The script ingests `eval/sample_docs/`, asks the 18 questions in `eval/test_set.json` through the live `/api/chat`, scores faithfulness / context precision / answer relevancy with Ragas (using Gemini as the judge), and stores the run in `eval_runs` via `/api/eval-runs`.

## Deploying

1. Push this repository to GitHub.
2. Import it into [Vercel](https://vercel.com) (framework preset: Next.js).
3. Add all keys from `env.local.example` as environment variables (Supabase URL + anon key + service-role key must point at the same project that ran `supabase_schema.sql`).
4. Deploy. Set `NEXT_PUBLIC_*` variables before the build for server + client use.

## Project structure

- `app/` — routes: chat UI (`/`), dashboard (`/dashboard`), API handlers.
- `lib/ingest/` — parse, chunk, embed, index.
- `lib/retrieve/` — vector + FTS, reciprocal rank fusion.
- `lib/agent/` — rewrite, generate, grounding, multi-hop orchestrator, prompts.
- `lib/guardrails/` — prompt-injection sanitization.
- `lib/rerank/` — Cohere rerank with quota fallback.
- `lib/observability/` — Langfuse tracing (no-op when unset).
- `eval/` — Ragas offline evaluation harness.
- `supabase_schema.sql` — full schema + search RPCs.