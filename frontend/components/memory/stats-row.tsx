"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface StatsRowProps {
  isConfigured: boolean;
  isProcessing?: boolean;
  refreshTrigger?: number;
}

interface Stats {
  total_memories: number;
  streak: number;
  score: number;
}

// Convert a UTC ISO string to local YYYY-MM-DD string (timezone-aware)
function toLocalDateStr(iso: string): string {
  const d = new Date(iso);
  // Use 'en-CA' locale which gives YYYY-MM-DD format in local timezone
  return d.toLocaleDateString("en-CA");
}

export function StatsRow({ isConfigured, isProcessing, refreshTrigger = 0 }: StatsRowProps) {
  const [stats, setStats] = useState<Stats>({ total_memories: 0, streak: 0, score: 0 });

  useEffect(() => {
    if (!isConfigured) return;

    const fetchStats = async () => {
      try {
        const { supabase } = await import("@/lib/supabase-client");
        const { data, error } = await supabase
          .from("raw_ledgers")
          .select("created_at")
          .order("created_at", { ascending: false });

        if (error || !data) return;

        const total = data.length;

        // Build set of LOCAL dates that have at least 1 entry
        const datesWithEntries = new Set(
          data.map((r: { created_at: string }) => toLocalDateStr(r.created_at))
        );

        // Calculate streak: walk backwards from today in local time
        let streak = 0;
        const checkDate = new Date();
        checkDate.setHours(12, 0, 0, 0); // noon to avoid DST edge cases

        while (true) {
          const dateStr = checkDate.toLocaleDateString("en-CA");
          if (datesWithEntries.has(dateStr)) {
            streak++;
            checkDate.setDate(checkDate.getDate() - 1);
          } else {
            // Allow gap for "today" if we haven't recorded yet
            if (streak === 0) {
              checkDate.setDate(checkDate.getDate() - 1);
              const ydStr = checkDate.toLocaleDateString("en-CA");
              if (datesWithEntries.has(ydStr)) {
                // Streak started yesterday, keep going
                continue;
              }
            }
            break;
          }
        }

        // Score: based on total memories (capped at 100)
        const score = Math.min(Math.round((total / 50) * 100), 100);

        setStats({ total_memories: total, streak, score });
      } catch {
        // ignore
      }
    };

    void fetchStats();
  }, [isConfigured, refreshTrigger]);

  const { total_memories, streak, score } = stats;

  return (
    <div className="mb-6 grid grid-cols-2 gap-3">
      {/* Memory Score Card */}
      <div className="rounded-2xl glass-card p-4 relative overflow-hidden">
        <div className="absolute inset-0 gradient-purple-subtle pointer-events-none" />
        <div className="relative">
          <p className="text-xs text-muted-foreground mb-1">Memory Score</p>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-foreground">
              {isProcessing ? "..." : score}
            </span>
            <span className="text-sm text-muted-foreground">/100</span>
          </div>
          <div className="mt-3 h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full gradient-purple transition-all duration-700"
              style={{ width: `${score}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {total_memories > 0 ? `${total_memories} total memories` : "Start capturing memories"}
          </p>
        </div>
      </div>

      {/* Streak Card */}
      <div className="rounded-2xl glass-card p-4 relative overflow-hidden">
        <div className="relative">
          <p className="text-xs text-muted-foreground mb-1">Entry Streak</p>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-foreground">
              {isProcessing ? "..." : streak}
            </span>
            <span className="text-sm text-muted-foreground">days</span>
          </div>
          <div className="mt-3 flex gap-0.5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-4 w-1.5 rounded-sm transition-colors",
                  i < streak ? "bg-foreground" : "bg-secondary"
                )}
              />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {isProcessing ? "Processing..." : streak > 0 ? "Keep the streak going 🔥" : "Start today"}
          </p>
        </div>
      </div>
    </div>
  );
}
