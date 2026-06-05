"use client";

import { useState, useEffect } from "react";
import { Clock, Search, Loader2, Filter, ChevronRight, Sparkles, BookOpen, X, Brain, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { MemoryDetailPanel } from "@/components/memory/memory-detail";

// ─── Types ─────────────────────────────────────────────────────────────────

interface RawLedger {
  id: string;
  created_at: string;
  content: string;
  intent_tag: string;
  local_timezone?: string;
  location_text?: string;
  // V2 hybrid scores (only present in search results)
  similarity?: number;
  final_score?: number;
  semantic_score?: number;
  keyword_score?: number;
  entity_score?: number;
  recency_score?: number;
  matched_entities?: string[];
}

interface CitedMemory {
  id: string;
  content: string;
  created_at: string;
  intent_tag: string | null;
  similarity: number;
  // V2
  final_score?: number;
  semantic_score?: number;
  keyword_score?: number;
  entity_score?: number;
  recency_score?: number;
  matched_entities?: string[];
}

interface AskResponse {
  answer: string;
  citations: CitedMemory[];
  cited_ids: string[];
  // V2
  query_type?: string;
  entities_detected?: string[];
  error?: string;
}

interface MemoryTabProps {
  isConfigured: boolean;
}

// ─── Config ─────────────────────────────────────────────────────────────────

const intentConfig: Record<string, { label: string; emoji: string; color: string; bg: string }> = {
  standard:  { label: "Memory",     emoji: "📝", color: "text-primary",     bg: "bg-primary/10"     },
  spark:     { label: "Spark",      emoji: "⚡", color: "text-warning",     bg: "bg-warning/10"     },
  friction:  { label: "Friction",   emoji: "🔥", color: "text-destructive", bg: "bg-destructive/10" },
};

const queryTypeConfig: Record<string, { label: string; emoji: string }> = {
  FACT_LOOKUP:    { label: "Fact lookup",   emoji: "🔍" },
  PERSON_SEARCH:  { label: "Person search", emoji: "👤" },
  PROJECT_SEARCH: { label: "Project",       emoji: "📂" },
  REFLECTION:     { label: "Reflection",    emoji: "🪞" },
  ADVICE:         { label: "Advice",        emoji: "💡" },
  TIMELINE:       { label: "Timeline",      emoji: "📅" },
};

// ─── Score mini-bar ──────────────────────────────────────────────────────────

function ScorePill({ score, label }: { score: number; label: string }) {
  return (
    <span className="flex items-center gap-1 text-[9px] text-muted-foreground/60">
      <span>{label}</span>
      <span className="font-semibold text-muted-foreground/80">{Math.round(score * 100)}</span>
    </span>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export function MemoryTab({ isConfigured }: MemoryTabProps) {
  const [ledgers, setLedgers]                     = useState<RawLedger[]>([]);
  const [isLoading, setIsLoading]                 = useState(true);
  const [isSearching, setIsSearching]             = useState(false);
  const [search, setSearch]                       = useState("");
  const [semanticResults, setSemanticResults]     = useState<RawLedger[] | null>(null);
  const [searchError, setSearchError]             = useState<string | null>(null);
  const [filterIntent, setFilterIntent]           = useState<string>("all");
  const [selectedId, setSelectedId]               = useState<string | null>(null);

  // Ask Friday state
  const [askMode, setAskMode]       = useState<"idle" | "loading" | "done" | "error">("idle");
  const [askResult, setAskResult]   = useState<AskResponse | null>(null);
  const [expandedCitation, setExpandedCitation] = useState<string | null>(null);
  const [showScores, setShowScores] = useState(false);

  // ── Fetch all memories ───────────────────────────────────────────────────

  useEffect(() => {
    if (!isConfigured) { setIsLoading(false); return; }
    const fetchAll = async () => {
      setIsLoading(true);
      try {
        const { createClient } = await import("@/lib/supabase");
        const supabase = createClient();
        const { data, error } = await supabase
          .from("raw_ledgers")
          .select("id, created_at, content, intent_tag, local_timezone, location_text")
          .or("is_reflection.is.null,is_reflection.eq.false")
          .order("created_at", { ascending: false })
          .limit(200);
        if (!error && data) setLedgers(data as RawLedger[]);
      } catch { /* ignore */ }
      finally { setIsLoading(false); }
    };
    void fetchAll();
  }, [isConfigured]);

  // ── Hybrid search on debounce ────────────────────────────────────────────

  useEffect(() => {
    const query = search.trim();
    if (!isConfigured || query.length === 0) {
      setSemanticResults(null);
      setSearchError(null);
      setIsSearching(false);
      setAskMode("idle");
      setAskResult(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);

      try {
        const response = await fetch("/api/memory/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query, limit: 50 }),
          signal: controller.signal,
        });

        const payload = (await response.json()) as { memories?: RawLedger[]; error?: string };

        if (!response.ok) throw new Error(payload.error ?? "Search failed.");
        setSemanticResults(payload.memories ?? []);
      } catch (err) {
        if (controller.signal.aborted) return;
        setSemanticResults(null);
        setSearchError(err instanceof Error ? err.message : "Using plain text search.");
      } finally {
        if (!controller.signal.aborted) setIsSearching(false);
      }
    }, 350);

    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [search, isConfigured]);

  // ── Ask Friday ───────────────────────────────────────────────────────────

  const handleAskFriday = async () => {
    const query = search.trim();
    if (!query) return;

    setAskMode("loading");
    setAskResult(null);
    setExpandedCitation(null);

    try {
      const response = await fetch("/api/memory/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      const payload = (await response.json()) as AskResponse;

      if (!response.ok || payload.error) throw new Error(payload.error ?? "Ask Friday failed.");

      setAskResult(payload);
      setAskMode("done");
    } catch (err) {
      setAskResult({
        answer: err instanceof Error ? err.message : "Something went wrong.",
        citations: [],
        cited_ids: [],
        error: "failed",
      });
      setAskMode("error");
    }
  };

  const dismissAsk = () => {
    setAskMode("idle");
    setAskResult(null);
    setExpandedCitation(null);
  };

  // ── Helpers ──────────────────────────────────────────────────────────────

  const getRelativeTime = (iso: string): string => {
    const now = new Date();
    const d = new Date(iso);
    const diffMs = now.getTime() - d.getTime();
    const diffMins  = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays  = Math.floor(diffMs / 86400000);
    if (diffMins < 1)  return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const formatDate = (iso: string, tz?: string | null) => {
    try {
      return new Date(iso).toLocaleDateString("en-IN", {
        timeZone: tz ?? undefined,
        month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit", hour12: true,
      });
    } catch { return new Date(iso).toLocaleDateString(); }
  };

  // ── Derived state ────────────────────────────────────────────────────────

  const sourceLedgers         = semanticResults ?? ledgers;
  const usingSemanticResults  = search.trim().length > 0 && semanticResults !== null;

  const filtered = sourceLedgers.filter((l) => {
    const matchSearch =
      usingSemanticResults ||
      search === "" ||
      l.content.toLowerCase().includes(search.toLowerCase());
    const matchIntent = filterIntent === "all" || l.intent_tag === filterIntent;
    return matchSearch && matchIntent;
  });

  const intentCounts = ledgers.reduce((acc, l) => {
    acc[l.intent_tag] = (acc[l.intent_tag] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // ── Early return: not configured ─────────────────────────────────────────

  if (!isConfigured) {
    return (
      <div className="rounded-2xl glass-card p-8 text-center">
        <p className="text-sm text-muted-foreground">Connect Supabase to see all memories</p>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <div className="space-y-4">

        {/* ── Search bar ── */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search memories..."
            className="w-full rounded-2xl glass-card pl-9 pr-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/30 bg-transparent"
          />
          {isSearching && (
            <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-primary" />
          )}
        </div>

        {/* ── Ask Friday CTA ── */}
        {search.trim().length > 0 && askMode === "idle" && (
          <div className="flex items-center gap-2">
            <p className="flex-1 px-1 text-[11px] text-muted-foreground">
              {searchError
                ? "Hybrid search unavailable — showing plain text matches."
                : usingSemanticResults
                  ? "Hybrid results: semantic + keyword + entity ranked."
                  : "Searching by meaning..."}
            </p>
            <button
              onClick={handleAskFriday}
              className="shrink-0 flex items-center gap-1.5 rounded-full gradient-purple px-3 py-1.5 text-[11px] font-semibold text-white shadow-lg shadow-primary/20 transition-all hover:scale-105 active:scale-95"
            >
              <Sparkles className="h-3 w-3" />
              Ask Friday
            </button>
          </div>
        )}

        {/* ── Ask Friday Answer Panel ── */}
        {(askMode === "loading" || askMode === "done" || askMode === "error") && (
          <div className={cn(
            "rounded-2xl border p-4 space-y-3 animate-fade-up",
            askMode === "error"
              ? "border-destructive/20 bg-destructive/5"
              : "gradient-purple-subtle border-primary/20"
          )}>

            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full gradient-purple">
                  <Sparkles className="h-3 w-3 text-white" />
                </div>
                <span className="text-xs font-semibold text-foreground">
                  {askMode === "loading" ? "Friday is thinking…" : "Friday's Answer"}
                </span>
                {/* Query type badge */}
                {askMode === "done" && askResult?.query_type && (() => {
                  const qtc = queryTypeConfig[askResult.query_type];
                  return qtc ? (
                    <span className="text-[9px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">
                      {qtc.emoji} {qtc.label}
                    </span>
                  ) : null;
                })()}
              </div>

              <div className="flex items-center gap-2">
                {/* Dev: toggle scores */}
                {askMode === "done" && (
                  <button
                    onClick={() => setShowScores((s) => !s)}
                    className="text-[9px] text-muted-foreground/60 hover:text-muted-foreground underline"
                  >
                    {showScores ? "hide scores" : "scores"}
                  </button>
                )}
                {askMode !== "loading" && (
                  <button
                    onClick={dismissAsk}
                    className="rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Entities detected */}
            {askMode === "done" && askResult?.entities_detected && askResult.entities_detected.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <Tag className="h-3 w-3 text-primary/50" />
                <span className="text-[9px] text-primary/50 uppercase tracking-wide font-medium">entities</span>
                {askResult.entities_detected.map((e) => (
                  <span key={e} className="text-[9px] bg-purple-500/10 text-purple-400 px-1.5 py-0.5 rounded-full">
                    {e}
                  </span>
                ))}
              </div>
            )}

            {/* Loading shimmer */}
            {askMode === "loading" && (
              <div className="space-y-2">
                {[80, 60, 45].map((w, i) => (
                  <div
                    key={i}
                    className="relative h-3 rounded-full bg-primary/10 overflow-hidden"
                    style={{ width: `${w}%` }}
                  >
                    <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-primary/20 to-transparent" />
                  </div>
                ))}
              </div>
            )}

            {/* Answer */}
            {askMode === "done" && askResult && (
              <>
                <p className="text-sm text-foreground leading-relaxed">{askResult.answer}</p>

                {/* Citations */}
                {askResult.citations.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <BookOpen className="h-3 w-3 text-primary/60" />
                      <span className="text-[10px] font-medium text-primary/60 uppercase tracking-wider">
                        Evidence ({askResult.citations.length})
                      </span>
                    </div>

                    {askResult.citations.map((cite, idx) => {
                      const cfg = intentConfig[cite.intent_tag ?? "standard"] ?? intentConfig.standard;
                      const isExpanded = expandedCitation === cite.id;
                      const hasEntity = (cite.matched_entities ?? []).length > 0;

                      return (
                        <button
                          key={cite.id}
                          onClick={() => setExpandedCitation(isExpanded ? null : cite.id)}
                          className="w-full text-left rounded-xl border border-primary/10 bg-primary/5 px-3 py-2 transition-all hover:border-primary/20 hover:bg-primary/10 active:scale-[0.99]"
                        >
                          <div className="flex items-start gap-2">
                            <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/20 text-[9px] font-bold text-primary">
                              {idx + 1}
                            </span>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                                <span className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded-full", cfg.bg, cfg.color)}>
                                  {cfg.emoji} {cfg.label}
                                </span>
                                <span className="text-[9px] text-muted-foreground">
                                  {formatDate(cite.created_at)}
                                </span>
                                {hasEntity && (
                                  <span className="text-[9px] bg-purple-500/10 text-purple-400 px-1.5 py-0.5 rounded-full">
                                    👤 {cite.matched_entities!.join(", ")}
                                  </span>
                                )}
                              </div>

                              <p className={cn(
                                "text-[11px] text-foreground/80 leading-relaxed transition-all",
                                isExpanded ? "" : "line-clamp-2"
                              )}>
                                {cite.content}
                              </p>

                              {/* Score breakdown — developer mode */}
                              {showScores && cite.final_score !== undefined && (
                                <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                                  <ScorePill score={cite.semantic_score ?? 0} label="sem" />
                                  <span className="text-[9px] text-muted-foreground/30">·</span>
                                  <ScorePill score={cite.keyword_score ?? 0} label="kw" />
                                  <span className="text-[9px] text-muted-foreground/30">·</span>
                                  <ScorePill score={cite.entity_score ?? 0} label="ent" />
                                  <span className="text-[9px] text-muted-foreground/30">·</span>
                                  <ScorePill score={cite.recency_score ?? 0} label="rec" />
                                  <span className="text-[9px] text-muted-foreground/30">→</span>
                                  <span className="text-[9px] font-bold text-primary/70">
                                    {Math.round((cite.final_score ?? 0) * 100)}
                                  </span>
                                </div>
                              )}
                            </div>

                            <ChevronRight className={cn(
                              "h-3 w-3 shrink-0 text-muted-foreground/40 mt-1 transition-transform",
                              isExpanded && "rotate-90"
                            )} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {askResult.citations.length === 0 && (
                  <p className="text-[11px] text-muted-foreground italic">
                    No specific memories were cited for this answer.
                  </p>
                )}
              </>
            )}

            {/* Error state */}
            {askMode === "error" && askResult && (
              <p className="text-sm text-destructive">{askResult.answer}</p>
            )}
          </div>
        )}

        {askMode === "done" && (
          <p className="px-1 text-[11px] text-muted-foreground">
            {search.trim().length > 0 ? "Showing related memories below." : ""}
          </p>
        )}

        {askMode === "idle" && search.trim().length === 0 && (
          <p className="px-1 text-[11px] text-muted-foreground" />
        )}

        {/* ── Filter pills ── */}
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-hide">
          <button
            onClick={() => setFilterIntent("all")}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition-all",
              filterIntent === "all"
                ? "gradient-purple text-white"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            )}
          >
            All ({ledgers.length})
          </button>
          {Object.entries(intentCounts).map(([intent, count]) => {
            const cfg = intentConfig[intent] ?? intentConfig.standard;
            return (
              <button
                key={intent}
                onClick={() => setFilterIntent(intent)}
                className={cn(
                  "shrink-0 flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all",
                  filterIntent === intent
                    ? `${cfg.bg} ${cfg.color}`
                    : "bg-secondary text-muted-foreground hover:text-foreground"
                )}
              >
                <Filter className="h-3 w-3" />
                {cfg.emoji} {cfg.label} ({count})
              </button>
            );
          })}
        </div>

        {/* ── Memory list ── */}
        {isLoading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl glass-card p-8 text-center">
            <p className="text-sm text-muted-foreground">
              {search ? "No memories match your search" : "No memories yet"}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map((ledger, index) => {
              const cfg = intentConfig[ledger.intent_tag] ?? intentConfig.standard;
              const hasEntities = (ledger.matched_entities ?? []).length > 0;

              return (
                <button
                  key={ledger.id}
                  onClick={() => setSelectedId(ledger.id)}
                  className="w-full text-left rounded-2xl glass-card p-4 transition-all duration-200 hover:glass-card-hover hover:scale-[1.01] active:scale-[0.99] animate-fade-up"
                  style={{ animationDelay: `${index * 25}ms` }}
                >
                  <div className="flex items-start gap-3">
                    {/* Intent icon */}
                    <div className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-base",
                      cfg.bg
                    )}>
                      {cfg.emoji}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", cfg.bg, cfg.color)}>
                            {cfg.label}
                          </span>
                          {/* Entity badge */}
                          {hasEntities && (
                            <span className="text-[9px] bg-purple-500/10 text-purple-400 px-1.5 py-0.5 rounded-full">
                              👤 {ledger.matched_entities!.slice(0, 2).join(", ")}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {ledger.final_score !== undefined
                            ? `${Math.round(ledger.final_score * 100)}% match`
                            : getRelativeTime(ledger.created_at)}
                        </span>
                      </div>

                      <p className="text-sm text-foreground leading-relaxed line-clamp-2">
                        {ledger.content}
                      </p>

                      {/* Score row (dev mode) */}
                      {showScores && ledger.final_score !== undefined && (
                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                          <Brain className="h-2.5 w-2.5 text-muted-foreground/40" />
                          <ScorePill score={ledger.semantic_score ?? 0} label="sem" />
                          <span className="text-[9px] text-muted-foreground/30">·</span>
                          <ScorePill score={ledger.keyword_score ?? 0} label="kw" />
                          <span className="text-[9px] text-muted-foreground/30">·</span>
                          <ScorePill score={ledger.entity_score ?? 0} label="ent" />
                          <span className="text-[9px] text-muted-foreground/30">·</span>
                          <ScorePill score={ledger.recency_score ?? 0} label="rec" />
                        </div>
                      )}

                      {/* Timestamp + location */}
                      <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                        <span className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
                          <Clock className="h-2.5 w-2.5" />
                          {formatDate(ledger.created_at, ledger.local_timezone)}
                        </span>
                        {ledger.location_text && (
                          <>
                            <span className="text-[10px] text-muted-foreground/40">·</span>
                            <span className="text-[10px] text-success/70">
                              📍 {ledger.location_text}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 mt-1" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Memory detail panel */}
      {selectedId && (
        <MemoryDetailPanel
          memoryId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </>
  );
}
