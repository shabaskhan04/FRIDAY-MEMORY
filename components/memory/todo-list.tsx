"use client";

import { useState, useCallback, useEffect } from "react";
import {
  CheckSquare, Square, Loader2, ListTodo,
  CheckCheck, AlertCircle, RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface TodoTask {
  id: string;
  raw_ledger_id: string;
  task_description: string;
  status: "pending" | "done";
  created_at: string;
}

interface TodoListProps {
  todos: TodoTask[];
  onTodoToggle: (id: string, newStatus: "pending" | "done") => Promise<void>;
}

export function TodoList({ todos: propTodos, onTodoToggle }: TodoListProps) {
  // Keep a local copy so we can do optimistic updates independently
  const [todos, setTodos] = useState<TodoTask[]>(propTodos);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [errorIds, setErrorIds] = useState<Map<string, string>>(new Map());

  // Sync when parent gives fresh todos (after page refetch)
  useEffect(() => {
    setTodos(propTodos);
  }, [propTodos]);

  const handleToggle = useCallback(
    async (todo: TodoTask) => {
      if (loadingIds.has(todo.id)) return;
      const newStatus = todo.status === "pending" ? "done" : "pending";

      // Optimistic update immediately
      setTodos((prev) =>
        prev.map((t) => (t.id === todo.id ? { ...t, status: newStatus } : t))
      );
      setLoadingIds((prev) => new Set(prev).add(todo.id));
      setErrorIds((prev) => { const m = new Map(prev); m.delete(todo.id); return m; });

      try {
        // Direct Supabase call — bypasses the API route entirely
        const { createClient } = await import("@/lib/supabase");
        const supabase = createClient();
        const { error } = await supabase
          .from("todo_tasks")
          .update({ status: newStatus })
          .eq("id", todo.id);

        if (error) throw new Error(error.message);

        // Also notify parent so it can sync its state
        await onTodoToggle(todo.id, newStatus);
      } catch (err) {
        // Revert on failure
        setTodos((prev) =>
          prev.map((t) => (t.id === todo.id ? { ...t, status: todo.status } : t))
        );
        setErrorIds((prev) =>
          new Map(prev).set(
            todo.id,
            err instanceof Error ? err.message : "Update failed"
          )
        );
      } finally {
        setLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(todo.id);
          return next;
        });
      }
    },
    [loadingIds, onTodoToggle]
  );

  const pending = todos.filter((t) => t.status === "pending");
  const done = todos.filter((t) => t.status === "done");

  if (todos.length === 0) {
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
    <div className="space-y-4">
      {/* Pending */}
      {pending.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <ListTodo className="h-4 w-4 text-primary" />
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Pending · {pending.length}
            </h3>
          </div>
          <div className="space-y-2">
            {pending.map((todo, i) => (
              <TodoItem
                key={todo.id}
                todo={todo}
                isLoading={loadingIds.has(todo.id)}
                errorMsg={errorIds.get(todo.id)}
                onToggle={handleToggle}
                animDelay={i * 40}
              />
            ))}
          </div>
        </section>
      )}

      {/* Done */}
      {done.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3 mt-2">
            <CheckCheck className="h-4 w-4 text-success" />
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Completed · {done.length}
            </h3>
          </div>
          <div className="space-y-2">
            {done.map((todo, i) => (
              <TodoItem
                key={todo.id}
                todo={todo}
                isLoading={loadingIds.has(todo.id)}
                errorMsg={errorIds.get(todo.id)}
                onToggle={handleToggle}
                animDelay={i * 40}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function TodoItem({
  todo,
  isLoading,
  errorMsg,
  onToggle,
  animDelay,
}: {
  todo: TodoTask;
  isLoading: boolean;
  errorMsg?: string;
  onToggle: (todo: TodoTask) => void;
  animDelay: number;
}) {
  const isDone = todo.status === "done";

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
        isDone && "opacity-55",
        errorMsg && "ring-1 ring-destructive/40"
      )}
      style={{ animationDelay: `${animDelay}ms` }}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox button */}
        <button
          type="button"
          onClick={() => onToggle(todo)}
          disabled={isLoading}
          aria-label={isDone ? "Mark as pending" : "Mark as done"}
          className={cn(
            "mt-0.5 shrink-0 rounded-md transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/40",
            isDone
              ? "text-success hover:text-success/70"
              : "text-muted-foreground hover:text-primary",
            isLoading && "cursor-not-allowed opacity-50"
          )}
        >
          {isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          ) : errorMsg ? (
            <AlertCircle className="h-5 w-5 text-destructive" />
          ) : isDone ? (
            <CheckSquare className="h-5 w-5" />
          ) : (
            <Square className="h-5 w-5" />
          )}
        </button>

        {/* Text */}
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "text-sm text-foreground leading-relaxed",
              isDone && "line-through text-muted-foreground"
            )}
          >
            {todo.task_description}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {getRelativeTime(todo.created_at)}
            {errorMsg && (
              <span className="ml-2 text-destructive">· {errorMsg}</span>
            )}
          </p>
        </div>

        {/* Status pill */}
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
            isDone
              ? "bg-success/10 text-success"
              : "bg-primary/10 text-primary"
          )}
        >
          {isDone ? "Done" : "Pending"}
        </span>
      </div>
    </div>
  );
}
