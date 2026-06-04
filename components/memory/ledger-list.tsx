"use client";

import { Clock, Calendar, Layers, BookOpen } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface RawLedger {
  id: string;
  created_at: string;
  content: string;
}

interface LedgerListProps {
  ledgers: RawLedger[];
  isLoading?: boolean;
}

export function LedgerList({ ledgers, isLoading }: LedgerListProps) {
  const formatTs = (iso: string): string =>
    new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

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
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-muted/50 border border-dashed border-border">
          <BookOpen className="h-7 w-7 text-muted-foreground/50" />
        </div>
        <h3 className="text-sm font-medium text-muted-foreground">No entries yet</h3>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Committed memories will appear here
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {ledgers.map((ledger, index) => (
        <Card
          key={ledger.id}
          className={cn(
            "group relative overflow-hidden border-border/50 bg-card/50 backdrop-blur-sm transition-all duration-300 hover:border-primary/20 hover:bg-card/80",
            "animate-fade-up"
          )}
          style={{ animationDelay: `${index * 50}ms` }}
        >
          {/* Gradient accent */}
          <div className="absolute left-0 top-0 h-full w-1 bg-gradient-to-b from-primary/50 via-primary/20 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
          
          <div className="p-4 sm:p-5">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="gap-1.5 font-mono text-[10px]">
                  <Clock className="h-3 w-3" />
                  {getRelativeTime(ledger.created_at)}
                </Badge>
                <Badge variant="secondary" className="gap-1.5 font-mono text-[10px]">
                  <Layers className="h-3 w-3" />
                  Raw Entry
                </Badge>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground/50 hidden sm:block">
                {ledger.id.slice(0, 8)}
              </span>
            </div>
            
            <p className="text-sm leading-relaxed text-foreground/80 line-clamp-3">
              {ledger.content}
            </p>
            
            <div className="mt-3 flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
              <Calendar className="h-3 w-3" />
              <span className="font-mono">{formatTs(ledger.created_at)}</span>
            </div>
          </div>
        </Card>
      ))}
      
      {isLoading && (
        <div className="flex justify-center py-4">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
    </div>
  );
}
