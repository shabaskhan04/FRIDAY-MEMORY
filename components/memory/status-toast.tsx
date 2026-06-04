"use client";

import { CheckCircle2, AlertCircle, AlertTriangle, X, Sparkles, Users } from "lucide-react";
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
    }, 5000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const colors = {
    success: {
      border: "border-success/30",
      bg: "bg-success/10",
      icon: "bg-success/20 text-success",
      text: "text-success",
    },
    error: {
      border: "border-destructive/30",
      bg: "bg-destructive/10",
      icon: "bg-destructive/20 text-destructive",
      text: "text-destructive",
    },
    warning: {
      border: "border-warning/30",
      bg: "bg-warning/10",
      icon: "bg-warning/20 text-warning",
      text: "text-warning",
    },
  };

  const style = colors[status.type];

  const titles = {
    success: "Memory Committed",
    error: "Error",
    warning: "Warning",
  };

  const icons = {
    success: CheckCircle2,
    error: AlertCircle,
    warning: AlertTriangle,
  };

  const Icon = icons[status.type];

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-50 max-w-md transition-all duration-300 ease-out",
        isVisible
          ? "translate-y-0 opacity-100"
          : "translate-y-4 opacity-0"
      )}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border p-4 shadow-2xl backdrop-blur-xl",
          style.border,
          style.bg
        )}
      >
        <button
          onClick={() => {
            setIsVisible(false);
            setTimeout(onDismiss, 300);
          }}
          className="absolute right-3 top-3 rounded-full p-1 transition-colors hover:bg-background/20"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
        
        <div className="flex gap-3">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
              style.icon
            )}
          >
            <Icon className="h-5 w-5" />
          </div>
          
          <div className="flex flex-col gap-1 pr-6">
            <span className={cn("text-sm font-semibold", style.text)}>
              {titles[status.type]}
            </span>
            <span className="text-sm text-muted-foreground">
              {status.text}
            </span>
            
            {status.type === "success" && (status.temporalCount || status.entityCount) && (
              <div className="mt-2 flex gap-3">
                {status.temporalCount !== undefined && status.temporalCount > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                    <span>{status.temporalCount} temporal event{status.temporalCount !== 1 ? "s" : ""}</span>
                  </div>
                )}
                {status.entityCount !== undefined && status.entityCount > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Users className="h-3.5 w-3.5 text-primary" />
                    <span>{status.entityCount} entit{status.entityCount !== 1 ? "ies" : "y"}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        
        {/* Progress bar for auto-dismiss */}
        <div className="absolute bottom-0 left-0 right-0 h-1 overflow-hidden bg-background/20">
          <div
            className={cn(
              "h-full",
              status.type === "success" ? "bg-success" : status.type === "warning" ? "bg-warning" : "bg-destructive"
            )}
            style={{
              animation: "shrink 5s linear forwards",
            }}
          />
        </div>
      </div>
      
      <style jsx>{`
        @keyframes shrink {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
}
