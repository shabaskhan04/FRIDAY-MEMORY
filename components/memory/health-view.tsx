"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Moon, Footprints, Scale, Ruler, Activity,
  ChevronDown, ChevronUp, Loader2, Check, Pencil,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface HealthLog {
  id: string;
  log_date: string;
  metric_type: "sleep" | "steps" | "body";
  sleep_hours?: number;
  sleep_quality?: "poor" | "fair" | "good" | "great";
  steps?: number;
  weight_kg?: number;
  height_cm?: number;
  notes?: string;
}

interface HealthViewProps {
  isConfigured: boolean;
}

function todayStr() {
  return new Date().toISOString().split("T")[0];
}

function calcBMI(weightKg: number, heightCm: number) {
  const h = heightCm / 100;
  return weightKg / (h * h);
}

function bmiCategory(bmi: number) {
  if (bmi < 18.5) return { label: "Underweight", color: "text-warning" };
  if (bmi < 25)   return { label: "Normal", color: "text-success" };
  if (bmi < 30)   return { label: "Overweight", color: "text-warning" };
  return { label: "Obese", color: "text-destructive" };
}

function sleepQualityColor(q?: string) {
  if (q === "great") return "text-success";
  if (q === "good")  return "text-primary";
  if (q === "fair")  return "text-warning";
  if (q === "poor")  return "text-destructive";
  return "text-muted-foreground";
}

const QUALITY_OPTIONS: { value: string; label: string }[] = [
  { value: "poor",  label: "😴 Poor" },
  { value: "fair",  label: "😐 Fair" },
  { value: "good",  label: "🙂 Good" },
  { value: "great", label: "😄 Great" },
];

export function HealthView({ isConfigured }: HealthViewProps) {
  const [logs, setLogs] = useState<HealthLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<"sleep" | "steps" | "body" | null>("sleep");

  // Form state
  const [sleepHours, setSleepHours] = useState("");
  const [sleepQuality, setSleepQuality] = useState("good");
  const [steps, setSteps] = useState("");
  const [weightKg, setWeightKg] = useState("");
  const [heightCm, setHeightCm] = useState("");
  const [notes, setNotes] = useState("");

  const fetchLogs = useCallback(async () => {
    if (!isConfigured) { setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/health");
      const data = await res.json() as { logs: HealthLog[] };
      setLogs(data.logs ?? []);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [isConfigured]);

  useEffect(() => { void fetchLogs(); }, [fetchLogs]);

  // Pre-fill today's values if they exist
  useEffect(() => {
    const today = todayStr();
    const todaySleep = logs.find(l => l.log_date === today && l.metric_type === "sleep");
    const todaySteps = logs.find(l => l.log_date === today && l.metric_type === "steps");
    // Body: use most recent
    const latestBody = logs.find(l => l.metric_type === "body");
    if (todaySleep) { setSleepHours(String(todaySleep.sleep_hours ?? "")); setSleepQuality(todaySleep.sleep_quality ?? "good"); }
    if (todaySteps) setSteps(String(todaySteps.steps ?? ""));
    if (latestBody) { setWeightKg(String(latestBody.weight_kg ?? "")); setHeightCm(String(latestBody.height_cm ?? "")); }
  }, [logs]);

  const save = async (type: "sleep" | "steps" | "body") => {
    setSaving(type);
    try {
      const today = todayStr();
      const payload: Record<string, unknown> = { metric_type: type, log_date: today };
      if (type === "sleep") { payload.sleep_hours = parseFloat(sleepHours); payload.sleep_quality = sleepQuality; if (notes) payload.notes = notes; }
      if (type === "steps") { payload.steps = parseInt(steps, 10); }
      if (type === "body")  { payload.weight_kg = parseFloat(weightKg); payload.height_cm = parseFloat(heightCm); if (notes) payload.notes = notes; }
      await fetch("/api/health", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      await fetchLogs();
      setOpenPanel(null);
    } finally { setSaving(null); }
  };

  // ── Derived stats ──────────────────────────────────────────
  const today = todayStr();
  const last7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    return d.toISOString().split("T")[0];
  });

  const sleepLogs = logs.filter(l => l.metric_type === "sleep");
  const stepsLogs = logs.filter(l => l.metric_type === "steps");
  const bodyLogs  = logs.filter(l => l.metric_type === "body");

  const todaySleep = sleepLogs.find(l => l.log_date === today);
  const todaySteps = stepsLogs.find(l => l.log_date === today);
  const latestBody = bodyLogs[0];

  const avgSleep7 = (() => {
    const wk = sleepLogs.filter(l => last7.includes(l.log_date));
    if (!wk.length) return null;
    return wk.reduce((a, l) => a + (l.sleep_hours ?? 0), 0) / wk.length;
  })();

  const avgSteps7 = (() => {
    const wk = stepsLogs.filter(l => last7.includes(l.log_date));
    if (!wk.length) return null;
    return Math.round(wk.reduce((a, l) => a + (l.steps ?? 0), 0) / wk.length);
  })();

  const bmi = latestBody?.weight_kg && latestBody?.height_cm
    ? calcBMI(latestBody.weight_kg, latestBody.height_cm) : null;

  const bmiCat = bmi ? bmiCategory(bmi) : null;

  if (!isConfigured) return (
    <div className="rounded-2xl glass-card p-8 text-center">
      <p className="text-sm text-muted-foreground">Connect Supabase to track health</p>
    </div>
  );

  if (loading) return (
    <div className="flex justify-center py-16">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );

  return (
    <div className="space-y-4">

      {/* ── Summary cards ── */}
      <div className="grid grid-cols-2 gap-3">
        <SummaryCard
          icon={Moon} iconColor="text-indigo-400"
          label="Sleep (tonight)" sub={avgSleep7 ? `7d avg: ${avgSleep7.toFixed(1)}h` : "No data yet"}
          value={todaySleep?.sleep_hours ? `${todaySleep.sleep_hours}h` : "—"}
          valueColor={todaySleep?.sleep_hours
            ? (todaySleep.sleep_hours >= 7 ? "text-success" : todaySleep.sleep_hours >= 5 ? "text-warning" : "text-destructive")
            : "text-muted-foreground"}
        />
        <SummaryCard
          icon={Footprints} iconColor="text-emerald-400"
          label="Steps (today)" sub={avgSteps7 ? `7d avg: ${avgSteps7.toLocaleString()}` : "No data yet"}
          value={todaySteps?.steps ? todaySteps.steps.toLocaleString() : "—"}
          valueColor={todaySteps?.steps
            ? (todaySteps.steps >= 10000 ? "text-success" : todaySteps.steps >= 5000 ? "text-warning" : "text-destructive")
            : "text-muted-foreground"}
        />
        <SummaryCard
          icon={Scale} iconColor="text-orange-400"
          label="Weight" sub={latestBody?.log_date ? `Updated ${latestBody.log_date}` : "Not set"}
          value={latestBody?.weight_kg ? `${latestBody.weight_kg} kg` : "—"}
        />
        <SummaryCard
          icon={Activity} iconColor={bmiCat?.color ?? "text-primary"}
          label="BMI"
          sub={bmiCat?.label ?? "Set height & weight"}
          value={bmi ? bmi.toFixed(1) : "—"}
          valueColor={bmiCat?.color}
        />
      </div>

      {/* ── Sleep log panel ── */}
      <Panel
        id="sleep"
        open={openPanel === "sleep"}
        onToggle={() => setOpenPanel(p => p === "sleep" ? null : "sleep")}
        icon={Moon} iconColor="text-indigo-400"
        title="Log Sleep"
        subtitle="Daily"
      >
        <div className="space-y-3">
          <NumberInput label="Hours slept" value={sleepHours} onChange={setSleepHours} placeholder="e.g. 7.5" min={0} max={24} step={0.5} />
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Quality</label>
            <div className="grid grid-cols-4 gap-1.5">
              {QUALITY_OPTIONS.map(o => (
                <button key={o.value} type="button"
                  onClick={() => setSleepQuality(o.value)}
                  className={cn("rounded-xl py-2 text-xs font-medium transition-all",
                    sleepQuality === o.value ? "bg-primary/20 text-primary ring-1 ring-primary/40" : "bg-secondary/50 text-muted-foreground hover:bg-secondary"
                  )}>{o.label}</button>
              ))}
            </div>
          </div>
          <SaveButton loading={saving === "sleep"} onClick={() => void save("sleep")} disabled={!sleepHours} />
        </div>
      </Panel>

      {/* ── Steps log panel ── */}
      <Panel
        id="steps"
        open={openPanel === "steps"}
        onToggle={() => setOpenPanel(p => p === "steps" ? null : "steps")}
        icon={Footprints} iconColor="text-emerald-400"
        title="Log Steps"
        subtitle="Daily"
      >
        <div className="space-y-3">
          <NumberInput label="Steps today" value={steps} onChange={setSteps} placeholder="e.g. 8000" min={0} max={100000} step={100} />
          <StepsGuide steps={parseInt(steps || "0", 10)} />
          <SaveButton loading={saving === "steps"} onClick={() => void save("steps")} disabled={!steps} />
        </div>
      </Panel>

      {/* ── Body metrics panel ── */}
      <Panel
        id="body"
        open={openPanel === "body"}
        onToggle={() => setOpenPanel(p => p === "body" ? null : "body")}
        icon={Ruler} iconColor="text-orange-400"
        title="Body Metrics"
        subtitle="Weekly"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <NumberInput label="Weight (kg)" value={weightKg} onChange={setWeightKg} placeholder="e.g. 70" min={20} max={300} step={0.1} />
            <NumberInput label="Height (cm)" value={heightCm} onChange={setHeightCm} placeholder="e.g. 175" min={100} max={250} step={0.5} />
          </div>
          {weightKg && heightCm && parseFloat(heightCm) > 0 && (
            <BMIPreview bmi={calcBMI(parseFloat(weightKg), parseFloat(heightCm))} />
          )}
          <SaveButton loading={saving === "body"} onClick={() => void save("body")} disabled={!weightKg || !heightCm} />
        </div>
      </Panel>

      {/* ── 7-day sleep chart ── */}
      {sleepLogs.length > 0 && (
        <div className="rounded-2xl glass-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Moon className="h-4 w-4 text-indigo-400" /> Sleep — Last 7 Days
          </h3>
          <div className="flex items-end gap-1.5 h-20">
            {last7.map(date => {
              const log = sleepLogs.find(l => l.log_date === date);
              const hours = log?.sleep_hours ?? 0;
              const pct = Math.min(hours / 10, 1) * 100;
              const label = new Date(date + "T00:00:00").toLocaleDateString("en", { weekday: "short" });
              return (
                <div key={date} className="flex flex-col items-center gap-1 flex-1">
                  <div className="w-full flex items-end" style={{ height: "64px" }}>
                    <div className="w-full rounded-t-md transition-all duration-500"
                      style={{
                        height: `${Math.max(pct, hours > 0 ? 8 : 2)}%`,
                        background: hours >= 7 ? "hsl(239 84% 67%)" : hours >= 5 ? "hsl(38 92% 50%)" : hours > 0 ? "hsl(0 72% 63%)" : "hsl(240 5% 16%)",
                      }}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground">{label}</span>
                  {hours > 0 && <span className="text-[9px] text-indigo-400 font-medium">{hours}h</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 7-day steps chart ── */}
      {stepsLogs.length > 0 && (
        <div className="rounded-2xl glass-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
            <Footprints className="h-4 w-4 text-emerald-400" /> Steps — Last 7 Days
          </h3>
          <div className="flex items-end gap-1.5 h-20">
            {last7.map(date => {
              const log = stepsLogs.find(l => l.log_date === date);
              const s = log?.steps ?? 0;
              const maxS = Math.max(...stepsLogs.filter(l => last7.includes(l.log_date)).map(l => l.steps ?? 0), 10000);
              const pct = (s / maxS) * 100;
              const label = new Date(date + "T00:00:00").toLocaleDateString("en", { weekday: "short" });
              return (
                <div key={date} className="flex flex-col items-center gap-1 flex-1">
                  <div className="w-full flex items-end" style={{ height: "64px" }}>
                    <div className="w-full rounded-t-md transition-all duration-500"
                      style={{
                        height: `${Math.max(pct, s > 0 ? 8 : 2)}%`,
                        background: s >= 10000 ? "hsl(142 71% 45%)" : s >= 5000 ? "hsl(38 92% 50%)" : s > 0 ? "hsl(0 72% 63%)" : "hsl(240 5% 16%)",
                      }}
                    />
                  </div>
                  <span className="text-[9px] text-muted-foreground">{label}</span>
                  {s > 0 && <span className="text-[9px] text-emerald-400 font-medium">{(s / 1000).toFixed(1)}k</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Weight history ── */}
      {bodyLogs.length > 1 && (
        <div className="rounded-2xl glass-card p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <Scale className="h-4 w-4 text-orange-400" /> Weight History
          </h3>
          <div className="space-y-1.5">
            {bodyLogs.slice(0, 6).map(log => (
              <div key={log.id} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{log.log_date}</span>
                <span className="font-medium text-foreground">{log.weight_kg} kg</span>
                {log.height_cm && (
                  <span className="text-muted-foreground">BMI {calcBMI(log.weight_kg!, log.height_cm).toFixed(1)}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────

function SummaryCard({ icon: Icon, iconColor, label, sub, value, valueColor }: {
  icon: React.ElementType; iconColor: string; label: string; sub: string; value: string; valueColor?: string;
}) {
  return (
    <div className="rounded-2xl glass-card p-3.5">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className={cn("h-3.5 w-3.5", iconColor)} />
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      </div>
      <p className={cn("text-xl font-bold", valueColor ?? "text-foreground")}>{value}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>
    </div>
  );
}

function Panel({ id, open, onToggle, icon: Icon, iconColor, title, subtitle, children }: {
  id: string; open: boolean; onToggle: () => void;
  icon: React.ElementType; iconColor: string; title: string; subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl glass-card overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center justify-between p-4 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-secondary/60 flex items-center justify-center">
            <Icon className={cn("h-4 w-4", iconColor)} />
          </div>
          <div className="text-left">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            <p className="text-[10px] text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}

function NumberInput({ label, value, onChange, placeholder, min, max, step }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder: string; min: number; max: number; step: number;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground mb-1.5 block">{label}</label>
      <input
        type="number" value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder} min={min} max={max} step={step}
        className="w-full rounded-xl bg-background/40 border border-border px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all"
      />
    </div>
  );
}

function SaveButton({ loading, onClick, disabled }: { loading: boolean; onClick: () => void; disabled: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={loading || disabled}
      className="w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
    >
      {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : <><Check className="h-4 w-4" /> Save</>}
    </button>
  );
}

function BMIPreview({ bmi }: { bmi: number }) {
  const cat = bmiCategory(bmi);
  const pct = Math.min(Math.max((bmi - 15) / (40 - 15), 0), 1) * 100;
  return (
    <div className="rounded-xl bg-secondary/40 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">BMI Preview</span>
        <span className={cn("text-sm font-bold", cat.color)}>{bmi.toFixed(1)} — {cat.label}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden relative" style={{ background: "linear-gradient(to right, hsl(38 92% 50%), hsl(142 71% 45%), hsl(38 92% 50%), hsl(0 72% 63%))" }}>
        <div className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full bg-white ring-2 ring-foreground/20 transition-all duration-300"
          style={{ left: `calc(${pct}% - 6px)` }} />
      </div>
      <div className="flex justify-between text-[9px] text-muted-foreground">
        <span>Under</span><span>Normal</span><span>Over</span><span>Obese</span>
      </div>
    </div>
  );
}

function StepsGuide({ steps }: { steps: number }) {
  const goals = [
    { label: "Sedentary", min: 0, max: 5000, color: "text-destructive" },
    { label: "Light", min: 5000, max: 7500, color: "text-warning" },
    { label: "Active", min: 7500, max: 10000, color: "text-primary" },
    { label: "Very active", min: 10000, max: Infinity, color: "text-success" },
  ];
  const current = goals.find(g => steps >= g.min && steps < g.max) ?? goals[0];
  if (!steps) return null;
  return (
    <p className={cn("text-xs font-medium text-center py-1", current.color)}>
      {steps.toLocaleString()} steps — {current.label}
    </p>
  );
}
