"use client";

import { Activity, Brain, Database, Clock } from "lucide-react";

interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  count?: number;
  icon?: "activity" | "brain" | "database" | "clock";
}

export function SectionHeader({ title, subtitle, count, icon = "activity" }: SectionHeaderProps) {
  const Icon = {
    activity: Activity,
    brain: Brain,
    database: Database,
    clock: Clock,
  }[icon];

  return (
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 border border-primary/20">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {count !== undefined && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {count}
              </span>
            )}
          </div>
          {subtitle && (
            <span className="text-xs text-muted-foreground">{subtitle}</span>
          )}
        </div>
      </div>
      <div className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
    </div>
  );
}
