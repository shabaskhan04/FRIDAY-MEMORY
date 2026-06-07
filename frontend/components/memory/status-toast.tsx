"use client";

import { CheckCircle2, AlertCircle, AlertTriangle, X, CheckSquare, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface StatusMessage {
  type: "success" | "error" | "warning";
  text: string;
  temporalCount?: number;
  entityCount?: number;
  taskCount?: number;
  intentTag?: string;
}

interface StatusToastProps {
  status: StatusMessage;
  onDismiss: () => void;
}

const intentLabels: Record<string, string> = {
  standard: "📝 Standard",
  spark: "⚡ Spark",
  friction: "🔥 Friction",
};

export function StatusToast({ status, onDismiss }: StatusToastProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onDismiss, 300);
    }, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const colors = {
    success: {
      border: "border-success/30",
      bg: "bg-success/10",
      text: "text-success",
    },
    error: {
      border: "border-destructive/30",
      bg: "bg-destructive/10",
      text: "text-destructive",
    },
    warning: {
      border: "border-warning/30",
      bg: "bg-warning/10",
      text: "text-warning",
    },
  };

  const style = colors[status.type];

  const icons = {
    success: CheckCircle2,
    error: AlertCircle,
    warning: AlertTriangle,
  };

  const Icon = icons[status.type];

  return (
    <div
      className={cn(
        "fixed bottom-24 left-4 right-4 z-50 mx-auto max-w-lg transition-all duration-300 ease-out",
        isVisible ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0"
      )}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border p-4 backdrop-blur-xl",
          style.border,
          style.bg
        )}
      >
        <div className="flex items-start gap-3">
          <div className={cn("rounded-full p-1", style.bg)}>
            <Icon className={cn("h-5 w-5", style.text)} />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">{status.text}</p>

            {/* Intent tag */}
            {status.intentTag && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {intentLabels[status.intentTag] ?? status.intentTag}
              </p>
            )}

            {/* Extracted details */}
            {status.type === "success" &&
              (status.temporalCount !== undefined ||
                status.entityCount !== undefined ||
                status.taskCount !== undefined) && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {(status.temporalCount ?? 0) > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                      🕐 {status.temporalCount} events
                    </span>
                  )}
                  {(status.entityCount ?? 0) > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-[10px] text-warning">
                      <Users className="h-3 w-3" />
                      {status.entityCount} people
                    </span>
                  )}
                  {(status.taskCount ?? 0) > 0 && (
                    <span className="flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10px] text-success">
                      <CheckSquare className="h-3 w-3" />
                      {status.taskCount} task{(status.taskCount ?? 0) > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              )}
          </div>

          <button
            onClick={() => {
              setIsVisible(false);
              setTimeout(onDismiss, 300);
            }}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
