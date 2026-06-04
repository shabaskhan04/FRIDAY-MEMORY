"use client";

import { Home, Brain, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface BottomNavProps {
  activeTab: "home" | "memory" | "insights";
  onTabChange: (tab: "home" | "memory" | "insights") => void;
}

const tabs = [
  { id: "home" as const, label: "Home", icon: Home },
  { id: "memory" as const, label: "Memory", icon: Brain },
  { id: "insights" as const, label: "Insights", icon: Sparkles },
];

export function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-t border-border">
      <div className="mx-auto max-w-lg">
        <div className="flex items-center justify-around py-2">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  "flex flex-col items-center gap-1 px-6 py-2 rounded-xl transition-all duration-200",
                  isActive 
                    ? "text-primary" 
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <div className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-full transition-all duration-200",
                  isActive && "bg-primary/10"
                )}>
                  <tab.icon className={cn(
                    "h-5 w-5 transition-transform duration-200",
                    isActive && "scale-110"
                  )} />
                </div>
                <span className="text-[11px] font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      {/* Safe area for iOS */}
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
