"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { PanelLeft, PanelRight } from "lucide-react";

import { DocumentSidebar } from "@/components/document-sidebar";
import { ChatPanel } from "@/components/chat-panel";
import { SourcesPanel } from "@/components/sources-panel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Citation, DocumentRecord } from "@/lib/types";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  created_at: string;
}

export default function Home() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const initialized = useRef(false);

  const loadDocuments = useCallback(async () => {
    try {
      const res = await fetch("/api/documents");
      if (res.ok) {
        const data = await res.json();
        setDocuments(data.documents ?? []);
      }
    } catch (error) {
      console.error("Failed to load documents", error);
    }
  }, []);

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      loadDocuments();
    }
  }, [loadDocuments]);

  const handleCitationClick = useCallback((citation: Citation) => {
    setSelectedCitation(citation);
    setSourcesOpen(true);
  }, []);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
            className="fixed inset-y-0 left-0 z-30 w-[280px] border-r bg-card/60 backdrop-blur md:relative md:z-auto"
          >
            <DocumentSidebar
              documents={documents}
              onDocumentsChange={setDocuments}
              onOpenSources={() => setSourcesOpen(true)}
              open
            />
          </motion.aside>
        )}
      </AnimatePresence>

      <div className="relative flex h-full flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle document sidebar"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
              D
            </span>
            <span className="font-semibold tracking-tight">DocuMind</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto"
            onClick={() => setSourcesOpen((v) => !v)}
            aria-label="Toggle sources panel"
          >
            <PanelRight className="h-4 w-4" />
          </Button>
        </header>

        <main className="min-h-0 flex-1">
          <ChatPanel
            messages={messages}
            setMessages={setMessages}
            loading={loading}
            setLoading={setLoading}
            documents={documents}
            onCitationClick={handleCitationClick}
            onConversationChange={(id) => setActiveChatId(id)}
            activeChatId={activeChatId}
            onNewChat={() => {
              setMessages([]);
              setActiveChatId(null);
            }}
          />
        </main>
      </div>

      <AnimatePresence initial={false}>
        {sourcesOpen && (
          <motion.aside
            initial={{ x: 360 }}
            animate={{ x: 0 }}
            exit={{ x: 360 }}
            transition={{ type: "spring", stiffness: 300, damping: 32 }}
            className={cn(
              "fixed inset-y-0 right-0 z-30 w-[340px] border-l bg-card/60 backdrop-blur"
            )}
          >
            <SourcesPanel
              citation={selectedCitation}
              documents={documents}
              onClose={() => setSourcesOpen(false)}
            />
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}