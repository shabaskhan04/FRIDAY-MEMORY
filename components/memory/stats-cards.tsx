"use client";

import { Brain, Clock, Users, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatsCardsProps {
  totalEntries: number;
  isRecording?: boolean;
  isProcessing?: boolean;
}

const stats = [
  {
    id: "entries",
    label: "Raw Entries",
    icon: Brain,
    color: "text-primary",
    bgColor: "bg-primary/10",
    borderColor: "border-primary/20",
  },
  {
    id: "temporal",
    label: "Temporal Events",
    icon: Clock,
    color: "text-blue-400",
    bgColor: "bg-blue-400/10",
    borderColor: "border-blue-400/20",
  },
  {
    id: "entities",
    label: "Entities Tracked",
    icon: Users,
    color: "text-emerald-400",
    bgColor: "bg-emerald-400/10",
    borderColor: "border-emerald-400/20",
  },
  {
    id: "processing",
    label: "AI Processing",
    icon: Sparkles,
    color: "text-purple-400",
    bgColor: "bg-purple-400/10",
    borderColor: "border-purple-400/20",
  },
];

export function StatsCards({ totalEntries, isRecording, isProcessing }: StatsCardsProps) {
  const getStatValue = (id: string) => {
    switch (id) {
      case "entries":
        return totalEntries;
      case "temporal":
        return "—";
      case "entities":
        return "—";
      case "processing":
        return isProcessing ? "Active" : isRecording ? "Listening" : "Ready";
      default:
        return "—";
    }
  };

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {stats.map((stat) => (
        <Card
          key={stat.id}
          className={cn(
            "relative overflow-hidden border-border/50 bg-card/30 backdrop-blur-sm p-4 transition-all duration-300 hover:border-border",
            stat.id === "processing" && isProcessing && "border-purple-400/30"
          )}
        >
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted-foreground font-medium">
                {stat.label}
              </span>
              <span className={cn("text-xl font-bold", stat.color)}>
                {getStatValue(stat.id)}
              </span>
            </div>
            <div
              className={cn(
                "flex h-9 w-9 items-center justify-center rounded-lg border",
                stat.bgColor,
                stat.borderColor
              )}
            >
              <stat.icon className={cn("h-4 w-4", stat.color)} />
            </div>
          </div>
          
          {stat.id === "processing" && isProcessing && (
            <div className="absolute bottom-0 left-0 right-0 h-0.5 overflow-hidden">
              <div className="h-full w-full bg-gradient-to-r from-transparent via-purple-400 to-transparent animate-shimmer" />
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
