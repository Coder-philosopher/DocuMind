"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SendHorizonal, Sparkles, Bot, User, Loader2, AlertCircle, RotateCcw, X } from "lucide-react";

import { Markdown, SourceBadges } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { groundingLevel } from "@/lib/agent/grounding";
import type { AgentStep, Citation, DocumentRecord } from "@/lib/types";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  created_at: string;
  agentSteps?: AgentStep[];
  groundingScore?: number | null;
  unsupportedSentences?: Array<{ sentence: string; reason: string }>;
  streaming?: boolean;
}

interface ChatError {
  message: string;
  code?: string;
}

const SUGGESTIONS = [
  "What is the key finding of the latest uploaded document?",
  "Summarize the main risks mentioned in the documents.",
  "Compare the recommendations across the documents.",
  "List all figures referenced in the source texts.",
];

const SSE_PREFIX = "data: ";

export function ChatPanel({
  messages,
  setMessages,
  loading,
  setLoading,
  documents,
  onCitationClick,
  onConversationChange,
  activeChatId,
  onNewChat,
}: {
  messages: ChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  documents: DocumentRecord[];
  onCitationClick: (c: Citation) => void;
  onConversationChange: (id: string) => void;
  activeChatId: string | null;
  onNewChat: () => void;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<ChatError | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const lastTextRef = useRef<string>("");
  const streamingIdRef = useRef<string | null>(null);
  const appearedRef = useRef(false);
  const hasStreamedRef = useRef(false);
  void onNewChat;
  const bottomRef = useRef<HTMLDivElement>(null);
  const documentsRef = useRef(documents);
  documentsRef.current = documents;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const patchStreamingMessage = useCallback(
    (patch: (m: ChatMessage) => ChatMessage) => {
      const id = streamingIdRef.current;
      if (!id) return;
      setMessages((prev) => prev.map((m) => (m.id === id ? patch(m) : m)));
    },
    [setMessages]
  );

  const markAppeared = () => {
    if (!appearedRef.current) {
      appearedRef.current = true;
    }
  };

  const sendMessage = useCallback(
    async (raw?: string) => {
      const text = (raw ?? input).trim();
      if (!text || loading) return;
      setInput("");
      setError(null);
      lastTextRef.current = text;
      hasStreamedRef.current = false;
      appearedRef.current = false;
      streamingIdRef.current = null;

      const userMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content: text,
        citations: [],
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);

      const placeholderId = crypto.randomUUID();
      streamingIdRef.current = placeholderId;
      const placeholder: ChatMessage = {
        id: placeholderId,
        role: "assistant",
        content: "",
        citations: [],
        created_at: new Date().toISOString(),
        streaming: true,
      };
      setMessages((prev) => [...prev, placeholder]);

      const dropPlaceholder = () => {
        const id = streamingIdRef.current;
        streamingIdRef.current = null;
        if (id) {
          setMessages((prev) => {
            const placeholder = prev.find((m) => m.id === id);
            if (placeholder && placeholder.content.trim()) {
              return prev.map((m) => (m.id === id ? { ...m, streaming: false } : m));
            }
            return prev.filter((m) => m.id !== id);
          });
        }
      };

      setLoading(true);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: text,
            conversationId: activeChatId,
            stream: true,
          }),
        });

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          dropPlaceholder();
          setError({ message: data.error ?? "Request failed. Please try again.", code: data.code });
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const handleEvent = (payload: {
          type: string;
          text?: string;
          content?: string;
          citations?: Citation[];
          groundingScore?: number;
          agentSteps?: AgentStep[];
          unsupportedSentences?: Array<{ sentence: string; reason: string }>;
          conversationId?: string;
          messageId?: string;
          error?: string;
          code?: string;
        }) => {
          if (payload.type === "reset") {
            patchStreamingMessage((m) => ({ ...m, content: "" }));
            return;
          }
          if (payload.type === "delta") {
            if (!payload.text) return;
            hasStreamedRef.current = true;
            markAppeared();
            patchStreamingMessage((m) => ({ ...m, content: m.content + payload.text }));
            return;
          }
          if (payload.type === "done") {
            streamingIdRef.current = null;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === placeholderId
                  ? {
                      id: payload.messageId ?? placeholderId,
                      role: "assistant",
                      content: payload.content || m.content,
                      citations: payload.citations ?? [],
                      created_at: new Date().toISOString(),
                      agentSteps: payload.agentSteps ?? [],
                      groundingScore: payload.groundingScore ?? null,
                      unsupportedSentences: payload.unsupportedSentences ?? [],
                    }
                  : m
              )
            );
            if (payload.conversationId) onConversationChange(payload.conversationId);
            return;
          }
          if (payload.type === "error") {
            const sid = streamingIdRef.current;
            streamingIdRef.current = null;
            setError({ message: payload.error ?? "Request failed. Please try again.", code: payload.code });
            if (sid) {
              setMessages((prev) => {
                const placeholder = prev.find((m) => m.id === sid);
                if (placeholder && placeholder.content.trim()) {
                  return prev.map((m) => (m.id === sid ? { ...m, streaming: false } : m));
                }
                return prev.filter((m) => m.id !== sid);
              });
            }
          }
        };

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith(SSE_PREFIX)) continue;
            try {
              handleEvent(JSON.parse(trimmed.slice(SSE_PREFIX.length)));
            } catch {
              /* skip malformed event line */
            }
          }
        }
      } catch {
        dropPlaceholder();
        setError({ message: "Network error. Please try again." });
      } finally {
        setLoading(false);
      }
    },
    [input, loading, setMessages, onConversationChange, setLoading, activeChatId, patchStreamingMessage]
  );

  const readyCount = documents.filter((d) => d.status === "ready").length;

  return (
    <div className="relative flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6">
          {messages.length === 0 && !loading ? (
            <EmptyState readyCount={readyCount} onPick={sendMessage} />
          ) : (
            <div className="space-y-6">
              <AnimatePresence initial={false}>
                {messages.map((message) => (
                  <MessageBubble key={message.id} message={message} onCitationClick={onCitationClick} />
                ))}
              </AnimatePresence>
              {loading && !appearedRef.current && <ThinkingIndicator />}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {error && <ErrorBanner error={error} onRetry={() => sendMessage(lastTextRef.current)} onDismiss={() => setError(null)} />}

      <div className="shrink-0 border-t bg-background/80 backdrop-blur">
        <div className="mx-auto max-w-3xl p-4">
          <div className="relative">
            <Textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="Ask a question about your documents…  (⌘/Ctrl+K)"
              className="min-h-[52px] resize-none pr-14 py-3.5"
              rows={1}
            />
            <Button
              size="icon"
              className="absolute right-2 top-1/2 -translate-y-1/2"
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              aria-label="Send message"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <SendHorizonal className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            DocuMind answers only from your uploaded documents and always cites
            its sources.
          </p>
        </div>
      </div>
    </div>
  );
}

function ErrorBanner({
  error,
  onRetry,
  onDismiss,
}: {
  error: ChatError;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-auto w-full max-w-3xl px-4"
    >
      <div className="mt-2 flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-destructive">{error.message}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Your question was saved in this conversation. You can try again or rephrase.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button variant="ghost" size="sm" onClick={onRetry} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" /> Try again
          </Button>
          <Button variant="ghost" size="icon" onClick={onDismiss} aria-label="Dismiss error">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </motion.div>
  );
}

function EmptyState({
  readyCount,
  onPick,
}: {
  readyCount: number;
  onPick: (text: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center gap-6 pt-16 text-center"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <Sparkles className="h-8 w-8 text-primary" />
      </div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {readyCount > 0 ? "Ask anything about your documents" : "Welcome to DocuMind"}
        </h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          {readyCount > 0
            ? `${readyCount} document${readyCount === 1 ? "" : "s"} ready. Start with a question or pick a suggestion below.`
            : "Upload documents from the left sidebar to begin. DocuMind uses hybrid retrieval and grounded generation to answer with citations."}
        </p>
      </div>
      {readyCount > 0 && (
        <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => onPick(s)}
              className="rounded-lg border bg-card p-3 text-left text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </motion.div>
  );
}

export function MessageBubble({
  message,
  onCitationClick,
}: {
  message: ChatMessage;
  onCitationClick: (c: Citation) => void;
}) {
  const isUser = message.role === "user";
  const level = groundingLevel(message.groundingScore);
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className={cn("flex w-full gap-3", isUser ? "justify-end" : "justify-start")}
    >
      {!isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <Bot className="h-4 w-4" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-3 sm:max-w-[75%]",
          isUser ? "bg-primary text-primary-foreground" : "border bg-card text-card-foreground"
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
        ) : (
          <>
            {message.streaming ? (
              <>
                {message.content ? (
                  <Markdown content={message.content} citations={[]} onCitationClick={onCitationClick} className="text-sm" />
                ) : (
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Searching documents…</span>
                  </div>
                )}
                <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> generating
                </span>
              </>
            ) : (
              <>
                {message.groundingScore != null && (
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <GroundingBadge level={level} score={message.groundingScore} />
                    {message.unsupportedSentences && message.unsupportedSentences.length > 0 && (
                      <span className="text-xs text-destructive">
                        {message.unsupportedSentences.length} flagged sentence
                        {message.unsupportedSentences.length === 1 ? "" : "s"}
                      </span>
                    )}
                  </div>
                )}
                <Markdown
                  content={message.content}
                  citations={message.citations}
                  onCitationClick={onCitationClick}
                  unsupportedSentences={message.unsupportedSentences ?? []}
                  className="text-sm"
                />
                {message.citations.length > 0 && (
                  <>
                    <Separator className="my-3" />
                    <SourceBadges citations={message.citations} onCitationClick={onCitationClick} />
                  </>
                )}
                {message.agentSteps && message.agentSteps.length > 0 && (
                  <AgentStepsAccordion steps={message.agentSteps} />
                )}
              </>
            )}
          </>
        )}
      </div>
      {isUser && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary">
          <User className="h-4 w-4" />
        </div>
      )}
    </motion.div>
  );
}

function GroundingBadge({
  level,
  score,
}: {
  level: "high" | "medium" | "low";
  score: number;
}) {
  const config = {
    high: { label: "High confidence", variant: "success" as const, dot: "bg-emerald-500" },
    medium: { label: "Medium confidence", variant: "warning" as const, dot: "bg-amber-500" },
    low: { label: "Low confidence", variant: "destructive" as const, dot: "bg-red-500" },
  }[level];

  return (
    <div className="flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-full", config.dot)} />
      <Badge variant={config.variant} className="gap-1">
        {Math.round(score * 100)}% · {config.label}
      </Badge>
    </div>
  );
}

function AgentStepsAccordion({ steps }: { steps: AgentStep[] }) {
  if (steps.length === 0) return null;
  const summary = steps.map((s) => s.label.split(" (")[0]).join(" → ");
  return (
    <Accordion type="single" collapsible className="mt-3 rounded-lg border bg-muted/40 px-3">
      <AccordionItem value="steps" className="border-b-0">
        <AccordionTrigger className="py-2.5 text-xs font-medium">
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Agent steps
          </span>
          <span className="ml-2 truncate text-[11px] font-normal text-muted-foreground">
            {summary}
          </span>
        </AccordionTrigger>
        <AccordionContent>
          <ol className="space-y-2">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-medium">{step.label}</p>
                  {step.detail && <p className="text-muted-foreground">{step.detail}</p>}
                  {step.durationMs != null && (
                    <p className="text-[10px] text-muted-foreground">~{step.durationMs}ms</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}

function ThinkingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex w-full gap-3"
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <Bot className="h-4 w-4" />
      </div>
      <div className="flex-1 rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Searching documents…
        </div>
        <div className="mt-3 flex items-center gap-2">
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              animate={{ y: [0, -4, 0] }}
              transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.15 }}
              className="h-2 w-2 rounded-full bg-primary/40"
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}