"use client";

import { Home, Brain, Sparkles, Users, CheckSquare, Heart } from "lucide-react";
import { cn } from "@/lib/utils";

type TabId = "home" | "memory" | "people" | "todos" | "insights" | "health";

interface BottomNavProps {
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  hasTodos?: boolean;
  pendingTodoCount?: number;
}

export function BottomNav({
  activeTab,
  onTabChange,
  hasTodos = false,
  pendingTodoCount = 0,
}: BottomNavProps) {
  const baseTabs = [
    { id: "home"     as const, label: "Home",    icon: Home },
    { id: "memory"   as const, label: "Memory",  icon: Brain },
    { id: "people"   as const, label: "People",  icon: Users },
    { id: "health"   as const, label: "Health",  icon: Heart },
    { id: "insights" as const, label: "Insights",icon: Sparkles },
  ];

  const allTabs = hasTodos
    ? [
        baseTabs[0],
        baseTabs[1],
        baseTabs[2],
        { id: "todos" as const, label: "To-Do", icon: CheckSquare },
        baseTabs[3],
        baseTabs[4],
      ]
    : baseTabs;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-background/80 backdrop-blur-xl border-t border-border">
      <div className="mx-auto max-w-lg">
        <div className="flex items-center justify-around py-2">
          {allTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            const isTodo = tab.id === "todos";
            return (
              <button
                key={tab.id}
                onClick={() => onTabChange(tab.id)}
                className={cn(
                  "flex flex-col items-center gap-1 px-3 py-2 rounded-xl transition-all duration-200 relative",
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}
              >
                <div className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 relative",
                  isActive && "bg-primary/10"
                )}>
                  <tab.icon className={cn("h-5 w-5 transition-transform duration-200", isActive && "scale-110")} />
                  {isTodo && pendingTodoCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-white">
                      {pendingTodoCount > 9 ? "9+" : pendingTodoCount}
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-medium">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="h-[env(safe-area-inset-bottom)]" />
    </nav>
  );
}
