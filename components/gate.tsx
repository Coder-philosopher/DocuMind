"use client";

import { useState, type ReactNode, useEffect } from "react";
import { motion } from "framer-motion";
import { Lock, ShieldCheck, Eye, EyeOff } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Frontend-only access gate. The key ships with the client bundle, so this is
// a usage/abuse deterrent — not real security. Override via NEXT_PUBLIC_GATE_PASSWORD.
const GATE_PASSWORD = process.env.NEXT_PUBLIC_GATE_PASSWORD || "abdullah@documind@123";
const STORAGE_KEY = "documind-voice-gate";

export function Gate({ children }: { children: ReactNode }) {
  const [unlocked, setUnlocked] = useState(false);

  useEffect(() => {
    // Unlock automatically for the rest of this browser session so
    // reloads/back-navigation don't interrupt — but a fresh visit or a new
    // tab still requires the password.
    try {
      if (sessionStorage.getItem(STORAGE_KEY) === "ok") {
        setUnlocked(true);
      }
    } catch {
      /* storage unavailable — fall through to locked state */
    }
  }, []);

  if (unlocked) return <>{children}</>;

  return (
    <PasswordGate
      onUnlock={() => {
        try {
          sessionStorage.setItem(STORAGE_KEY, "ok");
        } catch {
          /* ignore */
        }
        setUnlocked(true);
      }}
    />
  );
}

function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState(false);

  const submit = () => {
    if (value === GATE_PASSWORD) {
      setError(false);
      onUnlock();
    } else {
      setError(true);
      setValue("");
    }
  };

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background p-4">
      {/* Decorative gradient background */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-primary/20 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute left-1/2 top-1/2 h-96 w-96 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="relative w-full max-w-sm"
      >
        <div className="rounded-2xl border bg-card/80 p-8 shadow-xl backdrop-blur">
          <div className="flex flex-col items-center text-center">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, type: "spring", stiffness: 260, damping: 18 }}
              className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10"
            >
              <Lock className="h-8 w-8 text-primary" />
            </motion.div>
            <h1 className="text-xl font-bold tracking-tight">DocuMind</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              This workspace is private. Enter the access key to continue.
            </p>
          </div>

          <form
            className="mt-6 space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <div className="relative">
              <Input
                autoFocus
                type={show ? "text" : "password"}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  if (error) setError(false);
                }}
                placeholder="Access key"
                aria-label="Access key"
                className={cn(
                  "h-12 pr-10 text-center",
                  error && "border-destructive focus-visible:ring-destructive"
                )}
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={show ? "Hide password" : "Show password"}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            {error && (
              <motion.p
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center text-sm font-medium text-destructive"
              >
                Incorrect access key. Please try again.
              </motion.p>
            )}

            <Button type="submit" size="lg" className="w-full">
              <ShieldCheck className="mr-2 h-4 w-4" /> Enter
            </Button>
          </form>

          <p className="mt-5 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
            <Lock className="h-3 w-3" />
            Your answers are generated from private documents only.
          </p>
        </div>
      </motion.div>
    </div>
  );
}
