"use client";

import { Settings, Eye, X, Loader2, ChevronRight, Printer, Database, Link, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { getGoogleStatus, getWeeklySummary, type WeeklySummary } from "@/lib/api-client";
import { useState, useCallback, useEffect } from "react";

interface HeaderProps {
  isOnline?: boolean;
  pendingTodoCount?: number;
}

interface DbStats {
  memories: number;
  entities: number;
  todos: number;
  temporal: number;
  sizeEstimateKb: number;
}

// ── Google connection state ───────────────────────────────────

type GoogleStatus = "checking" | "connected" | "disconnected" | "error";

function useGoogleStatus(watch: boolean) {
  const [status, setStatus] = useState<GoogleStatus>("checking");

  const check = useCallback(async () => {
    setStatus("checking");
    try {
      const data = await getGoogleStatus();
      setStatus(data.connected ? "connected" : "disconnected");
    } catch {
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    if (watch) void check();
  }, [watch, check]);

  return { status, refresh: check };
}

// ── Component ─────────────────────────────────────────────────

export function Header({ isOnline = true, pendingTodoCount = 0 }: HeaderProps) {
  const [showSettings, setShowSettings] = useState(false);
  const [showWeekly, setShowWeekly] = useState(false);
  const [weeklySummary, setWeeklySummary] = useState<WeeklySummary | null>(null);
  const [weeklyLoading, setWeeklyLoading] = useState(false);
  const [weeklyError, setWeeklyError] = useState<string | null>(null);
  const [dbStats, setDbStats] = useState<DbStats | null>(null);
  const [dbLoading, setDbLoading] = useState(false);
  const [settingsTab, setSettingsTab] = useState<"general" | "database">("general");
  const [isPrintLoading, setIsPrintLoading] = useState(false);

  const { status: googleStatus, refresh: refreshGoogle } = useGoogleStatus(showSettings);

  const fetchWeeklySummary = useCallback(async () => {
    if (weeklySummary) { setShowWeekly(true); return; }
    setShowWeekly(true);
    setWeeklyLoading(true);
    setWeeklyError(null);
    try {
      const data = await getWeeklySummary();
      setWeeklySummary(data);
    } catch (err) {
      setWeeklyError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setWeeklyLoading(false);
    }
  }, [weeklySummary]);

  const fetchDbStats = useCallback(async () => {
    if (dbStats) return;
    setDbLoading(true);
    try {
      const { createClient } = await import("@/lib/supabase");
      const supabase = createClient();
      const [r1, r2, r3, r4] = await Promise.all([
        supabase.from("raw_ledgers").select("id, content", { count: "exact" }),
        supabase.from("entity_ledger").select("id, ledger_note", { count: "exact" }),
        supabase.from("todo_tasks").select("id, task_description", { count: "exact" }),
        supabase.from("temporal_memories").select("id, event_summary", { count: "exact" }),
      ]);

      const memories = r1.count ?? 0;
      const entities = r2.count ?? 0;
      const todos = r3.count ?? 0;
      const temporal = r4.count ?? 0;
      const totalRows = memories + entities + todos + temporal;
      const sizeEstimateKb = Math.round((totalRows * 250) / 1024);

      setDbStats({ memories, entities, todos, temporal, sizeEstimateKb });
    } catch { /* ignore */ }
    finally { setDbLoading(false); }
  }, [dbStats]);

  const handlePrintMemory = async () => {
    setIsPrintLoading(true);
    try {
      const { createClient } = await import("@/lib/supabase");
      const supabase = createClient();

      const [rawRes, entityRes, todoRes] = await Promise.all([
        supabase
          .from("raw_ledgers")
          .select("id, content, created_at, intent_tag, local_timezone, location_text, device_type")
          .order("created_at", { ascending: false }),
        supabase.from("entity_ledger").select("name, interaction_type, trust_signal, raw_ledger_id"),
        supabase.from("todo_tasks").select("task_description, status, created_at").order("created_at", { ascending: false }),
      ]);

      const memories = rawRes.data ?? [];
      const entities = entityRes.data ?? [];
      const todos = todoRes.data ?? [];

      const entityMap: Record<string, typeof entities> = {};
      for (const e of entities) {
        const id = e.raw_ledger_id as string;
        entityMap[id] = [...(entityMap[id] ?? []), e];
      }

      const intentEmoji: Record<string, string> = {
        standard: "📝", spark: "⚡", friction: "🔥",
      };

      const formatDate = (iso: string, tz?: string | null) => {
        try {
          return new Date(iso).toLocaleString("en-IN", {
            timeZone: tz ?? undefined,
            weekday: "short", year: "numeric", month: "short",
            day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true,
          });
        } catch { return new Date(iso).toLocaleString(); }
      };

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>FRIDAY Memory Journal — ${new Date().toLocaleDateString()}</title>
<style>
  body { font-family: Georgia, serif; max-width: 720px; margin: 40px auto; color: #1a1a1a; line-height: 1.6; }
  h1 { font-size: 24pt; margin-bottom: 4pt; }
  .meta { color: #666; font-size: 9pt; margin-bottom: 32pt; }
  .section-title { font-size: 11pt; font-weight: bold; border-bottom: 1px solid #ddd; padding-bottom: 4pt; margin: 24pt 0 12pt; text-transform: uppercase; letter-spacing: 1px; color: #555; }
  .memory { border: 1px solid #e0e0e0; border-radius: 8px; padding: 12pt; margin-bottom: 10pt; page-break-inside: avoid; }
  .memory-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 6pt; }
  .tag { font-size: 8pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.5px; }
  .tag.standard { color: #7c3aed; }
  .tag.spark { color: #d97706; }
  .tag.friction { color: #dc2626; }
  .memory-content { font-size: 11pt; margin-bottom: 8pt; }
  .memory-meta { font-size: 8pt; color: #888; }
  .people { font-size: 9pt; color: #555; margin-top: 6pt; }
  .todo-item { display: flex; gap: 8pt; margin-bottom: 4pt; font-size: 10pt; }
  .done { text-decoration: line-through; color: #888; }
  .stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12pt; text-align: center; margin: 16pt 0; }
  .stat-box { border: 1px solid #ddd; border-radius: 6px; padding: 10pt; }
  .stat-num { font-size: 20pt; font-weight: bold; }
  @media print { body { margin: 20pt; } .memory { break-inside: avoid; } }
</style>
</head>
<body>
<h1>🧠 FRIDAY Memory Journal</h1>
<p class="meta">Exported: ${new Date().toLocaleString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: true })} &nbsp;|&nbsp; ${memories.length} memories &nbsp;|&nbsp; ${entities.length} people &nbsp;|&nbsp; ${todos.length} tasks</p>

<div class="stats">
  <div class="stat-box"><div class="stat-num">${memories.length}</div><div>Memories</div></div>
  <div class="stat-box"><div class="stat-num">${[...new Set(entities.map((e) => e.name))].length}</div><div>People</div></div>
  <div class="stat-box"><div class="stat-num">${todos.filter((t) => t.status === "pending").length}</div><div>Pending Tasks</div></div>
</div>

<div class="section-title">📋 All Tasks</div>
${todos.map((t) => `<div class="todo-item"><span>${t.status === "done" ? "✅" : "⬜"}</span><span class="${t.status === "done" ? "done" : ""}">${t.task_description}</span></div>`).join("")}

<div class="section-title">🧠 Memory Entries (${memories.length})</div>
${memories.map((m) => {
  const linked = entityMap[m.id as string] ?? [];
  return `<div class="memory">
  <div class="memory-header">
    <span class="tag ${m.intent_tag}">${intentEmoji[m.intent_tag as string] ?? "📝"} ${(m.intent_tag as string).toUpperCase()}</span>
    <span style="font-size:8pt;color:#888">${formatDate(m.created_at as string, m.local_timezone as string | null)}</span>
  </div>
  <div class="memory-content">${(m.content as string).replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
  <div class="memory-meta">${m.location_text ? `📍 ${m.location_text}  ·  ` : ""}${m.device_type ?? ""} ${m.local_timezone ? `· ${m.local_timezone}` : ""}</div>
  ${linked.length > 0 ? `<div class="people">👥 ${linked.map((e) => `${e.name} (${e.interaction_type}, ${e.trust_signal})`).join(" · ")}</div>` : ""}
</div>`;
}).join("")}
</body>
</html>`;

      const win = window.open("", "_blank", "width=800,height=900");
      if (win) {
        win.document.write(html);
        win.document.close();
        setTimeout(() => win.print(), 500);
      }
    } catch (err) {
      console.error("[print]", err);
    } finally {
      setIsPrintLoading(false);
    }
  };

  const openSettings = () => {
    setShowSettings(true);
    void fetchDbStats();
  };

  const weekDates = weeklySummary
    ? `${new Date(weeklySummary.week_start).toLocaleDateString("en-IN", { month: "short", day: "numeric" })} – ${new Date(weeklySummary.week_end).toLocaleDateString("en-IN", { month: "short", day: "numeric" })}`
    : "";

  return (
    <>
      <header className="sticky top-0 z-50 w-full bg-background/80 backdrop-blur-xl border-b border-border/30">
        <div className="mx-auto flex h-14 max-w-lg items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="text-lg font-semibold text-foreground">Friday</span>
            <span className="rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-medium text-primary">
              BETA
            </span>
          </div>

          <div className="flex items-center gap-1">
            <div
              className={cn(
                "mr-2 flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-medium",
                isOnline ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", isOnline ? "bg-success animate-pulse-soft" : "bg-destructive")} />
              {isOnline ? "Online" : "Offline"}
            </div>

            <button
              onClick={() => void fetchWeeklySummary()}
              className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              aria-label="Weekly summary"
              title="Weekly summary"
            >
              <Eye className="h-5 w-5" />
              {pendingTodoCount > 0 && (
                <span className="absolute top-1 right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-[8px] font-bold text-white">
                  {pendingTodoCount > 9 ? "9+" : pendingTodoCount}
                </span>
              )}
            </button>

            <button
              onClick={openSettings}
              className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              aria-label="Settings"
            >
              <Settings className="h-5 w-5" />
            </button>
          </div>
        </div>
      </header>

      {/* ── WEEKLY SUMMARY PANEL ── */}
      {showWeekly && (
        <div className="fixed inset-0 z-[100] flex flex-col">
          <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={() => setShowWeekly(false)} />
          <div className="relative mt-auto w-full max-w-lg mx-auto rounded-t-3xl glass-card border border-border/50 max-h-[85vh] flex flex-col animate-fade-up">
            <div className="flex items-center justify-between p-5 pb-3 shrink-0">
              <div>
                <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Eye className="h-4 w-4 text-primary" />
                  Weekly Digest
                </h2>
                {weekDates && <p className="text-xs text-muted-foreground mt-0.5">{weekDates}</p>}
              </div>
              <button
                onClick={() => setShowWeekly(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 px-5 pb-8 space-y-4">
              {weeklyLoading && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  <p className="text-sm text-muted-foreground">Analysing your week...</p>
                </div>
              )}
              {weeklyError && (
                <div className="rounded-2xl bg-destructive/10 border border-destructive/20 p-4">
                  <p className="text-sm text-destructive">{weeklyError}</p>
                </div>
              )}
              {weeklySummary && !weeklyLoading && (
                <>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: "Memories", value: weeklySummary.entry_count },
                      { label: "People", value: weeklySummary.people_count ?? 0 },
                      { label: "Pending", value: weeklySummary.pending_todos ?? 0 },
                    ].map((s) => (
                      <div key={s.label} className="rounded-xl bg-secondary/50 p-3 text-center">
                        <p className="text-lg font-bold text-foreground">{s.value}</p>
                        <p className="text-[10px] text-muted-foreground">{s.label}</p>
                      </div>
                    ))}
                  </div>

                  <div className="rounded-2xl bg-primary/5 border border-primary/10 p-4">
                    <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">Week Vibe</p>
                    <p className="text-sm text-foreground">{weeklySummary.mood_summary}</p>
                  </div>

                  <SummarySection title="✅ What To Do" items={weeklySummary.what_to_do} colorClass="text-success" bgClass="bg-success/8" />
                  <SummarySection title="🚫 What To Avoid" items={weeklySummary.what_to_avoid} colorClass="text-destructive" bgClass="bg-destructive/8" />
                  <SummarySection title="📈 What To Improve" items={weeklySummary.what_to_improve} colorClass="text-warning" bgClass="bg-warning/8" />
                  {weeklySummary.key_people?.length > 0 && (
                    <SummarySection title="👥 Key People This Week" items={weeklySummary.key_people} colorClass="text-primary" bgClass="bg-primary/8" />
                  )}
                  {weeklySummary.pending_focus?.length > 0 && (
                    <SummarySection title="🎯 Top Priorities" items={weeklySummary.pending_focus} colorClass="text-foreground" bgClass="bg-secondary" />
                  )}

                  <button
                    onClick={() => { setWeeklySummary(null); void fetchWeeklySummary(); }}
                    className="w-full rounded-2xl border border-border/50 py-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Refresh summary
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── SETTINGS PANEL ── */}
      {showSettings && (
        <div className="fixed inset-0 z-[100] flex flex-col">
          <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={() => setShowSettings(false)} />
          <div className="relative mt-auto w-full max-w-lg mx-auto rounded-t-3xl glass-card border border-border/50 max-h-[85vh] flex flex-col animate-fade-up">
            <div className="flex items-center justify-between p-5 pb-3 shrink-0">
              <h2 className="text-base font-semibold text-foreground">Settings</h2>
              <button
                onClick={() => setShowSettings(false)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex gap-2 px-5 pb-3 shrink-0">
              {(["general", "database"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setSettingsTab(tab)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all capitalize",
                    settingsTab === tab
                      ? "gradient-purple text-white"
                      : "bg-secondary text-muted-foreground hover:text-foreground"
                  )}
                >
                  {tab === "database" ? <Database className="h-3 w-3" /> : <Settings className="h-3 w-3" />}
                  {tab}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto flex-1 px-5 pb-8 space-y-3">
              {settingsTab === "general" && (
                <>
                  {/* Connection */}
                  <div className="rounded-2xl bg-secondary/50 p-4 space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Connection</p>
                    <SettingsRow label="Supabase" value={isOnline ? "Connected" : "Disconnected"} valueColor={isOnline ? "text-success" : "text-destructive"} />
                    <SettingsRow label="AI (Groq)" value="Active" valueColor="text-success" />
                    <SettingsRow label="Model" value="llama-3.3-70b" />
                  </div>

                  {/* ── Google Workspace section ── */}
                  <div className="rounded-2xl bg-secondary/50 p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                        Google Workspace
                      </p>
                      <button
                        onClick={() => void refreshGoogle()}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground transition-colors"
                        title="Refresh status"
                      >
                        <RefreshCw className={cn("h-3 w-3", googleStatus === "checking" && "animate-spin")} />
                      </button>
                    </div>

                    {/* Status row */}
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-foreground">Status</span>
                      <div className="flex items-center gap-1.5">
                        {googleStatus === "checking" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                        ) : (
                          <span
                            className={cn(
                              "h-2 w-2 rounded-full",
                              googleStatus === "connected" ? "bg-success animate-pulse-soft" : "bg-destructive"
                            )}
                          />
                        )}
                        <span
                          className={cn(
                            "text-xs",
                            googleStatus === "connected"
                              ? "text-success"
                              : googleStatus === "checking"
                              ? "text-muted-foreground"
                              : "text-destructive"
                          )}
                        >
                          {googleStatus === "checking"
                            ? "Checking…"
                            : googleStatus === "connected"
                            ? "Connected"
                            : googleStatus === "error"
                            ? "Error"
                            : "Not connected"}
                        </span>
                      </div>
                    </div>

                    {googleStatus === "connected" && (
                      <>
                        <SettingsRow label="Calendar" value="✓ Enabled" valueColor="text-success" />
                        <SettingsRow label="Gmail" value="✓ Enabled" valueColor="text-success" />
                        <SettingsRow label="Tasks" value="✓ Enabled" valueColor="text-success" />
                      </>
                    )}

                    {/* Connect / reconnect button */}
                    <a
                      href="/api/google/connect"
                      className={cn(
                        "flex w-full items-center justify-between rounded-xl p-3 text-sm transition-colors",
                        googleStatus === "connected"
                          ? "bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/70"
                          : "gradient-purple text-white hover:opacity-90"
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <Link className="h-4 w-4" />
                        {googleStatus === "connected" ? "Reconnect Google" : "Connect Google Workspace"}
                      </span>
                      <ChevronRight className="h-4 w-4 opacity-60" />
                    </a>
                  </div>

                  {/* Device */}
                  <div className="rounded-2xl bg-secondary/50 p-4 space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Device Info</p>
                    <SettingsRow
                      label="Timezone"
                      value={typeof window !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "Detecting..."}
                    />
                    <SettingsRow
                      label="Device"
                      value={
                        typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)
                          ? "Mobile"
                          : "Desktop"
                      }
                    />
                    <SettingsRow
                      label="Local Time"
                      value={new Date().toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, weekday: "short" })}
                    />
                  </div>

                  {/* Print */}
                  <div className="rounded-2xl bg-secondary/50 p-4 space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Export</p>
                    <p className="text-xs text-muted-foreground">Print or save your entire memory journal as a PDF.</p>
                    <button
                      onClick={() => void handlePrintMemory()}
                      disabled={isPrintLoading}
                      className="flex w-full items-center justify-between rounded-xl bg-secondary p-3 text-sm text-foreground hover:bg-secondary/70 transition-colors disabled:opacity-50"
                    >
                      <span className="flex items-center gap-2">
                        {isPrintLoading ? (
                          <Loader2 className="h-4 w-4 text-primary animate-spin" />
                        ) : (
                          <Printer className="h-4 w-4 text-primary" />
                        )}
                        {isPrintLoading ? "Fetching all memories..." : "Print Memory Journal"}
                      </span>
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </button>
                  </div>

                  {/* DB Migration SQL */}
                  <div className="rounded-2xl bg-secondary/50 p-4 space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Location Columns (Run once in Supabase SQL Editor)</p>
                    <pre className="rounded-xl bg-background/60 p-3 text-[10px] text-muted-foreground overflow-x-auto">{`ALTER TABLE raw_ledgers
  ADD COLUMN IF NOT EXISTS location_text TEXT,
  ADD COLUMN IF NOT EXISTS location_lat FLOAT,
  ADD COLUMN IF NOT EXISTS location_lon FLOAT;`}</pre>
                  </div>

                  {/* About */}
                  <div className="rounded-2xl bg-secondary/50 p-4 space-y-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">About</p>
                    <SettingsRow label="Version" value="FRIDAY v2.1" />
                    <SettingsRow label="Build" value="Next.js 15.1" />
                  </div>
                </>
              )}

              {settingsTab === "database" && (
                <>
                  {dbLoading ? (
                    <div className="flex justify-center py-10">
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    </div>
                  ) : dbStats ? (
                    <>
                      <div className="rounded-2xl bg-secondary/50 p-4 space-y-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Row Counts</p>
                        {[
                          { label: "raw_ledgers", cols: "id, content, intent_tag, device_type, local_timezone, location_text, location_lat, location_lon, created_at", count: dbStats.memories },
                          { label: "entity_ledger", cols: "id, raw_ledger_id, name, interaction_type, trust_signal, ledger_note", count: dbStats.entities },
                          { label: "todo_tasks", cols: "id, raw_ledger_id, task_description, status, source, google_task_id, created_at", count: dbStats.todos },
                          { label: "temporal_memories", cols: "id, raw_ledger_id, time_horizon, estimated_date, era, event_summary", count: dbStats.temporal },
                        ].map((t) => (
                          <div key={t.label} className="space-y-0.5">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-mono text-primary">{t.label}</span>
                              <span className="text-xs font-bold text-foreground">{t.count} rows</span>
                            </div>
                            <p className="text-[9px] text-muted-foreground/60 font-mono leading-relaxed">{t.cols}</p>
                          </div>
                        ))}
                      </div>

                      <div className="rounded-2xl bg-secondary/50 p-4 space-y-3">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Storage Estimate</p>
                        <SettingsRow label="Total Rows" value={String(dbStats.memories + dbStats.entities + dbStats.todos + dbStats.temporal)} />
                        <SettingsRow label="Estimated Size" value={`~${dbStats.sizeEstimateKb} KB`} />
                        <SettingsRow label="Plan" value="Supabase Free (500 MB)" />
                        <div className="h-2 rounded-full bg-secondary overflow-hidden mt-2">
                          <div
                            className="h-full rounded-full gradient-purple transition-all duration-700"
                            style={{ width: `${Math.min((dbStats.sizeEstimateKb / (500 * 1024)) * 100, 100)}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          {((dbStats.sizeEstimateKb / (500 * 1024)) * 100).toFixed(3)}% of 500 MB used
                        </p>
                      </div>

                      <button
                        onClick={() => { setDbStats(null); void fetchDbStats(); }}
                        className="w-full rounded-2xl border border-border/50 py-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Refresh stats
                      </button>
                    </>
                  ) : (
                    <div className="rounded-2xl glass-card p-6 text-center">
                      <p className="text-sm text-muted-foreground">Connect Supabase to see DB stats</p>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────

function SettingsRow({
  label,
  value,
  valueColor = "text-muted-foreground",
}: {
  label: string;
  value: string;
  valueColor?: string;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-foreground">{label}</span>
      <span className={cn("text-xs", valueColor)}>{value}</span>
    </div>
  );
}

function SummarySection({
  title,
  items,
  colorClass,
  bgClass,
}: {
  title: string;
  items: string[];
  colorClass: string;
  bgClass: string;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className={cn("rounded-2xl p-4 space-y-2", bgClass)}>
      <p className={cn("text-xs font-semibold uppercase tracking-wider", colorClass)}>{title}</p>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2">
            <span className={cn("mt-0.5 text-[10px] shrink-0", colorClass)}>•</span>
            <span className="text-sm text-foreground leading-relaxed">{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
