# DocuMind — Enterprise Agentic RAG Research Assistant

## 0. Project summary
DocuMind is a web application where a user uploads enterprise-style documents (PDFs, DOCX, TXT, MD) and asks natural-language questions in a chat interface. The system performs hybrid retrieval, reranking, multi-hop agentic search, and hallucination/grounding checks before returning an answer with clickable inline citations back to exact source chunks. It logs token cost/latency for every LLM call and includes an eval pipeline. The UI must feel like a polished, real product — not a bare-bones chatbot demo. Everything runs on free tiers only. opencode is the sole builder of this project from an empty repo to a deployed app; this document is the complete spec, and opencode should not need to ask for scope beyond what's written here.

## 1. Tech stack (all free tier — do not substitute paid services)
- **Framework**: Next.js 14 (App Router), TypeScript, Tailwind CSS
- **UI components**: `shadcn/ui` (Radix-based, open-source, copy-in — not a paid library). Also use `lucide-react` for icons and `framer-motion` (free, MIT) for micro-interactions/animations. Use `recharts` for the eval dashboard charts.
- **Backend**: Next.js Route Handlers (Node.js runtime) — no separate backend service
- **Database + vector store**: Supabase free tier — Postgres with the `pgvector` extension
- **LLM (generation, query rewriting, grounding checks)**: Google Gemini API, `gemini-2.0-flash` (free tier)
- **Embeddings**: Gemini `text-embedding-004` (free tier)
- **Reranker**: Cohere Rerank free tier (`rerank-english-v3.0`), with graceful skip-if-quota-exceeded fallback to raw hybrid-search order
- **Observability**: Langfuse free cloud tier — trace every LLM call with tokens, latency, cost
- **Eval**: Ragas (Python) run as an offline script against a fixed Q&A test set, not part of the live request path
- **Deployment**: Vercel (frontend + API routes, free tier), Supabase (DB, free tier)
- **Secrets**: all keys read from `.env.local` via `process.env`; never hardcoded. Required vars: `GEMINI_API_KEY`, `COHERE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`. Generate a `.env.local.example` with all of these listed and blank.

## 2. Database schema (Supabase / Postgres)
- `documents`: `id`, `filename`, `file_type`, `uploaded_at`, `status` (processing/ready/failed), `page_count`
- `chunks`: `id`, `document_id` (FK), `content` (text), `embedding` (`vector(768)`), `page_number`, `chunk_index`, `token_count`. Add an HNSW or IVFFlat index on `embedding` for cosine similarity, and a `tsvector` generated column on `content` for full-text/keyword search.
- `conversations`: `id`, `title`, `created_at`
- `messages`: `id`, `conversation_id` (FK), `role` (user/assistant), `content`, `citations` (jsonb array of chunk ids + snippet + page), `grounding_score` (float, nullable), `created_at`
- `eval_runs`: `id`, `run_at`, `faithfulness`, `context_precision`, `answer_relevancy`, `notes` (for the Ragas offline reports)

## 3. Build in exactly 3 phases (commit after each; verify it runs before moving on)

### Phase 1 — Foundation, Ingestion & Core RAG Chat (with polished UI from day one)
Do not treat UI as an afterthought bolted on at the end — build it correctly in this phase since every later phase adds onto it.

**App shell & UI**: Set up a three-pane layout — a collapsible left sidebar (document list with upload status badges, a prominent drag-and-drop upload zone using shadcn `Card` + `Dialog`), a center chat panel (message bubbles styled distinctly for user vs. assistant, markdown rendering for answers, a sticky input bar with a send button and a subtle "thinking" state), and a slide-over right panel for inspecting cited sources. Use a clean neutral palette (e.g., slate/zinc base with one accent color), support dark mode via `next-themes`, use `framer-motion` for message-appear transitions and skeleton loaders during retrieval/generation, and ensure full responsiveness down to mobile width (sidebar collapses to a drawer). Empty states matter: show a friendly placeholder before any document is uploaded, and a helpful prompt suggestion list ("Try asking: ...") once documents are ready.

**Ingestion pipeline**: Upload endpoint accepting PDF/DOCX/TXT/MD (use `pdf-parse` for PDF, `mammoth` for DOCX, size-limit and type-allowlist validation). Recursive chunking at ~500–800 tokens with ~15% overlap, preserving page numbers. Generate embeddings per chunk via Gemini's embedding endpoint (batch where possible) and store in Supabase. Show live per-document status in the sidebar (processing → ready → failed with retry).

**Core retrieval & chat**: Implement hybrid search — cosine similarity via a Supabase RPC function plus Postgres full-text search — merged with reciprocal rank fusion. Build the chat route: retrieve top-k chunks for the query, construct a strict prompt instructing Gemini to answer only from the given `<context>` blocks and cite sources inline as `[1]`, `[2]`, etc. Render those citation markers as clickable badges in the chat UI that open the right-side source panel showing the exact chunk text and page number highlighted. Persist conversations and messages in Supabase so history survives reloads.

### Phase 2 — Agentic Intelligence Layer
- **Query rewriting**: before retrieval, send the raw query plus the last 2–3 conversation turns to Gemini to produce a disambiguated, standalone search query.
- **Reranking**: retrieve a wider candidate set (~20 chunks) via hybrid search, then rerank with Cohere down to the top 5; fall back cleanly to hybrid-search order if the Cohere quota is exhausted, and surface this fallback quietly in the trace log (not to the end user).
- **Multi-hop retrieval loop**: after producing a draft answer, make a structured (JSON-mode) call to Gemini asking whether the answer is fully supported by the retrieved context or whether an additional targeted search is needed. If insufficient, generate a follow-up sub-query and retrieve again, capped at 2–3 hops total to control cost and latency. Show this reasoning to the user as a subtle, collapsible "Agent steps" trace under the answer (e.g., "Searched → Reranked → Needed more evidence → Searched again → Answered") using a shadcn `Accordion`, so the agentic behavior is visible and demoable, not hidden — this is the single most interview-relevant UI feature to get right.
- **Grounding / hallucination check**: a final LLM pass that scores overall faithfulness (0–1) and flags any specific sentence in the answer unsupported by retrieved context. Surface this as a small confidence badge next to each assistant message (e.g., green/yellow/red), with unsupported sentences underlined and explained on hover.

### Phase 3 — Guardrails, Observability, Eval & Deployment (production polish)
- **Prompt-injection defense**: wrap all retrieved document content in clearly delimited `<context>` tags with an explicit system instruction that content inside is data to reference, never instructions to follow; strip/neutralize obvious instruction-like patterns found inside retrieved chunks before they reach the prompt.
- **Observability**: wrap every Gemini/Cohere call (rewrite, retrieve, rerank, generate, grounding-check) in Langfuse tracing capturing tokens in/out, latency, and estimated cost. Build a `/dashboard` route (shadcn `Tabs` + `Table` + `recharts` line/bar charts) showing recent queries, per-query latency breakdown by pipeline stage, and cumulative token cost — make this visually clean since it doubles as a portfolio screenshot.
- **Eval**: write a standalone Python script using Ragas against a fixed set of ~15–20 Q&A pairs over a sample document set, reporting faithfulness, context precision, and answer relevancy; store results in the `eval_runs` table and render the latest run's scores as cards at the top of the dashboard.
- **Final UI pass**: loading skeletons everywhere data is fetched, toast notifications (shadcn `Sonner`) for upload success/failure, keyboard shortcuts (Cmd/Ctrl+K to focus chat input), and an about/architecture modal summarizing the pipeline for anyone viewing the deployed demo.
- **Deploy**: push to GitHub, deploy on Vercel with environment variables configured in the Vercel dashboard, confirm the Supabase project and pgvector index are live, and do a full end-to-end test on the real deployed URL — including a slow/large PDF and an intentionally injected instruction inside a test document — before calling it done.

## 4. Non-negotiables for opencode
- Never answer without at least one traceable citation; if retrieval returns nothing relevant, say so explicitly rather than guessing.
- Every external API call must handle rate-limit/failure gracefully (free tiers will throttle) — degrade, don't crash.
- Keep logic modular: `/lib/ingest`, `/lib/retrieve`, `/lib/rerank`, `/lib/agent`, `/lib/guardrails`, `/lib/observability` — each independently testable before wiring into UI or API routes.
- UI quality is a first-class requirement, not polish left for "later" — treat Phase 1's UI as the permanent foundation.