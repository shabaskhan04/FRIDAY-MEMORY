"use client";

import { Clock, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface RawLedger {
  id: string;
  created_at: string;
  content: string;
}

interface LedgerListProps {
  ledgers: RawLedger[];
}

export function LedgerList({ ledgers }: LedgerListProps) {
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
      {ledgers.map((ledger, index) => (
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
                <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                  Memory
                </span>
                <button className="text-muted-foreground hover:text-foreground transition-colors">
                  <Info className="h-4 w-4" />
                </button>
              </div>
              <p className="text-sm text-foreground line-clamp-2 leading-relaxed">
                {ledger.content}
              </p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {getRelativeTime(ledger.created_at)}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
