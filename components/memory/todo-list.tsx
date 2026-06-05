"use client";

import { useState, useCallback, useEffect } from "react";
import {
  CheckSquare, Square, Loader2, ListTodo, AlertCircle, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ── Google Tasks icon (inline SVG — no extra dep) ─────────────

function GoogleTasksIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="24" height="24" rx="4" fill="#1A73E8" />
      <path
        d="M12 6.5L13.5 9.5H16.5L14.25 11.5L15 14.5L12 12.75L9 14.5L9.75 11.5L7.5 9.5H10.5L12 6.5Z"
        fill="white"
      />
    </svg>
  );
}

// ── Types ─────────────────────────────────────────────────────

interface TodoTask {
  id: string;
  raw_ledger_id: string;
  task_description: string;
  status: "pending" | "done";
  created_at: string;
  source?: "friday" | "google_tasks";
  google_task_id?: string | null;
  google_list_id?: string | null;
}

interface TodoListProps {
  todos: TodoTask[];
  onTodoToggle: (id: string, newStatus: "pending" | "done") => Promise<void>;
}

// ── TodoList ──────────────────────────────────────────────────

export function TodoList({ todos: propTodos, onTodoToggle }: TodoListProps) {
  const [todos, setTodos] = useState<TodoTask[]>(propTodos);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [errorIds, setErrorIds] = useState<Map<string, string>>(new Map());
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setTodos(propTodos);
  }, [propTodos]);

  const handleToggle = useCallback(
    async (todo: TodoTask) => {
      if (loadingIds.has(todo.id) || removingIds.has(todo.id)) return;
      if (todo.status !== "pending") return;

      setLoadingIds((prev) => new Set(prev).add(todo.id));
      setErrorIds((prev) => { const m = new Map(prev); m.delete(todo.id); return m; });

      try {
        const { createClient } = await import("@/lib/supabase");
        const supabase = createClient();
        const { error } = await supabase
          .from("todo_tasks")
          .update({ status: "done" })
          .eq("id", todo.id);

        if (error) throw new Error(error.message);

        await onTodoToggle(todo.id, "done");

        setLoadingIds((prev) => { const n = new Set(prev); n.delete(todo.id); return n; });
        setRemovingIds((prev) => new Set(prev).add(todo.id));
        setTimeout(() => {
          setTodos((prev) => prev.filter((t) => t.id !== todo.id));
          setRemovingIds((prev) => { const n = new Set(prev); n.delete(todo.id); return n; });
        }, 420);
      } catch (err) {
        setLoadingIds((prev) => { const n = new Set(prev); n.delete(todo.id); return n; });
        setErrorIds((prev) =>
          new Map(prev).set(todo.id, err instanceof Error ? err.message : "Update failed")
        );
      }
    },
    [loadingIds, removingIds, onTodoToggle]
  );

  const pending = todos.filter((t) => t.status === "pending");

  if (pending.length === 0 && removingIds.size === 0) {
    return (
      <div className="rounded-2xl glass-card p-8 text-center">
        <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
          <ListTodo className="h-6 w-6 text-primary" />
        </div>
        <p className="text-sm font-medium text-foreground">All caught up!</p>
        <p className="mt-1 text-xs text-muted-foreground">
          No tasks yet — mention something you need to do
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {todos
        .filter((t) => t.status === "pending" || removingIds.has(t.id))
        .map((todo, i) => (
          <TodoItem
            key={todo.id}
            todo={todo}
            isLoading={loadingIds.has(todo.id)}
            isRemoving={removingIds.has(todo.id)}
            errorMsg={errorIds.get(todo.id)}
            onToggle={handleToggle}
            animDelay={i * 40}
          />
        ))}
    </div>
  );
}

// ── TodoItem ──────────────────────────────────────────────────

function TodoItem({
  todo,
  isLoading,
  isRemoving,
  errorMsg,
  onToggle,
  animDelay,
}: {
  todo: TodoTask;
  isLoading: boolean;
  isRemoving: boolean;
  errorMsg?: string;
  onToggle: (todo: TodoTask) => void;
  animDelay: number;
}) {
  const isGoogleTask = todo.source === "google_tasks";

  const getRelativeTime = (iso: string): string => {
    const now = new Date();
    const d = new Date(iso);
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  return (
    <div
      className={cn(
        "rounded-2xl glass-card p-4 transition-all duration-300 animate-fade-up",
        isRemoving && "animate-fade-out-shrink",
        errorMsg && "ring-1 ring-destructive/40"
      )}
      style={{ animationDelay: isRemoving ? "0ms" : `${animDelay}ms` }}
    >
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => onToggle(todo)}
          disabled={isLoading || isRemoving}
          aria-label="Mark as done"
          className={cn(
            "mt-0.5 shrink-0 rounded-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/40 text-muted-foreground hover:text-primary",
            (isLoading || isRemoving) && "cursor-not-allowed opacity-50"
          )}
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : errorMsg ? (
            <AlertCircle className="h-5 w-5 text-destructive" />
          ) : isRemoving ? (
            <CheckSquare className="h-5 w-5 text-success" />
          ) : (
            <Square className="h-5 w-5" />
          )}
        </button>

        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground leading-relaxed">
            {todo.task_description}
          </p>
          <div className="mt-0.5 flex items-center gap-2 flex-wrap">
            <p className="text-[11px] text-muted-foreground">
              {getRelativeTime(todo.created_at)}
              {errorMsg && (
                <span className="ml-2 text-destructive">· {errorMsg}</span>
              )}
            </p>

            {/* Google Tasks badge */}
            {isGoogleTask && (
              <span className="flex items-center gap-1 rounded-full bg-blue-500/10 border border-blue-500/20 px-1.5 py-0.5">
                <GoogleTasksIcon className="h-3 w-3" />
                <span className="text-[9px] font-medium text-blue-400">Google Tasks</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-primary/10 text-primary">
            Pending
          </span>

          {/* External link to Google Tasks web UI */}
          {isGoogleTask && todo.google_task_id && (
            <a
              href={`https://tasks.google.com`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-blue-400 transition-colors"
              title="Open in Google Tasks"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
