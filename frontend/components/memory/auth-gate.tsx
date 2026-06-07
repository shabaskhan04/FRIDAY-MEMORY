"use client";

import { useState, useEffect, useCallback } from "react";
import { Eye, EyeOff, Lock, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const SESSION_KEY = "friday_auth_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

function isSessionValid(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return false;
    const { expiry } = JSON.parse(raw) as { expiry: number };
    return Date.now() < expiry;
  } catch {
    return false;
  }
}

function setSession() {
  sessionStorage.setItem(
    SESSION_KEY,
    JSON.stringify({ expiry: Date.now() + SESSION_TTL_MS })
  );
}

interface AuthGateProps {
  children: React.ReactNode;
}

export function AuthGate({ children }: AuthGateProps) {
  const [authed, setAuthed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(false);

  useEffect(() => {
    setAuthed(isSessionValid());
    setChecked(true);
  }, []);

  const handleSubmit = useCallback(async () => {
    setLoading(true);
    setError("");
    // Small artificial delay so it feels like a real check
    await new Promise((r) => setTimeout(r, 400));

    const correct = process.env.NEXT_PUBLIC_APP_PASSWORD ?? "friday";
    if (password === correct) {
      setSession();
      setAuthed(true);
    } else {
      setLoading(false);
      setError("Incorrect password. Try again.");
      setPassword("");
      setShake(true);
      setTimeout(() => setShake(false), 500);
    }
  }, [password]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") void handleSubmit();
  };

  if (!checked) return null;
  if (authed) return <>{children}</>;

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6">
      {/* Background blobs */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 left-1/2 h-[700px] w-[700px] -translate-x-1/2 rounded-full bg-primary/8 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-[350px] w-[350px] rounded-full bg-purple-600/5 blur-[100px]" />
      </div>

      <div
        className={cn(
          "w-full max-w-sm transition-transform",
          shake && "animate-shake"
        )}
      >
        {/* Logo / title */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-1 ring-primary/20">
            <Lock className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Friday
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter your password to continue
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl glass-card p-6 space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Password
            </label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                onKeyDown={handleKeyDown}
                autoFocus
                placeholder="••••••••"
                className={cn(
                  "w-full rounded-xl bg-background/40 border border-border px-4 py-3 pr-11 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-all duration-200",
                  "focus:ring-2 focus:ring-primary/40 focus:border-primary/40",
                  error && "border-destructive/50 focus:ring-destructive/30"
                )}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {error && (
              <p className="text-xs text-destructive pt-0.5">{error}</p>
            )}
          </div>

          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={loading || !password}
            className={cn(
              "w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground transition-all duration-200",
              "hover:bg-primary/90 active:scale-[0.98]",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "flex items-center justify-center gap-2"
            )}
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Checking…</>
            ) : (
              "Unlock"
            )}
          </button>
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Session lasts 24 hours
        </p>
      </div>
    </div>
  );
}
