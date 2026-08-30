"use client";

import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useDropzone } from "react-dropzone";
import {
  FileText,
  FileType2,
  FileCode2,
  Loader2,
  CheckCircle2,
  XCircle,
  Sparkles,
  X,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils";
import type { DocumentRecord } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DocumentSidebarProps {
  documents: DocumentRecord[];
  onDocumentsChange: (docs: DocumentRecord[]) => void;
  onOpenSources: () => void;
  open: boolean;
}

const fileIcon = (type: string) => {
  if (type === "application/pdf") return <FileText className="h-4 w-4" />;
  if (type.includes("word")) return <FileType2 className="h-4 w-4" />;
  if (type.includes("markdown")) return <FileCode2 className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
};

export function DocumentSidebar({
  documents,
  onDocumentsChange,
  onOpenSources,
  open,
}: DocumentSidebarProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  void onOpenSources;
  void open;

  const refreshDocuments = useCallback(async () => {
    try {
      const res = await fetch("/api/documents");
      if (res.ok) {
        const data = await res.json();
        onDocumentsChange(data.documents ?? []);
      }
    } catch (error) {
      console.error("Failed to refresh documents", error);
    }
  }, [onDocumentsChange]);

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      for (const file of acceptedFiles) {
        const form = new FormData();
        form.append("file", file);
        try {
          const res = await fetch("/api/upload", {
            method: "POST",
            body: form,
          });
          if (res.ok) {
            toast.success(`Uploaded ${file.name}`);
          } else {
            const data = await res.json();
            toast.error(data.error ?? `Failed to upload ${file.name}`);
          }
        } catch {
          toast.error(`Failed to upload ${file.name}`);
        }
      }
      await refreshDocuments();
    },
    [refreshDocuments]
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
      "text/plain": [".txt"],
      "text/markdown": [".md"],
    },
    maxSize: 25 * 1024 * 1024,
    multiple: true,
  });

  const deleteDocument = async (id: string) => {
    try {
      const res = await fetch(`/api/documents?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.info("Document deleted");
        await refreshDocuments();
      } else {
        toast.error("Failed to delete document");
      }
    } catch {
      toast.error("Failed to delete document");
    }
  };

  const readyCount = documents.filter((d) => d.status === "ready").length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 items-center justify-between border-b px-4">
        <div>
          <h2 className="text-sm font-semibold">Documents</h2>
          <p className="text-xs text-muted-foreground">
            {readyCount} ready · {documents.length} total
          </p>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setDialogOpen(true)} aria-label="Upload document">
          <UploadCloud className="h-4 w-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <div
          {...getRootProps()}
          className={cn(
            "mb-3 rounded-lg border-2 border-dashed transition-colors",
            isDragActive
              ? "border-primary bg-primary/10"
              : "border-border hover:border-primary/50"
          )}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
            <UploadCloud className={cn("h-8 w-8", isDragActive ? "text-primary" : "text-muted-foreground")} />
            <p className="text-sm font-medium">
              {isDragActive ? "Drop to upload" : "Drag & drop documents"}
            </p>
            <p className="text-xs text-muted-foreground">
              PDF · DOCX · TXT · MD (up to 25 MB)
            </p>
          </div>
        </div>

        {documents.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-2 rounded-lg border p-4 text-center"
          >
            <Sparkles className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm font-medium">No documents yet</p>
            <p className="text-xs text-muted-foreground">
              Upload enterprise docs to start asking grounded questions.
            </p>
            <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
              Upload your first document
            </Button>
          </motion.div>
        ) : (
          <ul className="space-y-2">
            <AnimatePresence>
              {documents.map((doc) => (
                <motion.li
                  key={doc.id}
                  layout
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  className="group"
                >
                  <Card className="p-3">
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5 text-muted-foreground">
                        {fileIcon(doc.file_type)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium" title={doc.filename}>
                          {doc.filename}
                        </p>
                        <div className="mt-1.5 flex items-center gap-2">
                          <StatusBadge status={doc.status} />
                          {doc.page_count ? (
                            <span className="text-xs text-muted-foreground">
                              {doc.page_count} pages
                            </span>
                          ) : null}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={() => deleteDocument(doc.id)}
                        aria-label={`Delete ${doc.filename}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </Card>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Upload documents</DialogTitle>
            <DialogDescription>
              Drop files here or browse your computer. Supported: PDF, DOCX, TXT, Markdown.
            </DialogDescription>
          </DialogHeader>
          <div
            {...getRootProps()}
            className={cn(
              "flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center transition-colors",
              isDragActive ? "border-primary bg-primary/10" : "border-border"
            )}
          >
            <input {...getInputProps()} />
            <UploadCloud className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm font-medium">Drag & drop or click to browse</p>
            <p className="text-xs text-muted-foreground">PDF · DOCX · TXT · MD (max 25 MB)</p>
            <Button size="sm" type="button" variant="secondary">
              Browse files
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status }: { status: DocumentRecord["status"] }) {
  if (status === "ready") {
    return (
      <Badge variant="success" className="gap-1">
        <CheckCircle2 className="h-3 w-3" /> Ready
      </Badge>
    );
  }
  if (status === "processing") {
    return (
      <Badge variant="warning" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Processing
      </Badge>
    );
  }
  return (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="h-3 w-3" /> Failed
    </Badge>
  );
}