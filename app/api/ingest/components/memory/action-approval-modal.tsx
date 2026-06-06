"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import {
  Mail,
  Calendar,
  CheckSquare,
  X,
  Check,
  Loader2,
  AlertCircle,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────

type ToolName = "gmail_send" | "calendar_insert" | "tasks_insert";

interface PendingCommand {
  id: string;
  tool_name: ToolName;
  payload: Record<string, string>;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────

const TOOL_META: Record<ToolName, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  gmail_send:      { label: "Send Email",    icon: Mail,        color: "text-amber-400",   bg: "bg-amber-500/10"   },
  calendar_insert: { label: "Add Event",     icon: Calendar,    color: "text-blue-400",    bg: "bg-blue-500/10"    },
  tasks_insert:    { label: "Create Task",   icon: CheckSquare, color: "text-emerald-400", bg: "bg-emerald-500/10" },
};

function PayloadPreview({ tool, payload }: { tool: ToolName; payload: Record<string, string> }) {
  if (tool === "gmail_send") return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p><span className="font-medium text-foreground">To:</span> {payload.to}</p>
      {payload.cc && <p><span className="font-medium text-foreground">Cc:</span> {payload.cc}</p>}
      <p><span className="font-medium text-foreground">Subject:</span> {payload.subject}</p>
      <p className="line-clamp-3 mt-1 rounded-md bg-secondary/50 p-2 leading-relaxed">{payload.body}</p>
    </div>
  );

  if (tool === "calendar_insert") return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p><span className="font-medium text-foreground">Event:</span> {payload.title}</p>
      <p><span className="font-medium text-foreground">Start:</span> {new Date(payload.startTime).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
      {payload.endTime && <p><span className="font-medium text-foreground">End:</span> {new Date(payload.endTime).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>}
      {payload.location && <p><span className="font-medium text-foreground">Location:</span> {payload.location}</p>}
      {payload.description && <p className="line-clamp-2 mt-1 rounded-md bg-secondary/50 p-2">{payload.description}</p>}
    </div>
  );

  if (tool === "tasks_insert") return (
    <div className="space-y-1 text-xs text-muted-foreground">
      <p><span className="font-medium text-foreground">Task:</span> {payload.title}</p>
      {payload.dueDate && <p><span className="font-medium text-foreground">Due:</span> {new Date(payload.dueDate).toLocaleDateString("en-IN")}</p>}
      {payload.notes && <p className="line-clamp-2 mt-1 rounded-md bg-secondary/50 p-2">{payload.notes}</p>}
    </div>
  );

  return null;
}

// ── Modal Card ────────────────────────────────────────────────

function CommandCard({
  cmd,
  onDone,
}: {
  cmd: PendingCommand;
  onDone: (id: string) => void;
}) {
  const [state, setState] = useState<"idle" | "executing" | "denying" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const meta = TOOL_META[cmd.tool_name] ?? TOOL_META.tasks_insert;
  const Icon = meta.icon;

  const execute = async () => {
    setState("executing");
    try {
      const res = await fetch(`/api/commands/execute/${cmd.id}`, { method: "POST" });
      const data = (await res.json()) as { executed?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Execution failed.");
      setState("done");
      setTimeout(() => onDone(cmd.id), 800);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unknown error.");
      setState("error");
    }
  };

  const deny = async () => {
    setState("denying");
    try {
      await fetch(`/api/commands/deny/${cmd.id}`, { method: "POST" });
      setState("done");
      setTimeout(() => onDone(cmd.id), 400);
    } catch {
      setState("idle");
    }
  };

  return (
    <div className={cn(
      "rounded-2xl border border-border/60 bg-card p-4 shadow-lg transition-all duration-300",
      state === "done" && "scale-95 opacity-0",
    )}>
      {/* Header */}
      <div className="mb-3 flex items-center gap-2.5">
        <span className={cn("flex h-7 w-7 items-center justify-center rounded-xl", meta.bg)}>
          <Icon className={cn("h-3.5 w-3.5", meta.color)} />
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">{meta.label}</p>
          <p className="text-[10px] text-muted-foreground">
            {new Date(cmd.created_at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          </p>
        </div>
      </div>

      {/* Payload */}
      <div className="mb-4">
        <PayloadPreview tool={cmd.tool_name} payload={cmd.payload} />
      </div>

      {/* Error */}
      {state === "error" && errorMsg && (
        <div className="mb-3 flex items-start gap-2 rounded-xl bg-destructive/10 p-2.5 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={deny}
          disabled={state !== "idle" && state !== "error"}
          className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-border/60 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/60 disabled:opacity-40"
        >
          {state === "denying" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          Deny
        </button>
        <button
          onClick={execute}
          disabled={state !== "idle" && state !== "error"}
          className={cn(
            "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl text-xs font-semibold text-white transition-colors disabled:opacity-40",
            meta.bg.replace("/10", "/80"), "hover:opacity-90",
            cmd.tool_name === "gmail_send"      && "bg-amber-500",
            cmd.tool_name === "calendar_insert" && "bg-blue-500",
            cmd.tool_name === "tasks_insert"    && "bg-emerald-500",
          )}
        >
          {state === "executing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {state === "error" ? "Retry" : "Approve"}
        </button>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────

export function ActionApprovalModal() {
  const [commands, setCommands] = useState<PendingCommand[]>([]);

  const dismissCommand = useCallback((id: string) => {
    setCommands((prev) => prev.filter((c) => c.id !== id));
  }, []);

  useEffect(() => {
    const supabase = createClient();

    // Subscribe to new pending commands via realtime
    const channel = supabase
      .channel("pending-commands")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "pending_commands", filter: "status=eq.pending" },
        (payload) => {
          const newCmd = payload.new as PendingCommand;
          setCommands((prev) => {
            if (prev.some((c) => c.id === newCmd.id)) return prev;
            return [newCmd, ...prev];
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  if (commands.length === 0) return null;

  return (
    <div className="fixed bottom-24 right-4 z-50 flex w-80 flex-col gap-3 sm:bottom-6 sm:right-6">
      {commands.map((cmd) => (
        <CommandCard key={cmd.id} cmd={cmd} onDone={dismissCommand} />
      ))}
    </div>
  );
}
