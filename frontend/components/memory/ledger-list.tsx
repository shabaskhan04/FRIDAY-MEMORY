"use client";

import { Clock, MapPin, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface RawLedger {
  id: string;
  created_at: string;
  content: string;
  intent_tag?: string;
  local_timezone?: string;
  location_text?: string;
}

interface LedgerListProps {
  ledgers: RawLedger[];
}

const intentConfig: Record<string, { label: string; color: string; bg: string }> = {
  standard: { label: "Memory", color: "text-primary", bg: "bg-primary/10" },
  spark: { label: "⚡ Spark", color: "text-warning", bg: "bg-warning/10" },
  friction: { label: "🔥 Friction", color: "text-destructive", bg: "bg-destructive/10" },
};

export function LedgerList({ ledgers }: LedgerListProps) {
  const formatTimestamp = (iso: string, tz?: string | null): string => {
    try {
      return new Date(iso).toLocaleString("en-IN", {
        timeZone: tz ?? undefined,
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } catch {
      return new Date(iso).toLocaleString();
    }
  };

  const getRelativeTime = (iso: string): string => {
    const now = new Date();
    const date = new Date(iso);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  if (ledgers.length === 0) {
    return (
      <div className="rounded-2xl glass-card p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
          <Clock className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground">No memories yet</p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Your memories will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {ledgers.map((ledger, index) => {
        const cfg = intentConfig[ledger.intent_tag ?? "standard"] ?? intentConfig.standard;
        return (
          <div
            key={ledger.id}
            className={cn(
              "rounded-2xl glass-card p-4 transition-all duration-300 hover:glass-card-hover animate-fade-up"
            )}
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <div className="flex items-start gap-3">
              {/* Icon */}
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                <Clock className="h-4 w-4 text-primary" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", cfg.bg, cfg.color)}>
                    {cfg.label}
                  </span>
                  <button className="text-muted-foreground hover:text-foreground transition-colors">
                    <Info className="h-4 w-4" />
                  </button>
                </div>

                <p className="text-sm text-foreground line-clamp-2 leading-relaxed">
                  {ledger.content}
                </p>

                {/* Timestamp + Location row */}
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-muted-foreground">
                    {getRelativeTime(ledger.created_at)}
                  </span>
                  <span className="text-[10px] text-muted-foreground/40">·</span>
                  <span className="text-[10px] text-muted-foreground/60">
                    {formatTimestamp(ledger.created_at, ledger.local_timezone)}
                  </span>
                  {ledger.location_text && (
                    <>
                      <span className="text-[10px] text-muted-foreground/40">·</span>
                      <span className="flex items-center gap-0.5 text-[10px] text-success/80">
                        <MapPin className="h-2.5 w-2.5" />
                        {ledger.location_text}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
