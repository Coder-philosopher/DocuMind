"use client";

import { BookOpen, FileText, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { Citation, DocumentRecord } from "@/lib/types";

interface SourcesPanelProps {
  citation: Citation | null;
  documents: DocumentRecord[];
  onClose: () => void;
}

export function SourcesPanel({ citation, documents, onClose }: SourcesPanelProps) {
  const doc = citation
    ? documents.find((d) => d.id === citation.document_id)
    : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2">
          <BookOpen className="h-4 w-4" />
          <h2 className="text-sm font-semibold">Sources</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close sources">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="p-4">
          {!citation ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <BookOpen className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">No source selected</p>
              <p className="text-xs text-muted-foreground">
                Click a citation badge on any answer to inspect the exact source
                chunk here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <FileText className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <div>
                    <p className="text-sm font-medium leading-tight">
                      {doc?.filename ?? citation.document_name ?? "Unknown document"}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {doc?.file_type ?? "document"}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {citation.page ? (
                    <Badge variant="secondary">{citation.page} pages</Badge>
                  ) : null}
                  <Badge variant="outline">chunk</Badge>
                </div>
              </div>

              <div className="rounded-lg border bg-card p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {citation.page ? `Excerpt · Page ${citation.page}` : "Excerpt"}
                </p>
                <blockquote className="mt-2 border-l-2 border-primary/50 pl-3 text-sm leading-relaxed text-muted-foreground">
                  “{citation.snippet}”
                </blockquote>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}