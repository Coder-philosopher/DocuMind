"""
Offline Ragas evaluation for DocuMind.

This script is NOT part of the live request path. It:
  1. Loads GEMINI_API_KEY (from env or .env.local).
  2. Uploads the sample documents into the running DocuMind instance
     (skips files that already exist and are ready).
  3. Asks every question in eval/test_set.json through the /api/chat endpoint.
  4. Scores the collected {question, answer, contexts, reference} rows with
     Ragas: faithfulness, context_precision, answer_relevancy.
  5. Stores the run in the `eval_runs` table via /api/eval-runs.

Usage:
    pip install -r eval/requirements.txt
    set GEMINI_API_KEY=...   (or fill .env.local)
    python eval/run_eval.py            # defaults to http://localhost:3000
    python eval/run_eval.py --url https://your-app.vercel.app
    python eval/run_eval.py --no-upload   # assume docs are already ingested
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv

# Compatibility shim: recent langchain-community builds no longer ship the
# VertexAI backends that ragas imports at module load. This eval uses Gemini as
# the judge (never Vertex AI), so provide inert stand-ins ahead of the ragas import.
import types


def _install_vertexai_shim() -> None:
    try:
        import langchain_community.llms as _llms  # noqa: F401
    except Exception:
        return
    if not hasattr(_llms, "VertexAI"):
        _llms.VertexAI = type("VertexAI", (), {})
    _mod = types.ModuleType("langchain_community.chat_models.vertexai")
    _mod.ChatVertexAI = type("ChatVertexAI", (), {})
    sys.modules["langchain_community.chat_models.vertexai"] = _mod


_install_vertexai_shim()

BASE_DIR = Path(__file__).resolve().parent.parent
TEST_SET = BASE_DIR / "eval" / "test_set.json"
SAMPLE_DOCS_DIR = BASE_DIR / "eval" / "sample_docs"

load_dotenv(BASE_DIR / ".env.local")
load_dotenv()  # fall back to process environment

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") or ""


def get_api_key() -> str:
    if GEMINI_API_KEY:
        return GEMINI_API_KEY
    sys.exit(
        "GEMINI_API_KEY is not set. Add it to .env.local or export it before running."
    )


def upload_sample_docs(base_url: str) -> None:
    """Upload any sample doc that is missing / not ready. Returns once ready."""
    res = requests.get(f"{base_url}/api/documents", timeout=30)
    res.raise_for_status()
    existing = {
        d["filename"]: d["status"]
        for d in res.json().get("documents") or []
    }

    files = sorted(SAMPLE_DOCS_DIR.glob("*"))
    for file in files:
        if file.name in existing:
            continue
        print(f"  uploading {file.name} ...")
        with open(file, "rb") as fh:
            resp = requests.post(
                f"{base_url}/api/upload",
                files={"file": (file.name, fh, guess_mime(file.name))},
                timeout=300,
            )
        if resp.status_code != 201:
            print(f"  upload failed for {file.name}: {resp.text}")
            sys.exit(1)

    print("  waiting for ingestion to finish ...")
    for _ in range(60):
        res = requests.get(f"{base_url}/api/documents", timeout=30)
        docs = res.json().get("documents") or []
        ready = all(d["filename"] in existing or d["status"] == "ready" for d in docs if d["filename"] in {f.name for f in files} | set(existing))
        ready = ready and any(d["filename"] in {f.name for f in files} for d in docs)
        failed = any(d["status"] == "failed" for d in docs)
        if ready:
            print("  all sample documents ready.")
            return
        if failed:
            print("  a document failed to process; continuing anyway.", file=sys.stderr)
            return
        time.sleep(5)
    print("  timed out waiting for ingestion.", file=sys.stderr)


def guess_mime(filename: str) -> str:
    if filename.endswith(".pdf"):
        return "application/pdf"
    if filename.endswith(".docx"):
        return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    if filename.endswith(".md"):
        return "text/markdown"
    return "text/plain"


def ask_question(base_url: str, question: str) -> tuple[str, list[str]]:
    resp = requests.post(
        f"{base_url}/api/chat",
        json={"message": question},
        timeout=180,
    )
    if resp.status_code != 200:
        return f"[eval error {resp.status_code}]", []
    data = resp.json()
    answer = (data.get("message") or {}).get("content") or ""
    citations = (data.get("message") or {}).get("citations") or []
    contexts = [c.get("snippet") for c in citations if c.get("snippet")]
    return answer, contexts


def collect_dataset(base_url: str, test_set: dict) -> dict:
    questions, answers, contexts, references = [], [], [], []
    for item in test_set["dataset"]:
        q = item["question"]
        print(f"  Q: {q}")
        answer, ctx = ask_question(base_url, q)
        print(f"    contexts: {len(ctx)} chunks")
        questions.append(q)
        answers.append(answer)
        contexts.append(ctx)
        references.append(item["reference_answer"])
        time.sleep(0.5)  # be gentle to free-tier rate limits
    return {
        "question": questions,
        "answer": answers,
        "contexts": contexts,
        "reference": references,
    }


def run_ragas(dataset: dict) -> dict:
    from datasets import Dataset
    from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
    from ragas import evaluate
    from ragas.embeddings import LangchainEmbeddingsWrapper
    from ragas.llms import LangchainLLMWrapper
    from ragas.metrics import answer_relevancy, context_precision, faithfulness

    llm = ChatGoogleGenerativeAI(model="gemini-3.5-flash-lite", api_key=GEMINI_API_KEY)
    embeddings = GoogleGenerativeAIEmbeddings(
        model="models/gemini-embedding-001", google_api_key=GEMINI_API_KEY
    )
    llm = LangchainLLMWrapper(llm)
    embeddings = LangchainEmbeddingsWrapper(embeddings)

    faithfulness.llm = llm
    context_precision.llm = llm
    answer_relevancy.llm = llm
    answer_relevancy.embeddings = embeddings

    ds = Dataset.from_dict(dataset)
    result = evaluate(
        ds,
        metrics=[faithfulness, context_precision, answer_relevancy],
    )

    def avg(key: str):
        vals = []
        for r in result.scores:
            v = r.get(key)
            if isinstance(v, (int, float)) and not math.isnan(v):
                vals.append(v)
        if not vals:
            return None
        return round(sum(vals) / len(vals), 4)

    return {
        "faithfulness": avg("faithfulness"),
        "context_precision": avg("context_precision"),
        "answer_relevancy": avg("answer_relevancy"),
    }


def store_run(base_url: str, scores: dict) -> None:
    payload = {
        "faithfulness": scores.get("faithfulness"),
        "context_precision": scores.get("context_precision"),
        "answer_relevancy": scores.get("answer_relevancy"),
        "notes": "Ragas offline eval against eval/test_set.json (18 Q&A pairs, sample docs)",
    }
    resp = requests.post(f"{base_url}/api/eval-runs", json=payload, timeout=30)
    if resp.status_code == 201:
        print("\nEval run stored in eval_runs table: ", resp.json().get("id"))
    else:
        print(f"\nFailed to store eval run: {resp.status_code} {resp.text}", file=sys.stderr)


def main() -> None:
    parser = argparse.ArgumentParser(description="DocuMind offline Ragas evaluation")
    parser.add_argument("--url", default="http://localhost:3000", help="DocuMind base URL")
    parser.add_argument(
        "--limit",
        type=int,
        default=0,
        help="Only evaluate the first N questions (0 = all) for a quicker pass",
    )
    parser.add_argument(
        "--no-upload",
        action="store_true",
        help="Skip uploading sample docs (assume already ingested)",
    )
    args = parser.parse_args()

    get_api_key()

    if not TEST_SET.exists():
        sys.exit(f"test set not found: {TEST_SET}")
    with open(TEST_SET, "r", encoding="utf-8") as fh:
        test_set = json.load(fh)
    if args.limit:
        test_set["dataset"] = test_set["dataset"][: args.limit]
    print(f"Loaded test set: {len(test_set['dataset'])} Q&A pairs")

    if not args.no_upload:
        upload_sample_docs(args.url)

    print("Collecting answers from DocuMind ...")
    dataset = collect_dataset(args.url, test_set)

    print("Running Ragas metrics ...")
    scores = run_ragas(dataset)
    print("\n===== EVAL RESULTS =====")
    for k, v in scores.items():
        print(f"  {k}: {v if v is not None else 'N/A'}")
    store_run(args.url, scores)


if __name__ == "__main__":
    main()