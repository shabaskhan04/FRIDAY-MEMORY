"use client";

import { useState, useCallback, useEffect } from "react";
import {
  CheckSquare, Square, Loader2, ListTodo, AlertCircle,
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
  const [todos, setTodos] = useState<TodoTask[]>(propTodos);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [errorIds, setErrorIds] = useState<Map<string, string>>(new Map());
  // Track ids that are animating out (checked → about to disappear)
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    setTodos(propTodos);
  }, [propTodos]);

  const handleToggle = useCallback(
    async (todo: TodoTask) => {
      if (loadingIds.has(todo.id) || removingIds.has(todo.id)) return;
      // Only pending → done triggers the remove animation
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

        // Start exit animation, then remove from local list
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
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {getRelativeTime(todo.created_at)}
            {errorMsg && (
              <span className="ml-2 text-destructive">· {errorMsg}</span>
            )}
          </p>
        </div>

        <span className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium bg-primary/10 text-primary">
          Pending
        </span>
      </div>
    </div>
  );
}
