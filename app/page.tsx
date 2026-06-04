"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import {
  Mic,
  MicOff,
  Loader2,
  ArrowRight,
  Activity,
  Circle,
} from "lucide-react";

// ============================================================
// Types
// ============================================================

interface RawLedger {
  id: string;
  created_at: string;
  content: string;
}

interface StatusMessage {
  type: "success" | "error";
  text: string;
}

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: { length: number; isFinal: boolean; [index: number]: { transcript: string }[] & { isFinal: boolean } };
}

interface SpeechRecognitionInstance extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onend: (() => void) | null;
}

declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

// ============================================================
// Scoped styles — injected once at runtime
// ============================================================

const GLOBAL_STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=JetBrains+Mono:ital,wght@0,300;0,400;0,500;1,300&display=swap');

  :root {
    --bg:              #0A0F1C;
    --bg-surface:      #0D1324;
    --bg-card:         rgba(13, 19, 36, 0.7);
    --border:          rgba(255, 255, 255, 0.055);
    --border-hover:    rgba(255, 255, 255, 0.11);
    --border-focus:    rgba(74, 124, 255, 0.35);
    --text-primary:    #EEF2FF;
    --text-secondary:  rgba(238, 242, 255, 0.5);
    --text-muted:      rgba(238, 242, 255, 0.22);
    --accent:          #4A7CFF;
    --accent-dim:      rgba(74, 124, 255, 0.1);
    --accent-glow:     rgba(74, 124, 255, 0.25);
    --accent-strong:   rgba(74, 124, 255, 0.5);
    --success:         #34D399;
    --success-dim:     rgba(52, 211, 153, 0.1);
    --success-border:  rgba(52, 211, 153, 0.2);
    --error:           #F87171;
    --error-dim:       rgba(248, 113, 113, 0.1);
    --error-border:    rgba(248, 113, 113, 0.2);
    --recording:       #FF5A5A;
    --recording-dim:   rgba(255, 90, 90, 0.12);
    --font-display:    'Syne', sans-serif;
    --font-mono:       'JetBrains Mono', monospace;
    --radius:          10px;
    --radius-sm:       6px;
  }

  html, body {
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-display);
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    scrollbar-width: thin;
    scrollbar-color: var(--border) transparent;
  }

  ::-webkit-scrollbar        { width: 4px; height: 4px; }
  ::-webkit-scrollbar-track  { background: transparent; }
  ::-webkit-scrollbar-thumb  { background: var(--border); border-radius: 2px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--border-hover); }

  /* ---- Page shell ---- */
  .cr-shell {
    min-height: 100vh;
    background:
      radial-gradient(ellipse 90% 55% at 50% -10%, rgba(74,124,255,0.07) 0%, transparent 65%),
      #0A0F1C;
    display: flex;
    flex-direction: column;
  }

  /* ---- Header ---- */
  .cr-header {
    position: sticky;
    top: 0;
    z-index: 200;
    background: rgba(10, 15, 28, 0.82);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    border-bottom: 1px solid var(--border);
    padding: 1.1rem 3rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }

  .cr-header-left  { display: flex; flex-direction: column; gap: 0.2rem; }

  .cr-brand {
    font-family: var(--font-display);
    font-size: 0.58rem;
    font-weight: 800;
    letter-spacing: 0.42em;
    text-transform: uppercase;
    color: var(--accent);
  }

  .cr-title {
    font-family: var(--font-display);
    font-size: 0.95rem;
    font-weight: 600;
    letter-spacing: 0.025em;
    color: var(--text-primary);
    line-height: 1;
  }

  .cr-header-right {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }

  .cr-pulse-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--success);
    box-shadow: 0 0 7px var(--success);
    animation: pulseDot 2.4s ease-in-out infinite;
  }

  .cr-header-meta {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    font-weight: 400;
    color: var(--text-muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  @keyframes pulseDot {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.35; }
  }

  /* ---- Input zone ---- */
  .cr-input-zone {
    flex: 1;
    width: 100%;
    max-width: 900px;
    margin: 0 auto;
    padding: 3.5rem 3rem 2rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }

  .cr-textarea {
    width: 100%;
    min-height: 220px;
    background: transparent;
    border: none;
    outline: none;
    resize: none;
    font-family: var(--font-display);
    font-size: 1.3rem;
    font-weight: 400;
    line-height: 1.72;
    letter-spacing: 0.008em;
    color: var(--text-primary);
    caret-color: var(--accent);
    transition: color 0.2s ease;
  }

  .cr-textarea::placeholder { color: var(--text-muted); }
  .cr-textarea:disabled     { color: var(--text-secondary); cursor: not-allowed; }

  .cr-char-count {
    margin-top: 0.5rem;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 300;
    color: var(--text-muted);
    letter-spacing: 0.06em;
    text-align: right;
  }

  /* ---- Controls bar ---- */
  .cr-controls {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border);
  }

  .cr-record-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--text-secondary);
    cursor: pointer;
    transition: border-color 0.2s ease, color 0.2s ease, background 0.2s ease;
  }

  .cr-record-btn:hover { border-color: var(--border-hover); color: var(--text-primary); }

  .cr-record-btn.recording {
    border-color: var(--recording);
    background: var(--recording-dim);
    color: var(--recording);
  }

  .cr-record-btn.recording::after {
    content: '';
    position: absolute;
    inset: -5px;
    border-radius: 50%;
    border: 1px solid var(--recording);
    opacity: 0;
    animation: ringPulse 1.6s ease-out infinite;
  }

  @keyframes ringPulse {
    0%   { transform: scale(1);    opacity: 0.5; }
    100% { transform: scale(1.35); opacity: 0;   }
  }

  .cr-submit-btn {
    flex: 1;
    height: 44px;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    background: var(--bg-surface);
    color: var(--text-primary);
    font-family: var(--font-display);
    font-size: 0.74rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    position: relative;
    overflow: hidden;
    transition: border-color 0.25s ease, box-shadow 0.25s ease, color 0.2s ease;
  }

  .cr-submit-btn::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(120deg, var(--accent-dim) 0%, transparent 60%);
    opacity: 0;
    transition: opacity 0.25s ease;
  }

  .cr-submit-btn:hover:not(:disabled)::before { opacity: 1; }

  .cr-submit-btn:hover:not(:disabled) {
    border-color: var(--accent-strong);
    box-shadow: 0 0 24px var(--accent-glow), inset 0 0 16px var(--accent-dim);
    color: #fff;
  }

  .cr-submit-btn:disabled  { opacity: 0.35; cursor: not-allowed; }
  .cr-submit-btn.committing { border-color: var(--accent-strong); box-shadow: 0 0 16px var(--accent-glow); }

  .cr-hint {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 300;
    color: var(--text-muted);
    letter-spacing: 0.04em;
    white-space: nowrap;
  }

  /* ---- Status ---- */
  .cr-status {
    display: flex;
    align-items: flex-start;
    gap: 0.6rem;
    padding: 0.8rem 1rem;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 0.68rem;
    line-height: 1.55;
    letter-spacing: 0.01em;
    animation: statusFadeUp 0.3s ease;
  }

  .cr-status.success { background: var(--success-dim); border: 1px solid var(--success-border); color: var(--success); }
  .cr-status.error   { background: var(--error-dim);   border: 1px solid var(--error-border);   color: var(--error); }
  .cr-status-icon    { margin-top: 0.05rem; flex-shrink: 0; opacity: 0.75; }

  @keyframes statusFadeUp {
    from { opacity: 0; transform: translateY(5px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  /* ---- Section divider ---- */
  .cr-divider {
    width: 100%;
    max-width: 900px;
    margin: 0 auto;
    padding: 0 3rem;
    display: flex;
    align-items: center;
    gap: 1.25rem;
  }

  .cr-divider::before,
  .cr-divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }

  .cr-divider-label {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-family: var(--font-mono);
    font-size: 0.58rem;
    font-weight: 500;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--text-muted);
    white-space: nowrap;
  }

  /* ---- Ledger ---- */
  .cr-ledger {
    width: 100%;
    max-width: 900px;
    margin: 0 auto;
    padding: 1.75rem 3rem 5rem;
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  .cr-ledger-empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 2.5rem;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    gap: 0.4rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.65rem;
    letter-spacing: 0.1em;
    text-align: center;
    line-height: 1.6;
  }

  .cr-ledger-card {
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.1rem 1.4rem;
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
    animation: cardReveal 0.35s ease both;
  }

  .cr-ledger-card:hover {
    border-color: var(--border-hover);
    box-shadow: 0 0 20px rgba(74,124,255,0.04);
  }

  @keyframes cardReveal {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .cr-ledger-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 0.65rem;
  }

  .cr-ledger-ts {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 300;
    color: var(--text-muted);
    letter-spacing: 0.05em;
  }

  .cr-ledger-id {
    font-family: var(--font-mono);
    font-size: 0.58rem;
    color: var(--accent);
    opacity: 0.5;
    letter-spacing: 0.02em;
  }

  .cr-ledger-text {
    font-family: var(--font-display);
    font-size: 0.86rem;
    color: var(--text-secondary);
    line-height: 1.65;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
  }

  /* ---- Spinner ---- */
  @keyframes spinLoader { to { transform: rotate(360deg); } }
  .cr-spin { animation: spinLoader 0.7s linear infinite; }

  /* ---- Mobile ---- */
  @media (max-width: 640px) {
    .cr-header       { padding: 1rem 1.25rem; }
    .cr-input-zone   { padding: 2rem 1.25rem 1.5rem; }
    .cr-divider      { padding: 0 1.25rem; }
    .cr-ledger       { padding: 1.5rem 1.25rem 4rem; }
    .cr-textarea     { font-size: 1.05rem; }
    .cr-hint         { display: none; }
  }
`;

// ============================================================
// Component
// ============================================================

export default function CognitiveRouter() {
  const [content, setContent] = useState<string>("");
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [ledgers, setLedgers] = useState<RawLedger[]>([]);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  const supabase = createClient();

  // ── Fetch latest 5 raw ledger entries ─────────────────────────
  const fetchLedgers = useCallback(async (): Promise<void> => {
    const { data, error } = await supabase
      .from("raw_ledgers")
      .select("id, created_at, content")
      .order("created_at", { ascending: false })
      .limit(5);
    if (!error && data) setLedgers(data as RawLedger[]);
  }, [supabase]);

  useEffect(() => {
    void fetchLedgers();
    const t = setTimeout(() => textareaRef.current?.focus(), 120);
    return () => clearTimeout(t);
  }, [fetchLedgers]);

  // ── Speech Recognition ───────────────────────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return;
    const SpeechAPI = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SpeechAPI) return;

    const recognition = new SpeechAPI();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    recognition.onresult = (event: SpeechRecognitionEvent): void => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) transcript += event.results[i][0].transcript;
      }
      if (transcript.trim()) {
        setContent((prev) => (prev ? `${prev} ${transcript.trim()}` : transcript.trim()));
      }
    };

    recognition.onend = (): void => setIsRecording(false);
    recognition.onerror = (e: Event): void => {
      console.warn("[SpeechRecognition]", (e as Event & { error?: string }).error);
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
  }, []);

  const toggleRecording = (): void => {
    if (!recognitionRef.current) {
      setStatus({ type: "error", text: "Speech recognition is not supported in this browser." });
      return;
    }
    if (isRecording) {
      recognitionRef.current.stop();
      setIsRecording(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsRecording(true);
        setStatus(null);
      } catch (e) {
        console.error("[SpeechRecognition] start failed:", e);
        setIsRecording(false);
      }
    }
  };

  // ── Submit ───────────────────────────────────────────────────
  const handleSubmit = async (): Promise<void> => {
    const trimmed = content.trim();
    if (!trimmed || isLoading) return;

    setIsLoading(true);
    setStatus(null);

    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        temporal_count?: number;
        entity_count?: number;
      };

      if (!res.ok) throw new Error(data.error ?? "Ingest failed.");

      setContent("");
      setStatus({
        type: "success",
        text: `Memory committed. ${data.temporal_count ?? 0} temporal event(s) · ${data.entity_count ?? 0} entity record(s) routed.`,
      });
      await fetchLedgers();
    } catch (err: unknown) {
      setStatus({
        type: "error",
        text: err instanceof Error ? err.message : "An unknown error occurred.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const formatTs = (iso: string): string =>
    new Date(iso).toLocaleString("en-US", {
      month: "short", day: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });

  // ============================================================
  // Render
  // ============================================================

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: GLOBAL_STYLES }} />

      <main className="cr-shell">
        {/* Header */}
        <header className="cr-header">
          <div className="cr-header-left">
            <span className="cr-brand">LXV</span>
            <span className="cr-title">Layer 1 Ingestion Protocol</span>
          </div>
          <div className="cr-header-right">
            <span className="cr-pulse-dot" />
            <span className="cr-header-meta">Cognitive Router · Online</span>
          </div>
        </header>

        {/* Input zone */}
        <section className="cr-input-zone">
          <textarea
            ref={textareaRef}
            className="cr-textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isLoading}
            rows={10}
            placeholder="Begin transcription. Mix past memories, present observations, and future intentions. Mention people freely — the router will extract, classify, and commit everything to the ledger..."
          />
          <p className="cr-char-count">{content.length.toLocaleString()} chars</p>

          {/* Controls */}
          <div className="cr-controls">
            <button
              type="button"
              onClick={toggleRecording}
              className={`cr-record-btn${isRecording ? " recording" : ""}`}
              title={isRecording ? "Stop recording" : "Start voice input"}
            >
              {isRecording ? <MicOff size={15} /> : <Mic size={15} />}
            </button>

            <button
              type="button"
              onClick={() => void handleSubmit()}
              disabled={!content.trim() || isLoading}
              className={`cr-submit-btn${isLoading ? " committing" : ""}`}
            >
              {isLoading ? (
                <><Loader2 size={13} className="cr-spin" /> Processing...</>
              ) : (
                <><ArrowRight size={13} /> Commit to Memory</>
              )}
            </button>

            <span className="cr-hint">⌘↩ to commit</span>
          </div>

          {status && (
            <div className={`cr-status ${status.type}`}>
              <span className="cr-status-icon">
                <Circle size={7} fill="currentColor" />
              </span>
              <span>{status.text}</span>
            </div>
          )}
        </section>

        {/* Divider */}
        <div className="cr-divider">
          <span className="cr-divider-label">
            <Activity size={9} />
            Raw Linear Notebook — Latest 5 Entries
          </span>
        </div>

        {/* Ledger */}
        <section className="cr-ledger">
          {ledgers.length === 0 ? (
            <div className="cr-ledger-empty">
              <span>NO ENTRIES IN LEDGER</span>
              <span style={{ opacity: 0.5 }}>Committed memories will appear here</span>
            </div>
          ) : (
            ledgers.map((ledger, i) => (
              <div
                key={ledger.id}
                className="cr-ledger-card"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="cr-ledger-meta">
                  <span className="cr-ledger-ts">{formatTs(ledger.created_at)}</span>
                  <span className="cr-ledger-id">{ledger.id.slice(0, 8).toUpperCase()}</span>
                </div>
                <p className="cr-ledger-text">{ledger.content}</p>
              </div>
            ))
          )}
        </section>
      </main>
    </>
  );
}