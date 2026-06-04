"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { isSupabaseConfigured, createClient } from "@/lib/supabase";
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

import { LocationData } from "@/components/memory/memory-input";

type TabId = "home" | "memory" | "people" | "todos" | "insights";

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

export default function CognitiveRouter() {
  const [ledgers, setLedgers] = useState<RawLedger[]>([]);
  const [todos, setTodos] = useState<TodoTask[]>([]);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);
  const [prefillText, setPrefillText] = useState<string | undefined>(undefined);
  const [statsRefreshTrigger, setStatsRefreshTrigger] = useState(0);

  const isConfigured = useMemo(() => isSupabaseConfigured(), []);

  // ── Fetch recent ledgers ──────────────────────────────────
  const fetchLedgers = useCallback(async (): Promise<void> => {
    if (!isConfigured) return;
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("raw_ledgers")
        .select("id, created_at, content, intent_tag, local_timezone, location_text")
        .order("created_at", { ascending: false })
        .limit(5);
      if (!error && data) setLedgers(data as RawLedger[]);
    } catch {
      // Supabase not configured, ignore
    }
  }, [isConfigured]);

  // ── Fetch todos ───────────────────────────────────────────
  const fetchTodos = useCallback(async (): Promise<void> => {
    if (!isConfigured) return;
    try {
      const res = await fetch("/api/todos");
      if (!res.ok) return;
      const data = (await res.json()) as { todos?: TodoTask[] };
      setTodos(data.todos ?? []);
    } catch {
      // ignore
    }
  }, [isConfigured]);

  useEffect(() => {
    void fetchLedgers();
    void fetchTodos();
  }, [fetchLedgers, fetchTodos]);

  // ── Derived state ─────────────────────────────────────────
  const pendingTodos = todos.filter((t) => t.status === "pending");
  // Only show the tab when there are pending tasks
  const hasTodos = pendingTodos.length > 0;

  // Auto-navigate away from todos tab when all tasks are done
  useEffect(() => {
    if (activeTab === "todos" && pendingTodos.length === 0 && todos.length > 0) {
      // Small delay so the last item's exit animation can finish
      const t = setTimeout(() => setActiveTab("home"), 500);
      return () => clearTimeout(t);
    }
  }, [pendingTodos.length, todos.length, activeTab]);

  // ── Handle memory submit ──────────────────────────────────
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
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          device_type: deviceType,
          local_timezone: timezone,
          ...(location ?? {}),
        }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        error?: string;
        temporal_count?: number;
        entity_count?: number;
        task_count?: number;
        intent_tag?: string;
      };

      if (!res.ok) throw new Error(data.error ?? "Ingest failed.");

      const taskCount = data.task_count ?? 0;

      setStatus({
        type: "success",
        text: "Memory processed and stored",
        temporalCount: data.temporal_count ?? 0,
        entityCount: data.entity_count ?? 0,
        taskCount,
        intentTag: data.intent_tag,
      });

      // Refresh data
      await Promise.all([fetchLedgers(), fetchTodos()]);
      setStatsRefreshTrigger((n) => n + 1);

      // Auto-switch to todos tab if new tasks were created
      if (taskCount > 0) {
        setActiveTab("todos");
      }
    } catch (err: unknown) {
      setStatus({
        type: "error",
        text: err instanceof Error ? err.message : "An unknown error occurred.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // ── Handle quick actions ──────────────────────────────────
  const handleQuickAction = (action: string, prefill?: string) => {
    if (action === "analyze") {
      setActiveTab("insights");
      return;
    }
    if (prefill) {
      setPrefillText(prefill);
      setActiveTab("home");
    }
  };

  // ── Handle todo toggle ────────────────────────────────────
  const handleTodoToggle = async (
    id: string,
    newStatus: "pending" | "done"
  ): Promise<void> => {
    // Optimistic update
    setTodos((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: newStatus } : t))
    );

    const res = await fetch("/api/todos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: newStatus }),
    });

    if (!res.ok) {
      // Revert optimistic update and throw so TodoList shows error state
      await fetchTodos();
      const errData = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(errData.error ?? "Failed to update todo");
    }
  };

  // ── Handle person selection ───────────────────────────────
  const handleSelectPerson = (name: string) => {
    setSelectedPerson(name);
  };

  const handleBackFromProfile = () => {
    setSelectedPerson(null);
  };

  // ── Tab change handler ────────────────────────────────────
  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    if (tab !== "people") setSelectedPerson(null);
  };

  // ── Page title for each tab ───────────────────────────────
  const tabTitle: Record<TabId, string> = {
    home: "Recent Memories",
    memory: "All Memories",
    people: selectedPerson ? selectedPerson : "People",
    todos: "To-Do",
    insights: "Insights",
  };

  return (
    <div className="min-h-screen bg-background pb-28">
      {/* Background gradient */}
      <div className="fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-1/2 left-1/2 h-[800px] w-[800px] -translate-x-1/2 rounded-full bg-primary/8 blur-[120px]" />
        <div className="absolute bottom-0 right-0 h-[400px] w-[400px] rounded-full bg-purple-600/5 blur-[100px]" />
      </div>

      <Header
        isOnline={isConfigured}
        pendingTodoCount={pendingTodos.length}
      />

      <main className="mx-auto max-w-lg px-4 pt-4">
        {/* ── HOME TAB ── */}
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

            {/* Memory Input */}
            <div className="mb-6">
              <MemoryInput
                onSubmit={handleSubmit}
                isLoading={isLoading}
                onRecordingChange={setIsRecording}
                prefillText={prefillText}
                onPrefillConsumed={() => setPrefillText(undefined)}
              />
            </div>

            {/* Quick Actions */}
            <QuickActions onAction={handleQuickAction} />

            {/* Recent Memories */}
            <section className="mt-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">Recent Memories</h2>
                {ledgers.length > 0 && (
                  <button
                    onClick={() => setActiveTab("memory")}
                    className="text-xs text-primary hover:underline"
                  >
                    See all
                  </button>
                )}
              </div>
              <LedgerList ledgers={ledgers} />
            </section>
          </>
        )}

        {/* ── MEMORY TAB ── */}
        {activeTab === "memory" && (
          <section>
            <div className="mb-4">
              <h2 className="text-base font-semibold text-foreground">{tabTitle.memory}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">All your captured thoughts</p>
            </div>
            <MemoryTab isConfigured={isConfigured} />
          </section>
        )}

        {/* ── PEOPLE TAB ── */}
        {activeTab === "people" && (
          <section>
            {selectedPerson ? (
              <PersonProfile
                name={selectedPerson}
                onBack={handleBackFromProfile}
              />
            ) : (
              <PeopleList onSelectPerson={handleSelectPerson} />
            )}
          </section>
        )}

        {/* ── TODOS TAB ── */}
        {activeTab === "todos" && (
          <section>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-foreground">To-Do</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {pendingTodos.length} pending · {todos.length - pendingTodos.length} done
                </p>
              </div>
            </div>
            <TodoList todos={todos} onTodoToggle={handleTodoToggle} />
          </section>
        )}

        {/* ── INSIGHTS TAB ── */}
        {activeTab === "insights" && (
          <section>
            <div className="mb-4">
              <h2 className="text-base font-semibold text-foreground">Insights</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Your memory analytics</p>
            </div>
            <InsightsView isConfigured={isConfigured} />
          </section>
        )}
      </main>

      {/* Bottom Navigation */}
      <BottomNav
        activeTab={activeTab}
        onTabChange={handleTabChange}
        hasTodos={hasTodos}
        pendingTodoCount={pendingTodos.length}
      />

      {/* Status toast */}
      {status && (
        <StatusToast
          status={status}
          onDismiss={() => setStatus(null)}
        />
      )}
    </div>
  );
}
