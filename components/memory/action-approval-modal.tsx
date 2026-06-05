"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Calendar,
  Mail,
  CheckSquare,
  CheckCircle2,
  XCircle,
  Loader2,
  ShieldAlert,
  ExternalLink,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase";

// ── Types ─────────────────────────────────────────────────────

interface PendingCommand {
  id: string;
  tool_name: "calendar_insert" | "gmail_send" | "tasks_insert";
  payload: Record<string, string | null | undefined>;
  status: "pending" | "approved" | "denied" | "executed" | "failed";
  created_at: string;
  error_message?: string | null;
}

type ActionState = "idle" | "loading" | "success" | "error";

// ── Tool config ───────────────────────────────────────────────

const TOOL_META: Record<
  PendingCommand["tool_name"],
  { icon: React.ElementType; label: string; color: string; bg: string; border: string }
> = {
  calendar_insert: {
    icon: Calendar,
    label: "Add to Calendar",
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
  },
  gmail_send: {
    icon: Mail,
    label: "Send Email",
    color: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
  },
  tasks_insert: {
    icon: CheckSquare,
    label: "Add Task",
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
};

// ── Human-readable summary ────────────────────────────────────

function buildSummary(cmd: PendingCommand): string {
  const p = cmd.payload;
  switch (cmd.tool_name) {
    case "calendar_insert": {
      const when = p.startTime
        ? new Date(p.startTime).toLocaleString("en-IN", {
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          })
        : "unknown time";
      return `"${p.title}" on ${when}${p.location ? ` · ${p.location}` : ""}`;
    }
    case "gmail_send":
      return `To: ${p.to} · Subject: "${p.subject}"`;
    case "tasks_insert": {
      const due = p.dueDate
        ? ` (due ${new Date(p.dueDate).toLocaleDateString("en-IN", { month: "short", day: "numeric" })})`
        : "";
      return `"${p.title}"${due}`;
    }
  }
}

// ── Single command card ───────────────────────────────────────

function CommandCard({
  cmd,
  onApprove,
  onDeny,
}: {
  cmd: PendingCommand;
  onApprove: (id: string) => Promise<void>;
  onDeny: (id: string) => Promise<void>;
}) {
  const [approveState, setApproveState] = useState<ActionState>("idle");
  const [denyState, setDenyState] = useState<ActionState>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const meta = TOOL_META[cmd.tool_name];
  const Icon = meta.icon;

  const handleApprove = async () => {
    setApproveState("loading");
    setErrMsg(null);
    try {
      await onApprove(cmd.id);
      setApproveState("success");
    } catch (e) {
      setApproveState("error");
      setErrMsg(e instanceof Error ? e.message : "Failed to execute");
    }
  };

  const handleDeny = async () => {
    setDenyState("loading");
    try {
      await onDeny(cmd.id);
      setDenyState("success");
    } catch {
      setDenyState("idle");
    }
  };

  const done = approveState === "success" || denyState === "success";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: done ? 0.4 : 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
      className={cn(
        "rounded-2xl border p-4 transition-all",
        meta.bg,
        meta.border
      )}
    >
      {/* Header row */}
      <div className="flex items-start gap-3 mb-3">
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", meta.bg)}>
          <Icon className={cn("h-4 w-4", meta.color)} />
        </div>
        <div className="flex-1 min-w-0">
          <p className={cn("text-[11px] font-semibold uppercase tracking-wider mb-0.5", meta.color)}>
            {meta.label}
          </p>
          <p className="text-sm text-foreground leading-snug">{buildSummary(cmd)}</p>
        </div>
      </div>

      {/* Description / notes if present */}
      {(cmd.payload.description || cmd.payload.notes || cmd.payload.body) && (
        <p className="text-xs text-muted-foreground mb-3 pl-12 leading-relaxed line-clamp-2">
          {cmd.payload.description ?? cmd.payload.notes ?? cmd.payload.body}
        </p>
      )}

      {/* Error */}
      {errMsg && (
        <div className="flex items-start gap-2 rounded-xl bg-destructive/10 border border-destructive/20 p-3 mb-3">
          <ShieldAlert className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive leading-relaxed">{errMsg}</p>
        </div>
      )}

      {/* Actions */}
      {!done && (
        <div className="flex gap-2 pl-0">
          {/* Approve */}
          <button
            onClick={() => void handleApprove()}
            disabled={approveState === "loading" || denyState === "loading"}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-all duration-200",
              "bg-emerald-500 text-white hover:bg-emerald-400 active:scale-[0.97]",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {approveState === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {approveState === "loading" ? "Running…" : "Approve"}
          </button>

          {/* Deny */}
          <button
            onClick={() => void handleDeny()}
            disabled={approveState === "loading" || denyState === "loading"}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200",
              "bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/70 active:scale-[0.97]",
              "disabled:opacity-50 disabled:cursor-not-allowed"
            )}
          >
            {denyState === "loading" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <XCircle className="h-3.5 w-3.5" />
            )}
            Deny
          </button>
        </div>
      )}

      {/* Done states */}
      {approveState === "success" && (
        <div className="flex items-center gap-2 text-emerald-400 text-sm pl-1">
          <CheckCircle2 className="h-4 w-4" />
          Done — action sent to Google
        </div>
      )}
      {denyState === "success" && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm pl-1">
          <XCircle className="h-4 w-4" />
          Denied
        </div>
      )}
    </motion.div>
  );
}

// ── Main modal ────────────────────────────────────────────────

export function ActionApprovalModal() {
  const [commands, setCommands] = useState<PendingCommand[]>([]);
  const [open, setOpen] = useState(false);
  const supabaseRef = useRef(createClient());

  // ── Initial fetch of any already-pending commands ─────────
  useEffect(() => {
    const fetchPending = async () => {
      const { data } = await supabaseRef.current
        .from("pending_commands")
        .select("id, tool_name, payload, status, created_at, error_message")
        .eq("status", "pending")
        .order("created_at", { ascending: true });

      if (data && data.length > 0) {
        setCommands(data as PendingCommand[]);
        setOpen(true);
      }
    };
    void fetchPending();
  }, []);

  // ── Realtime subscription for new pending commands ────────
  useEffect(() => {
    const channel = supabaseRef.current
      .channel("pending-commands-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "pending_commands",
          filter: "status=eq.pending",
        },
        (payload) => {
          const newCmd = payload.new as PendingCommand;
          setCommands((prev) => {
            if (prev.find((c) => c.id === newCmd.id)) return prev;
            return [...prev, newCmd];
          });
          setOpen(true);
        }
      )
      .subscribe();

    return () => {
      void supabaseRef.current.removeChannel(channel);
    };
  }, []);

  // ── Auto-close when all commands are handled ──────────────
  useEffect(() => {
    if (commands.length > 0) {
      const allDone = commands.every(
        (c) => c.status === "executed" || c.status === "denied" || c.status === "failed"
      );
      if (allDone) {
        const t = setTimeout(() => {
          setOpen(false);
          setTimeout(() => setCommands([]), 400);
        }, 1200);
        return () => clearTimeout(t);
      }
    }
  }, [commands]);

  // ── Handlers ─────────────────────────────────────────────
  const handleApprove = useCallback(async (id: string) => {
    const res = await fetch(`/api/commands/execute/${id}`, { method: "POST" });
    if (!res.ok) {
      const data = (await res.json()) as { error?: string };
      throw new Error(data.error ?? "Execution failed");
    }
    setCommands((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: "executed" } : c))
    );
  }, []);

  const handleDeny = useCallback(async (id: string) => {
    const res = await fetch(`/api/commands/deny/${id}`, { method: "POST" });
    if (!res.ok) throw new Error("Deny failed");
    setCommands((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: "denied" } : c))
    );
  }, []);

  const pendingOnly = commands.filter((c) => c.status === "pending");

  return (
    <AnimatePresence>
      {open && commands.length > 0 && (
        <>
          {/* Backdrop */}
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-background/60 backdrop-blur-sm"
            onClick={() => pendingOnly.length === 0 && setOpen(false)}
          />

          {/* Sheet */}
          <motion.div
            key="sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="fixed bottom-0 left-0 right-0 z-[201] mx-auto max-w-lg"
          >
            <div className="rounded-t-3xl glass-card border border-border/50 flex flex-col max-h-[80vh]">
              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
                <div>
                  <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                    <ShieldAlert className="h-4 w-4 text-primary" />
                    Friday wants to act
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {pendingOnly.length} action{pendingOnly.length !== 1 ? "s" : ""} awaiting your approval
                  </p>
                </div>

                {/* Close only when nothing is pending */}
                {pendingOnly.length === 0 && (
                  <button
                    onClick={() => setOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>

              {/* Drag handle */}
              <div className="flex justify-center pb-1 shrink-0">
                <div className="h-1 w-10 rounded-full bg-border/60" />
              </div>

              {/* Commands list */}
              <div className="overflow-y-auto flex-1 px-5 pb-6 space-y-3">
                <AnimatePresence initial={false}>
                  {commands.map((cmd) => (
                    <CommandCard
                      key={cmd.id}
                      cmd={cmd}
                      onApprove={handleApprove}
                      onDeny={handleDeny}
                    />
                  ))}
                </AnimatePresence>

                {pendingOnly.length === 0 && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="flex flex-col items-center py-4 gap-2"
                  >
                    <CheckCircle2 className="h-8 w-8 text-emerald-400" />
                    <p className="text-sm text-muted-foreground">All actions handled</p>
                  </motion.div>
                )}

                {/* Google link */}
                <div className="flex justify-center pt-1">
                  <a
                    href="https://myaccount.google.com/permissions"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Manage Google permissions
                  </a>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
