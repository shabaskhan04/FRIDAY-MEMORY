"use client";

import { Brain, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeaderProps {
  isOnline?: boolean;
}

export function Header({ isOnline = true }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20">
            <Brain className="h-5 w-5 text-primary" />
            <div className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary animate-pulse" />
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-[0.3em] text-primary">
              Friday
            </span>
            <span className="text-sm font-semibold text-foreground">
              Memory Protocol
            </span>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium",
              isOnline
                ? "bg-success/10 text-success border border-success/20"
                : "bg-destructive/10 text-destructive border border-destructive/20"
            )}
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isOnline ? "bg-success animate-pulse" : "bg-destructive"
              )}
            />
            <span className="hidden sm:inline">
              {isOnline ? "System Online" : "Offline"}
            </span>
            <Zap className="h-3 w-3 sm:hidden" />
          </div>
        </div>
      </div>
    </header>
  );
}
