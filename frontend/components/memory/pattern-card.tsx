"use client";

import { useState, useEffect } from "react";
import { GitBranch, ArrowRight, Loader2, Sparkles } from "lucide-react";
import { getCausalPatterns, type CausalPattern } from "@/lib/api-client";

export function PatternCard() {
  const [patterns, setPatterns] = useState<CausalPattern[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchPatterns = async () => {
      try {
        const data = await getCausalPatterns();
        setPatterns(data);
      } catch (err) {
        console.error("Failed to fetch causal patterns:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchPatterns();
  }, []);

  if (isLoading) {
    return (
      <div className="flex justify-center p-8 glass-card rounded-2xl">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (!patterns || !patterns.length) {
    return (
      <div className="rounded-2xl glass-card p-6 text-center space-y-2">
        <GitBranch className="h-8 w-8 mx-auto text-muted-foreground/45" />
        <p className="text-sm text-muted-foreground">No patterns discovered yet. Keep logging memories.</p>
        <p className="text-xs text-muted-foreground/60">Patterns form as decisions are evaluated and repetitive sequences are detected.</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl glass-card p-4 space-y-4">
      {/* Title */}
      <div className="flex items-center justify-between border-b border-border/40 pb-2">
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Causal Discoveries</h3>
        </div>
        <span className="text-[10px] text-muted-foreground font-medium bg-secondary/50 px-2 py-0.5 rounded-full">
          {patterns.length} Rules
        </span>
      </div>

      {/* List */}
      <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1 scrollbar-thin">
        {patterns.map((pattern) => {
          const pct = Math.round(pattern.confidence * 100);

          return (
            <div
              key={pattern.id}
              className="rounded-xl bg-secondary/20 border border-border/10 p-3 hover:bg-secondary/35 transition-colors"
            >
              {/* Top Details */}
              <div className="flex items-center justify-between mb-2">
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider bg-primary/10 text-primary">
                  {pattern.pattern_type?.replace("_", " ")}
                </span>
                <span className="text-[10px] text-muted-foreground font-medium">
                  {pattern.occurrence_count} occurrences
                </span>
              </div>

              {/* Relationship Flow */}
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-xs font-semibold text-foreground bg-secondary/60 px-2 py-1 rounded-md border border-border/10 truncate max-w-[120px]">
                  {pattern.cause_label}
                </span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" />
                <span className="text-xs font-semibold text-foreground bg-secondary/60 px-2 py-1 rounded-md border border-border/10 truncate max-w-[120px]">
                  {pattern.effect_label}
                </span>
              </div>

              {/* Description & Confidence */}
              <div className="flex items-start justify-between gap-4 mt-2.5 pt-2 border-t border-border/5 text-xs">
                <p className="text-muted-foreground leading-normal italic text-[11px] flex-1">
                  &quot;{pattern.description}&quot;
                </p>
                <div className="flex flex-col items-end shrink-0">
                  <div className="flex items-center gap-0.5 text-primary font-bold">
                    <Sparkles className="h-3 w-3 fill-current text-primary" />
                    <span>{pct}%</span>
                  </div>
                  <span className="text-[9px] text-muted-foreground/60">confidence</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
