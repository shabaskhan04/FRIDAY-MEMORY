"use client";

import { useState, useEffect } from "react";
import { BarChart3, Loader2, Zap, AlertTriangle, FileText, Users, CheckSquare } from "lucide-react";
import { cn } from "@/lib/utils";

interface InsightsViewProps {
  isConfigured: boolean;
}

interface InsightData {
  total_memories: number;
  total_entities: number;
  total_todos: number;
  pending_todos: number;
  intent_breakdown: Record<string, number>;
  trust_breakdown: Record<string, number>;
  timeline: { date: string; count: number }[];
}

const intentConfig = {
  standard: { label: "Standard", icon: FileText, color: "text-primary", bg: "bg-primary/10" },
  spark: { label: "Spark", icon: Zap, color: "text-warning", bg: "bg-warning/10" },
  friction: { label: "Friction", icon: AlertTriangle, color: "text-destructive", bg: "bg-destructive/10" },
};

export function InsightsView({ isConfigured }: InsightsViewProps) {
  const [data, setData] = useState<InsightData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isConfigured) { setIsLoading(false); return; }

    const fetchInsights = async () => {
      setIsLoading(true);
      try {
        const { createClient } = await import("@/lib/supabase");
        const supabase = createClient();

        const [rawRes, entityRes, todoRes] = await Promise.all([
          supabase.from("raw_ledgers").select("id, intent_tag, created_at"),
          supabase.from("entity_ledger").select("trust_signal"),
          supabase.from("todo_tasks").select("status"),
        ]);

        const rawLedgers = rawRes.data ?? [];
        const entities = entityRes.data ?? [];
        const todos = todoRes.data ?? [];

        // Intent breakdown
        const intentBreakdown: Record<string, number> = {};
        for (const r of rawLedgers) {
          const tag = (r.intent_tag as string) ?? "standard";
          intentBreakdown[tag] = (intentBreakdown[tag] ?? 0) + 1;
        }

        // Trust breakdown
        const trustBreakdown: Record<string, number> = {};
        for (const e of entities) {
          const signal = (e.trust_signal as string) ?? "neutral";
          trustBreakdown[signal] = (trustBreakdown[signal] ?? 0) + 1;
        }

        // Timeline — last 7 days
        const timeline: { date: string; count: number }[] = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          const dateStr = d.toISOString().split("T")[0];
          const count = rawLedgers.filter((r) =>
            (r.created_at as string).startsWith(dateStr)
          ).length;
          timeline.push({ date: dateStr, count });
        }

        setData({
          total_memories: rawLedgers.length,
          total_entities: entities.length,
          total_todos: todos.length,
          pending_todos: todos.filter((t) => t.status === "pending").length,
          intent_breakdown: intentBreakdown,
          trust_breakdown: trustBreakdown,
          timeline,
        });
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    };
    void fetchInsights();
  }, [isConfigured]);

  if (!isConfigured) {
    return (
      <div className="rounded-2xl glass-card p-8 text-center">
        <p className="text-sm text-muted-foreground">Connect Supabase to see insights</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!data) return null;

  const maxTimeline = Math.max(...data.timeline.map((t) => t.count), 1);
  const totalTrust = Object.values(data.trust_breakdown).reduce((a, b) => a + b, 0);
  const totalIntent = Object.values(data.intent_breakdown).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4">
      {/* Stats grid */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Memories", value: data.total_memories, icon: FileText, color: "text-primary" },
          { label: "People", value: data.total_entities, icon: Users, color: "text-warning" },
          { label: "Tasks", value: `${data.pending_todos}/${data.total_todos}`, icon: CheckSquare, color: "text-success" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-2xl glass-card p-3 text-center">
            <stat.icon className={cn("h-4 w-4 mx-auto mb-1", stat.color)} />
            <p className="text-lg font-bold text-foreground">{stat.value}</p>
            <p className="text-[10px] text-muted-foreground">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* 7-day timeline */}
      <div className="rounded-2xl glass-card p-4">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Last 7 Days</h3>
        </div>
        <div className="flex items-end gap-1.5 h-24">
          {data.timeline.map((day) => {
            const height = maxTimeline > 0 ? (day.count / maxTimeline) * 100 : 0;
            const label = new Date(day.date + "T00:00:00").toLocaleDateString("en", { weekday: "short" });
            return (
              <div key={day.date} className="flex flex-col items-center gap-1 flex-1">
                <div className="w-full flex items-end" style={{ height: "80px" }}>
                  <div
                    className="w-full rounded-t-md transition-all duration-500"
                    style={{
                      height: `${Math.max(height, day.count > 0 ? 8 : 2)}%`,
                      background: day.count > 0
                        ? "linear-gradient(180deg, hsl(262 83% 68%) 0%, hsl(280 80% 60%) 100%)"
                        : "hsl(240 5% 16%)",
                    }}
                  />
                </div>
                <span className="text-[9px] text-muted-foreground">{label}</span>
                {day.count > 0 && (
                  <span className="text-[9px] text-primary font-medium">{day.count}</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Intent breakdown */}
      {totalIntent > 0 && (
        <div className="rounded-2xl glass-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Memory Types</h3>
          <div className="space-y-2">
            {Object.entries(intentConfig).map(([intent, cfg]) => {
              const count = data.intent_breakdown[intent] ?? 0;
              const pct = totalIntent > 0 ? (count / totalIntent) * 100 : 0;
              const Icon = cfg.icon;
              return (
                <div key={intent}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5">
                      <Icon className={cn("h-3.5 w-3.5", cfg.color)} />
                      <span className="text-xs text-muted-foreground">{cfg.label}</span>
                    </div>
                    <span className="text-xs font-medium text-foreground">
                      {count} ({Math.round(pct)}%)
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                    <div
                      className={cn("h-full rounded-full transition-all duration-700", cfg.bg.replace("/10", ""))}
                      style={{
                        width: `${pct}%`,
                        background: intent === "spark"
                          ? "hsl(38 92% 50%)"
                          : intent === "friction"
                          ? "hsl(0 72% 63%)"
                          : "hsl(262 83% 68%)",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Trust breakdown */}
      {totalTrust > 0 && (
        <div className="rounded-2xl glass-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Relationship Trust</h3>
          <div className="flex gap-3">
            {[
              { key: "positive", label: "Positive", color: "bg-success", text: "text-success" },
              { key: "neutral", label: "Neutral", color: "bg-muted-foreground/40", text: "text-muted-foreground" },
              { key: "negative", label: "Negative", color: "bg-destructive", text: "text-destructive" },
            ].map(({ key, label, color, text }) => {
              const count = data.trust_breakdown[key] ?? 0;
              const pct = totalTrust > 0 ? Math.round((count / totalTrust) * 100) : 0;
              return (
                <div key={key} className="flex-1 text-center rounded-xl bg-secondary/50 p-3">
                  <div className={cn("mx-auto h-2 w-2 rounded-full mb-1", color)} />
                  <p className={cn("text-base font-bold", text)}>{count}</p>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                  <p className="text-[10px] text-muted-foreground/60">{pct}%</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
