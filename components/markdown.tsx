"use client";

import ReactMarkdown, { Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Citation } from "@/lib/types";

interface UnsupportedSentence {
  sentence: string;
  reason: string;
}

/**
 * Renders a text string, converting inline [n] citation markers into clickable
 * badges and underlining sentences flagged by the hallucination check.
 */
function renderTextSegments(
  text: string,
  onCitationClick: (c: Citation) => void,
  citations: Citation[],
  unsupported: UnsupportedSentence[]
) {
  // Split by flagged unsupported sentences first.
  const flagged = unsupported.find((u) => text.includes(u.sentence));
  if (flagged) {
    const idx = text.indexOf(flagged.sentence);
    const before = text.slice(0, idx);
    const after = text.slice(idx + flagged.sentence.length);
    return (
      <>
        {before && (
          <span>{renderInline(before, onCitationClick, citations)}</span>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="cursor-help rounded-sm bg-red-100/70 px-0.5 underline decoration-wavy decoration-red-400 decoration-1 underline-offset-4 dark:bg-red-950/40">
              {renderInline(flagged.sentence, onCitationClick, citations)}
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs font-normal">
            <span className="font-semibold">Possible unsupported claim</span>
            <br />
            {flagged.reason}
          </TooltipContent>
        </Tooltip>
        {after && (
          <span>
            {renderTextSegments(after, onCitationClick, citations, unsupported.filter((u) => u.sentence !== flagged.sentence))}
          </span>
        )}
      </>
    );
  }
  return renderInline(text, onCitationClick, citations);
}

function renderInline(
  text: string,
  onCitationClick: (c: Citation) => void,
  citations: Citation[]
) {
  const parts = text.split(/(\[(?:\d+)\])/g);
  return parts.map((part, i) => {
    const match = /^\[(\d+)\]$/.exec(part.trim());
    if (match) {
      const n = parseInt(match[1], 10);
      const citation = citations[n - 1];
      if (citation) {
        return (
          <button
            key={i}
            type="button"
            onClick={() => onCitationClick(citation)}
            className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-primary/10 px-1 align-middle text-[10px] font-bold text-primary underline-offset-4 transition-colors hover:bg-primary hover:text-primary-foreground"
            title={`Source ${n}: ${citation.document_name ?? "document"} · page ${citation.page ?? "?"}`}
          >
            {n}
          </button>
        );
      }
    }
    return <span key={i}>{part}</span>;
  });
}

export function UnsupportedSentenceWrap({
  unsupportedSentences,
  onCitationClick,
  citations,
  children,
}: {
  unsupportedSentences: UnsupportedSentence[];
  onCitationClick: (c: Citation) => void;
  citations: Citation[];
  children: React.ReactNode;
}) {
  if (typeof children !== "string") return <>{children}</>;
  return (
    <>{renderTextSegments(children, onCitationClick, citations, unsupportedSentences)}</>
  );
}

export function Markdown({
  content,
  citations,
  onCitationClick,
  unsupportedSentences = [],
  className,
}: {
  content: string;
  citations: Citation[];
  onCitationClick: (c: Citation) => void;
  unsupportedSentences?: UnsupportedSentence[];
  className?: string;
}) {
  const components: Components = {
    p: ({ children }) => (
      <p className="leading-relaxed [&:not(:first-child)]:mt-3">
        <UnsupportedSentenceWrap
          unsupportedSentences={unsupportedSentences}
          onCitationClick={onCitationClick}
          citations={citations}
        >
          {children}
        </UnsupportedSentenceWrap>
      </p>
    ),
    h1: ({ children }) => (
      <h1 className="mt-4 text-xl font-bold [&:first-child]:mt-0">
        <UnsupportedSentenceWrap unsupportedSentences={unsupportedSentences} onCitationClick={onCitationClick} citations={citations}>
          {children}
        </UnsupportedSentenceWrap>
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mt-4 text-lg font-bold [&:first-child]:mt-0">
        <UnsupportedSentenceWrap unsupportedSentences={unsupportedSentences} onCitationClick={onCitationClick} citations={citations}>
          {children}
        </UnsupportedSentenceWrap>
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mt-3 text-base font-semibold [&:first-child]:mt-0">
        <UnsupportedSentenceWrap unsupportedSentences={unsupportedSentences} onCitationClick={onCitationClick} citations={citations}>
          {children}
        </UnsupportedSentenceWrap>
      </h3>
    ),
    ul: ({ children }) => (
      <ul className="mt-2 list-disc space-y-1 pl-5">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="mt-2 list-decimal space-y-1 pl-5">{children}</ol>
    ),
    li: ({ children }) => (
      <li className="leading-relaxed">
        <UnsupportedSentenceWrap unsupportedSentences={unsupportedSentences} onCitationClick={onCitationClick} citations={citations}>
          {children}
        </UnsupportedSentenceWrap>
      </li>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold">
        <UnsupportedSentenceWrap unsupportedSentences={unsupportedSentences} onCitationClick={onCitationClick} citations={citations}>
          {children}
        </UnsupportedSentenceWrap>
      </strong>
    ),
    em: ({ children }) => (
      <em>
        <UnsupportedSentenceWrap unsupportedSentences={unsupportedSentences} onCitationClick={onCitationClick} citations={citations}>
          {children}
        </UnsupportedSentenceWrap>
      </em>
    ),
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noreferrer" className="text-primary underline underline-offset-4">
        {children}
      </a>
    ),
    code: ({ children }) => (
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-sm">
        {children}
      </pre>
    ),
    blockquote: ({ children }) => (
      <blockquote className="mt-2 border-l-2 border-primary pl-3 text-muted-foreground">
        {children}
      </blockquote>
    ),
    table: ({ children }) => (
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-sm">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border px-2 py-1 text-left font-semibold">{children}</th>
    ),
    td: ({ children }) => (
      <td className="border px-2 py-1">
        <UnsupportedSentenceWrap unsupportedSentences={unsupportedSentences} onCitationClick={onCitationClick} citations={citations}>
          {children}
        </UnsupportedSentenceWrap>
      </td>
    ),
    hr: () => <hr className="my-3 border-border" />,
  };

  return (
    <TooltipProvider delayDuration={200}>
      <div className={className}>
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
          {content}
        </ReactMarkdown>
      </div>
    </TooltipProvider>
  );
}

export function SourceBadges({
  citations,
  onCitationClick,
}: {
  citations: Citation[];
  onCitationClick: (c: Citation) => void;
}) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Sources:</span>
      {citations.map((c, i) => (
        <button key={c.chunk_id + i} type="button" onClick={() => onCitationClick(c)}>
          <Badge variant="secondary" className="cursor-pointer transition-colors hover:border-primary hover:text-primary">
            {i + 1} · {c.document_name ?? "doc"} {c.page ? `· p${c.page}` : ""}
          </Badge>
        </button>
      ))}
    </div>
  );
}