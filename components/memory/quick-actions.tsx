"use client";

import { FileText, BarChart3, Lightbulb, Calendar } from "lucide-react";

interface QuickActionsProps {
  onAction: (action: string, prefill?: string) => void;
}

const actions = [
  {
    id: "note",
    label: "Quick Note",
    icon: FileText,
    prefill: "Quick note: ",
  },
  {
    id: "analyze",
    label: "Analyze",
    icon: BarChart3,
    prefill: undefined,
  },
  {
    id: "ideas",
    label: "Ideas",
    icon: Lightbulb,
    prefill: "I have an idea: ",
  },
  {
    id: "schedule",
    label: "Schedule",
    icon: Calendar,
    prefill: "I need to schedule ",
  },
];

export function QuickActions({ onAction }: QuickActionsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 scrollbar-hide">
      {actions.map((action) => (
        <button
          key={action.id}
          onClick={() => onAction(action.id, action.prefill)}
          className="flex shrink-0 items-center gap-2 rounded-full border border-border bg-secondary/50 px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground active:scale-95"
        >
          <action.icon className="h-4 w-4" />
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  );
}
