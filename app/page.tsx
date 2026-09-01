"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { PanelLeft, PanelRight, BarChart3 } from "lucide-react";

import { DocumentSidebar } from "@/components/document-sidebar";
import { ChatPanel } from "@/components/chat-panel";
import { SourcesPanel } from "@/components/sources-panel";
import { AboutModal } from "@/components/about-modal";
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

/** Breakpoint (Tailwind `md`) at which side panels become permanently visible. */
const DESKTOP_BREAKPOINT = 768;

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return isDesktop;
}

export default function Home() {
  const isDesktop = useIsDesktop();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedCitation, setSelectedCitation] = useState<Citation | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
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

  // On mobile, panels are closed by default; on desktop they stay open so the
  // toggle buttons in the header don't get shadowed by a covering overlay.
  useEffect(() => {
    if (isDesktop === null) return;
    setSidebarOpen(isDesktop);
  }, [isDesktop]);

  const handleCitationClick = useCallback((citation: Citation) => {
    setSelectedCitation(citation);
    setSourcesOpen(true);
  }, []);

  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  const closeSources = useCallback(() => setSourcesOpen(false), []);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background">
      {/* Left: document sidebar (mobile = full-screen drawer, desktop = fixed) */}
      <AnimatePresence initial={false}>
        {sidebarOpen && (
          <>
            {/* Mobile backdrop */}
            {!isDesktop && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={closeSidebar}
                className="fixed inset-0 z-40 bg-black/50 md:hidden"
              />
            )}
            <motion.aside
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              exit={{ x: -300 }}
              transition={{ type: "spring", stiffness: 300, damping: 32 }}
              className={cn(
                "fixed inset-y-0 left-0 z-50 w-[85vw] max-w-[320px] border-r bg-card/95 shadow-xl backdrop-blur",
                "md:relative md:z-auto md:w-[280px] md:bg-card/60 md:shadow-none"
              )}
            >
              <DocumentSidebar
                documents={documents}
                onDocumentsChange={setDocuments}
                onOpenSources={() => setSourcesOpen(true)}
                open
                onClose={closeSidebar}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Center: header + chat */}
      <div className="relative flex h-dvh flex-1 flex-col overflow-hidden">
        <header className="z-30 flex h-14 shrink-0 items-center gap-1 border-b px-2 sm:px-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen((v) => !v)}
            aria-label="Toggle document sidebar"
            className="shrink-0"
          >
            <PanelLeft className="h-4 w-4" />
          </Button>
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
              D
            </span>
            <span className="truncate font-semibold tracking-tight">DocuMind</span>
          </div>
          <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
            <Link href="/dashboard">
              <Button variant="ghost" size="icon" aria-label="Open observability dashboard">
                <BarChart3 className="h-4 w-4" />
              </Button>
            </Link>
            <AboutModal />
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setSourcesOpen((v) => !v)}
              aria-label="Toggle sources panel"
              className="shrink-0"
            >
              <PanelRight className="h-4 w-4" />
            </Button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden">
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

      {/* Right: sources panel (mobile = full-screen drawer, desktop = fixed) */}
      <AnimatePresence initial={false}>
        {sourcesOpen && (
          <>
            {!isDesktop && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={closeSources}
                className="fixed inset-0 z-40 bg-black/50 md:hidden"
              />
            )}
            <motion.aside
              initial={{ x: 380 }}
              animate={{ x: 0 }}
              exit={{ x: 380 }}
              transition={{ type: "spring", stiffness: 300, damping: 32 }}
              className={cn(
                "fixed inset-y-0 right-0 z-50 w-[85vw] max-w-[340px] border-l bg-card/95 shadow-xl backdrop-blur",
                "md:relative md:z-auto md:bg-card/60 md:shadow-none"
              )}
            >
              <SourcesPanel
                citation={selectedCitation}
                documents={documents}
                onClose={closeSources}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
