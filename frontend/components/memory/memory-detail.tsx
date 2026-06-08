"use client";

import { useState, useEffect } from "react";
import {
  X, Clock, MapPin, Smartphone, Globe, Zap, AlertTriangle,
  FileText, Users, CheckSquare, Calendar, Loader2, ChevronDown, ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface EntityEntry {
  id: string;
  name: string;
  interaction_type: string;
  trust_signal: string;
  ledger_note: string;
}

interface TodoEntry {
  id: string;
  task_description: string;
  status: string;
}

interface TemporalEntry {
  id: string;
  time_horizon: string;
  estimated_date: string;
  era: string;
  event_summary: string;
}

interface MemoryDetail {
  id: string;
  content: string;
  created_at: string;
  intent_tag: string;
  local_timezone?: string;
  location_text?: string;
  device_type?: string;
  entities: EntityEntry[];
  todos: TodoEntry[];
  temporals: TemporalEntry[];
}

interface MemoryDetailPanelProps {
  memoryId: string;
  onClose: () => void;
}

const intentConfig = {
  standard: { label: "Standard Memory", icon: FileText, color: "text-primary", bg: "bg-primary/10" },
  spark: { label: "Spark", icon: Zap, color: "text-warning", bg: "bg-warning/10" },
  friction: { label: "Friction", icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/10" },
};

const trustColor: Record<string, string> = {
  positive: "text-success",
  negative: "text-destructive",
  neutral: "text-muted-foreground",
};

const trustBg: Record<string, string> = {
  positive: "bg-success/10",
  negative: "bg-destructive/10",
  neutral: "bg-secondary",
};

export function MemoryDetailPanel({ memoryId, onClose }: MemoryDetailPanelProps) {
  const [detail, setDetail] = useState<MemoryDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    const fetchDetail = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const { supabase } = await import("@/lib/supabase-client");

        // Fetch base memory
        const { data: memory, error: memError } = await supabase
          .from("raw_ledgers")
          .select("id, content, created_at, intent_tag, local_timezone, location_text, device_type")
          .eq("id", memoryId)
          .single();

        if (memError || !memory) throw new Error("Memory not found");

        // Fetch all linked data in parallel
        const [entityRes, todoRes, temporalRes] = await Promise.all([
          supabase
            .from("entity_ledger")
            .select("id, name, interaction_type, trust_signal, ledger_note")
            .eq("raw_ledger_id", memoryId),
          supabase
            .from("todo_tasks")
            .select("id, task_description, status")
            .eq("raw_ledger_id", memoryId),
          supabase
            .from("temporal_memories")
            .select("id, time_horizon, estimated_date, era, event_summary")
            .eq("raw_ledger_id", memoryId),
        ]);

        setDetail({
          ...(memory as {
            id: string; content: string; created_at: string; intent_tag: string;
            local_timezone?: string; location_text?: string; device_type?: string;
          }),
          entities: (entityRes.data as EntityEntry[]) ?? [],
          todos: (todoRes.data as TodoEntry[]) ?? [],
          temporals: (temporalRes.data as TemporalEntry[]) ?? [],
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load memory");
      } finally {
        setIsLoading(false);
      }
    };
    void fetchDetail();
  }, [memoryId]);

  const formatFull = (iso: string, tz?: string | null) => {
    try {
      return new Date(iso).toLocaleString("en-IN", {
        timeZone: tz ?? undefined,
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      });
    } catch {
      return new Date(iso).toLocaleString();
    }
  };

  const intentTag = (detail?.intent_tag ?? "standard") as keyof typeof intentConfig;
  const cfg = intentConfig[intentTag] ?? intentConfig.standard;
  const Icon = cfg.icon;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative mt-auto w-full max-w-lg mx-auto rounded-t-3xl glass-card border border-border/50 max-h-[90vh] flex flex-col animate-fade-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <div className="flex items-center gap-2">
            {detail && (
              <span className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium", cfg.bg, cfg.color)}>
                <Icon className="h-3.5 w-3.5" />
                {cfg.label}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto flex-1 px-5 pb-10 space-y-4">
          {isLoading && (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          )}

          {error && (
            <div className="rounded-2xl bg-destructive/10 border border-destructive/20 p-4">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {detail && !isLoading && (
            <>
              {/* Full content */}
              <div className="rounded-2xl bg-secondary/30 p-4">
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {detail.content}
                </p>
              </div>

              {/* Metadata grid */}
              <div className="grid grid-cols-2 gap-2">
                <MetaCard
                  icon={<Clock className="h-3.5 w-3.5" />}
                  label="Recorded at"
                  value={formatFull(detail.created_at, detail.local_timezone)}
                />
                {detail.location_text && (
                  <MetaCard
                    icon={<MapPin className="h-3.5 w-3.5 text-success" />}
                    label="Location"
                    value={detail.location_text}
                  />
                )}
                {detail.local_timezone && (
                  <MetaCard
                    icon={<Globe className="h-3.5 w-3.5" />}
                    label="Timezone"
                    value={detail.local_timezone}
                  />
                )}
                {detail.device_type && (
                  <MetaCard
                    icon={<Smartphone className="h-3.5 w-3.5" />}
                    label="Device"
                    value={detail.device_type}
                  />
                )}
              </div>

              {/* Stats bar */}
              <div className="flex gap-3">
                <StatPill color="text-warning" label="People" count={detail.entities.length} />
                <StatPill color="text-primary" label="Events" count={detail.temporals.length} />
                <StatPill color="text-success" label="Tasks" count={detail.todos.length} />
              </div>

              {/* Entities */}
              {detail.entities.length > 0 && (
                <section>
                  <SectionHeader icon={<Users className="h-3.5 w-3.5 text-warning" />} title="People Mentioned" />
                  <div className="space-y-2 mt-2">
                    {detail.entities.map((e) => (
                      <div key={e.id} className="rounded-2xl bg-secondary/40 p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-foreground">{e.name}</span>
                          <span className={cn(
                            "rounded-full px-2 py-0.5 text-[10px] font-medium",
                            trustBg[e.trust_signal] ?? "bg-secondary",
                            trustColor[e.trust_signal] ?? "text-muted-foreground"
                          )}>
                            {e.trust_signal} · {e.interaction_type}
                          </span>
                        </div>
                        {e.ledger_note && (
                          <p className="text-xs text-muted-foreground leading-relaxed">{e.ledger_note}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Todos */}
              {detail.todos.length > 0 && (
                <section>
                  <SectionHeader icon={<CheckSquare className="h-3.5 w-3.5 text-success" />} title="Tasks Created" />
                  <div className="space-y-2 mt-2">
                    {detail.todos.map((t) => (
                      <div key={t.id} className="flex items-center gap-3 rounded-2xl bg-secondary/40 p-3">
                        <span className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          t.status === "done" ? "bg-success" : "bg-primary"
                        )} />
                        <p className={cn(
                          "flex-1 text-sm text-foreground",
                          t.status === "done" && "line-through text-muted-foreground"
                        )}>
                          {t.task_description}
                        </p>
                        <span className={cn(
                          "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                          t.status === "done" ? "bg-success/10 text-success" : "bg-primary/10 text-primary"
                        )}>
                          {t.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Temporal memories */}
              {detail.temporals.length > 0 && (
                <section>
                  <SectionHeader icon={<Calendar className="h-3.5 w-3.5 text-primary" />} title="Events Extracted" />
                  <div className="space-y-2 mt-2">
                    {detail.temporals.map((t) => (
                      <div key={t.id} className="rounded-2xl bg-secondary/40 p-3">
                        <div className="flex items-center justify-between mb-1">
                          <span className={cn(
                            "text-[10px] font-medium rounded-full px-2 py-0.5",
                            t.time_horizon === "future" ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"
                          )}>
                            {t.time_horizon} · {t.era}
                          </span>
                          {t.estimated_date && (
                            <span className="text-[10px] text-muted-foreground">{t.estimated_date}</span>
                          )}
                        </div>
                        <p className="text-sm text-foreground leading-relaxed">{t.event_summary}</p>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {/* Raw ID toggle */}
              <button
                onClick={() => setShowRaw((v) => !v)}
                className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground transition-colors py-1"
              >
                <span>Technical details</span>
                {showRaw ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {showRaw && (
                <div className="rounded-xl bg-background/60 p-3 space-y-1">
                  <p className="text-[10px] font-mono text-muted-foreground">id: {detail.id}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">created_at: {detail.created_at}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">intent_tag: {detail.intent_tag}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">device: {detail.device_type ?? "unknown"}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">timezone: {detail.local_timezone ?? "unknown"}</p>
                  {detail.location_text && (
                    <p className="text-[10px] font-mono text-muted-foreground">location: {detail.location_text}</p>
                  )}
                  <p className="text-[10px] font-mono text-muted-foreground">
                    entities: {detail.entities.length} · todos: {detail.todos.length} · events: {detail.temporals.length}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-secondary/40 p-3">
      <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">
        {icon}
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xs text-foreground leading-snug">{value}</p>
    </div>
  );
}

function StatPill({ color, label, count }: { color: string; label: string; count: number }) {
  return (
    <div className="flex-1 rounded-xl bg-secondary/40 p-2.5 text-center">
      <p className={cn("text-lg font-bold", color)}>{count}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{title}</h4>
    </div>
  );
}
