"use client";

import { CheckCircle2, AlertCircle, AlertTriangle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

interface StatusMessage {
  type: "success" | "error" | "warning";
  text: string;
  temporalCount?: number;
  entityCount?: number;
}

interface StatusToastProps {
  status: StatusMessage;
  onDismiss: () => void;
}

export function StatusToast({ status, onDismiss }: StatusToastProps) {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
    const timer = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onDismiss, 300);
    }, 4000);
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
        isVisible
          ? "translate-y-0 opacity-100"
          : "translate-y-4 opacity-0"
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
            
            {status.type === "success" && (status.temporalCount !== undefined || status.entityCount !== undefined) && (
              <p className="mt-1 text-xs text-muted-foreground">
                {status.temporalCount} temporal, {status.entityCount} entities
              </p>
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
