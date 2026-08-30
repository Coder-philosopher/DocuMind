-- Enable pgvector extension
create extension if not exists vector;

-- Documents table
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  file_type text not null,
  uploaded_at timestamp with time zone default now(),
  status text not null check (status in ('processing', 'ready', 'failed')),
  page_count integer
);

-- Chunks table
create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id) on delete cascade,
  content text not null,
  embedding vector(768), -- Gemini text-embedding-004 is 768 dimensions
  page_number integer,
  chunk_index integer,
  token_count integer
);

-- Index for vector similarity search
create index on chunks using hnsw (embedding vector_cosine_ops);

-- Full-text search column and index
alter table chunks add column if not exists fts tsvector generated always as (to_tsvector('english', content)) stored;
create index on chunks using gin (fts);

-- Conversations table
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  title text not null default 'New Conversation',
  created_at timestamp with time zone default now()
);

-- Messages table
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  citations jsonb default '[]'::jsonb, -- array of {chunk_id, snippet, page}
  grounding_score float,
  created_at timestamp with time zone default now()
);

-- Eval runs table
create table if not exists eval_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamp with time zone default now(),
  faithfulness float,
  context_precision float,
  answer_relevancy float,
  notes text
);

-- RPC: vector-only similarity search (cosine)
create or replace function vector_search(
  query_embedding vector(768),
  match_count int default 20,
  min_similarity float default 0.0
) returns table (
  id uuid,
  document_id uuid,
  content text,
  page_number int,
  chunk_index int,
  similarity float
) language sql stable as $$
  select
    chunks.id,
    chunks.document_id,
    chunks.content,
    chunks.page_number,
    chunks.chunk_index,
    1 - (chunks.embedding <=> query_embedding) as similarity
  from chunks
  where 1 - (chunks.embedding <=> query_embedding) >= min_similarity
  order by chunks.embedding <=> query_embedding
  limit match_count;
$$;

-- RPC: full-text keyword search
create or replace function full_text_search(
  query_text text,
  match_count int default 20
) returns table (
  id uuid,
  document_id uuid,
  content text,
  page_number int,
  chunk_index int,
  similarity float
) language sql stable as $$
  select
    chunks.id,
    chunks.document_id,
    chunks.content,
    chunks.page_number,
    chunks.chunk_index,
    ts_rank_cd(chunks.fts, plainto_tsquery('english', query_text)) as similarity
  from chunks
  where chunks.fts @@ plainto_tsquery('english', query_text)
  order by similarity desc
  limit match_count;
$$;
