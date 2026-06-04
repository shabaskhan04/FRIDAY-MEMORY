"use client";

import { Settings, Bell } from "lucide-react";
import { cn } from "@/lib/utils";

interface HeaderProps {
  isOnline?: boolean;
}

export function Header({ isOnline = true }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 w-full bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
        <div className="flex items-center gap-2">
          <span className="text-lg font-semibold text-foreground">Friday</span>
          <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary">
            BETA
          </span>
        </div>
        
        <div className="flex items-center gap-1">
          <div
            className={cn(
              "mr-2 flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-medium",
              isOnline
                ? "bg-success/10 text-success"
                : "bg-destructive/10 text-destructive"
            )}
          >
            <span className={cn(
              "h-1.5 w-1.5 rounded-full",
              isOnline ? "bg-success animate-pulse-soft" : "bg-destructive"
            )} />
            {isOnline ? "Online" : "Offline"}
          </div>
          
          <button className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
            <Bell className="h-5 w-5" />
          </button>
          <button className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
            <Settings className="h-5 w-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
