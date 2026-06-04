"use client";

import { cn } from "@/lib/utils";

interface StatsRowProps {
  totalEntries: number;
  isProcessing?: boolean;
}

export function StatsRow({ totalEntries, isProcessing }: StatsRowProps) {
  return (
    <div className="mb-6 grid grid-cols-2 gap-3">
      {/* Memory Score Card */}
      <div className="rounded-2xl glass-card p-4 relative overflow-hidden">
        <div className="absolute inset-0 gradient-purple-subtle pointer-events-none" />
        <div className="relative">
          <p className="text-xs text-muted-foreground mb-1">Memory Score</p>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-foreground">{totalEntries > 0 ? Math.min(totalEntries * 10 + 60, 100) : 0}</span>
            <span className="text-sm text-muted-foreground">/100</span>
          </div>
          <div className="mt-3 h-2 rounded-full bg-secondary overflow-hidden">
            <div 
              className="h-full rounded-full gradient-purple transition-all duration-500"
              style={{ width: `${totalEntries > 0 ? Math.min(totalEntries * 10 + 60, 100) : 0}%` }}
            />
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {totalEntries > 0 ? "Your memory is active" : "Start capturing memories"}
          </p>
        </div>
      </div>
      
      {/* Entries Streak Card */}
      <div className="rounded-2xl glass-card p-4 relative overflow-hidden">
        <div className="relative">
          <p className="text-xs text-muted-foreground mb-1">Entry Streak</p>
          <div className="flex items-baseline gap-1">
            <span className="text-3xl font-bold text-foreground">{totalEntries}</span>
            <span className="text-sm text-muted-foreground">/30</span>
          </div>
          <div className="mt-3 flex gap-0.5">
            {Array.from({ length: 10 }).map((_, i) => (
              <div 
                key={i} 
                className={cn(
                  "h-4 w-1.5 rounded-sm transition-colors",
                  i < totalEntries ? "bg-foreground" : "bg-secondary"
                )}
              />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {isProcessing ? "Processing..." : "Keep the streak going"}
          </p>
        </div>
      </div>
    </div>
  );
}
