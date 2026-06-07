"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase-client";
import { ingestMemory, executeNLTask, patchTodo } from "@/lib/api-client";
import { Header } from "@/components/memory/header";
import { GreetingCard } from "@/components/memory/greeting-card";
import { StatsRow } from "@/components/memory/stats-row";
import { MemoryInput } from "@/components/memory/memory-input";
import { StatusToast } from "@/components/memory/status-toast";
import { LedgerList } from "@/components/memory/ledger-list";
import { BottomNav } from "@/components/memory/bottom-nav";
import { QuickActions } from "@/components/memory/quick-actions";
import { TodoList } from "@/components/memory/todo-list";
import { PeopleList } from "@/components/memory/people-list";
import { PersonProfile } from "@/components/memory/person-profile";
import { InsightsView } from "@/components/memory/insights-view";
import { MemoryTab } from "@/components/memory/memory-tab";
import { HealthView } from "@/components/memory/health-view";
import type { LocationData } from "@/components/memory/memory-input";

// ============================================================
// Types
// ============================================================

type TabId = "home" | "memory" | "people" | "todos" | "insights" | "health";

interface RawLedger {
  id: string;
  created_at: string;
  content: string;
  intent_tag?: string;
  local_timezone?: string;
  location_text?: string;
}

interface TodoTask {
  id: string;
  raw_ledger_id: string;
  task_description: string;
  status: "pending" | "done";
  created_at: string;
}

interface StatusMessage {
  type: "success" | "error" | "warning";
  text: string;
  temporalCount?: number;
  entityCount?: number;
  taskCount?: number;
  intentTag?: string;
}

// ============================================================
// SemanticEngineIndicator
// ============================================================

function SemanticEngineIndicator(): React.ReactElement {
  return (
    <div
      className="flex items-center gap-1.5"
      aria-label="Semantic cognitive search engine status: active"
      role="status"
    >
      <span className="relative flex h-1.5 w-1.5">
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60"
          aria-hidden="true"
        />
        <span
          className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary"
          aria-hidden="true"
        />
      </span>
      <span
        className="font-mono text-[9px] font-medium tracking-widest text-primary/70 uppercase select-none"
        style={{ letterSpacing: "0.15em" }}
      >
        Semantic Cognitive Search Engine{" "}
        <span className="text-primary/50">{'//'}</span>{" "}
        <span className="text-primary">Active</span>
      </span>
    </div>
  );
}

function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

// ============================================================
// CognitiveRouter (page component)
// ============================================================

export default function CognitiveRouter(): React.ReactElement {
  const [ledgers, setLedgers] = useState<RawLedger[]>([]);
  const [todos, setTodos] = useState<TodoTask[]>([]);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [prefillText, setPrefillText] = useState<string | undefined>(undefined);
  const [statsRefreshTrigger, setStatsRefreshTrigger] = useState<number>(0);

  const isConfigured: boolean = useMemo(() => isSupabaseConfigured(), []);

  // ── Fetch recent ledgers directly from Supabase (anon key read) ──

  const fetchLedgers = useCallback(async (): Promise<void> => {
    if (!isConfigured) return;
    try {
      const { data, error } = await supabase
        .from("raw_ledgers")
        .select("id, created_at, content, intent_tag, local_timezone, location_text")
        .order("created_at", { ascending: false })
        .limit(5);
      if (!error && data) setLedgers(data as RawLedger[]);
    } catch {
      // Supabase not configured — ignore silently
    }
  }, [isConfigured]);

  // ── Fetch todos via backend API ──────────────────────────────────

  const fetchTodos = useCallback(async (): Promise<void> => {
    if (!isConfigured) return;
    try {
      const { todos: fetched } = await import("@/lib/api-client").then((m) =>
        m.getTodos()
      );
      setTodos((fetched ?? []) as TodoTask[]);
    } catch {
      // ignore network errors silently
    }
  }, [isConfigured]);

  useEffect(() => {
    void fetchLedgers();
    void fetchTodos();
  }, [fetchLedgers, fetchTodos]);

  // ── Derived state ──────────────────────────────────────────────

  const pendingTodos: TodoTask[] = todos.filter((t) => t.status === "pending");
  const hasTodos: boolean = pendingTodos.length > 0;

  // Auto-navigate away from todos tab when all tasks complete
  useEffect(() => {
    if (activeTab === "todos" && pendingTodos.length === 0 && todos.length > 0) {
      const timer = setTimeout(() => setActiveTab("home"), 500);
      return () => clearTimeout(timer);
    }
  }, [pendingTodos.length, todos.length, activeTab]);

  // ── Handle memory submit → backend /ingest ────────────────────

  const handleSubmit = async (
    content: string,
    deviceType: string,
    timezone: string,
    location?: LocationData
  ): Promise<void> => {
    if (!isConfigured) {
      setStatus({
        type: "warning",
        text: "Connect Supabase from Settings to enable memory storage.",
      });
      return;
    }

    setIsLoading(true);
    setStatus(null);

    try {
      const data = await ingestMemory({
        content,
        device_type: deviceType as "mobile" | "desktop",
        local_timezone: timezone,
        ...(location ?? {}),
      });

      const taskCount: number = data.task_count ?? 0;

      setStatus({
        type: "success",
        text: "Memory processed and stored",
        temporalCount: data.temporal_count ?? 0,
        entityCount: data.entity_count ?? 0,
        taskCount,
        intentTag: data.intent_tag,
      });

      await Promise.all([fetchLedgers(), fetchTodos()]);
      setStatsRefreshTrigger((n) => n + 1);

      if (taskCount > 0) setActiveTab("todos");
    } catch (err: unknown) {
      setStatus({
        type: "error",
        text: err instanceof Error ? err.message : "An unknown error occurred.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Handle task submit → backend /tasks/execute ───────────────

  const handleTaskSubmit = async (query: string): Promise<void> => {
    if (!isConfigured) {
      setStatus({
        type: "warning",
        text: "Connect Supabase from Settings to enable task staging.",
      });
      return;
    }

    setIsLoading(true);
    setStatus(null);

    try {
      await executeNLTask(query);
      setStatus({
        type: "success",
        text: "Request sent for approval – check the drawer.",
      });
    } catch (err: unknown) {
      setStatus({
        type: "error",
        text: err instanceof Error ? err.message : "Task agent failed.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Handle quick actions ──────────────────────────────────────

  const handleQuickAction = (action: string, prefill?: string): void => {
    if (action === "analyze") {
      setActiveTab("insights");
      return;
    }
    if (prefill) {
      setPrefillText(prefill);
      setActiveTab("home");
    }
  };

  // ── Handle todo toggle → backend /todos PATCH ─────────────────

  const handleTodoToggle = async (
    id: string,
    newStatus: "pending" | "done"
  ): Promise<void> => {
    // Optimistic update
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t))
    );

    try {
      await patchTodo(id, newStatus);
    } catch (err) {
      // Revert on failure
      await fetchTodos();
      throw err;
    }
  };

  const handleSelectPerson = (name: string): void => setSelectedPerson(name);
  const handleBackFromProfile = (): void => setSelectedPerson(null);

  const handleTabChange = (tab: TabId): void => {
    setActiveTab(tab);
    if (tab !== "people") setSelectedPerson(null);
  };

  const tabTitle: Record<TabId, string> = {
    home: "Recent Memories",
    memory: "All Memories",
    people: selectedPerson ? selectedPerson : "People",
    todos: "To-Do",
    insights: "Insights",
    health: "Health",
  };

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="min-h-screen bg-background pb-28">
      {/* Background gradient blobs */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-1/2 left-1/2 h-[800px] w-[800px] -translate-x-1/2 rounded-full bg-primary/8 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-[400px] w-[400px] rounded-full bg-purple-600/5 blur-[100px]" />
      </div>

      <Header isOnline={isConfigured} pendingTodoCount={pendingTodos.length} />

      <main className="mx-auto max-w-lg px-4 pt-4">

        {/* ── HOME TAB ─────────────────────────────────── */}
        {activeTab === "home" && (
          <>
            <GreetingCard
              isConfigured={isConfigured}
              isRecording={isRecording}
              isProcessing={isLoading}
            />

            <StatsRow
              isConfigured={isConfigured}
              isProcessing={isLoading}
              refreshTrigger={statsRefreshTrigger}
            />

            <div className="mb-6">
              <MemoryInput
                onSubmit={handleSubmit}
                onTaskSubmit={handleTaskSubmit}
                isLoading={isLoading}
                onRecordingChange={setIsRecording}
                prefillText={prefillText}
                onPrefillConsumed={() => setPrefillText(undefined)}
              />
            </div>

            <QuickActions onAction={handleQuickAction} />

            <section className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">
                  Recent Memories
                </h2>
                <div className="flex items-center gap-3">
                  <SemanticEngineIndicator />
                  {ledgers.length > 0 && (
                    <button
                      onClick={() => setActiveTab("memory")}
                      className="text-xs text-primary hover:underline"
                    >
                      See all
                    </button>
                  )}
                </div>
              </div>
              <LedgerList ledgers={ledgers} />
            </section>
          </>
        )}

        {/* ── MEMORY TAB ─────────────────────────────────── */}
        {activeTab === "memory" && (
          <section>
            <div className="mb-4">
              <h2 className="text-base font-semibold text-foreground">
                {tabTitle.memory}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                All your captured thoughts
              </p>
            </div>
            <MemoryTab isConfigured={isConfigured} />
          </section>
        )}

        {/* ── PEOPLE TAB ─────────────────────────────────── */}
        {activeTab === "people" && (
          <section>
            {selectedPerson ? (
              <PersonProfile name={selectedPerson} onBack={handleBackFromProfile} />
            ) : (
              <PeopleList onSelectPerson={handleSelectPerson} />
            )}
          </section>
        )}

        {/* ── TODOS TAB ──────────────────────────────────── */}
        {activeTab === "todos" && (
          <section>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">To-Do</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {pendingTodos.length} pending ·{" "}
                  {todos.length - pendingTodos.length} done
                </p>
              </div>
            </div>
            <TodoList todos={todos} onTodoToggle={handleTodoToggle} />
          </section>
        )}

        {/* ── INSIGHTS TAB ───────────────────────────────── */}
        {activeTab === "insights" && (
          <section>
            <div className="mb-4">
              <h2 className="text-base font-semibold text-foreground">Insights</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Your memory analytics
              </p>
            </div>
            <InsightsView isConfigured={isConfigured} />
          </section>
        )}

        {/* ── HEALTH TAB ─────────────────────────────────── */}
        {activeTab === "health" && (
          <section>
            <div className="mb-4">
              <h2 className="text-base font-semibold text-foreground">Health</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Sleep, steps & body metrics
              </p>
            </div>
            <HealthView isConfigured={isConfigured} />
          </section>
        )}
      </main>

      <BottomNav
        activeTab={activeTab}
        onTabChange={handleTabChange}
        hasTodos={hasTodos}
        pendingTodoCount={pendingTodos.length}
      />

      {status && (
        <StatusToast status={status} onDismiss={() => setStatus(null)} />
      )}
    </div>
  );
}
