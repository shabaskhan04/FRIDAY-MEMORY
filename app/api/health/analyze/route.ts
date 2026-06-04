import { NextResponse } from "next/server";
import Groq from "groq-sdk";
import { createClient } from "@/lib/supabase";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ============================================================
// Types
// ============================================================

interface HealthLog {
  log_date: string;
  metric_type: "sleep" | "steps" | "body";
  sleep_hours?: number;
  sleep_quality?: string;
  steps?: number;
  weight_kg?: number;
  height_cm?: number;
  notes?: string;
}

interface HealthAnalysis {
  readiness_score: number;          // 0–100
  readiness_label: string;          // "Optimal" | "Good" | "Fair" | "Low" | "Rest day"
  readiness_color: "green" | "yellow" | "orange" | "red";

  sleep_score: number;              // 0–100
  activity_score: number;           // 0–100
  consistency_score: number;        // 0–100 (how consistent over 7 days)

  sleep_debt_hours: number;         // cumulative deficit vs 8h target over 7 days
  avg_sleep_7d: number;
  avg_steps_7d: number;

  insights: string[];               // 2–4 sharp, specific observations
  nudges: string[];                 // 2–3 concrete action items for today
  pattern_alert: string | null;     // single urgent warning or null

  bmi: number | null;
  bmi_label: string | null;
  bmi_trend: "improving" | "stable" | "worsening" | null;

  week_summary: string;             // 1–2 sentence natural language summary
}

// ============================================================
// System prompt
// ============================================================

const HEALTH_PROMPT = `You are FRIDAY's health intelligence engine. You receive structured health logs and output a precise JSON analysis. Be clinical but conversational. Never be generic — every insight must reference the actual numbers.

Output EXACTLY this JSON (no markdown, no extra keys):
{
  "readiness_score": <integer 0-100, weighted: sleep 50%, activity 30%, consistency 20%>,
  "readiness_label": <"Optimal" | "Good" | "Fair" | "Low" | "Rest day">,
  "readiness_color": <"green" | "yellow" | "orange" | "red">,

  "sleep_score": <integer 0-100>,
  "activity_score": <integer 0-100>,
  "consistency_score": <integer 0-100>,

  "sleep_debt_hours": <number, cumulative deficit vs 8h/night over logged nights>,
  "avg_sleep_7d": <number, average sleep hours over last 7 days>,
  "avg_steps_7d": <integer, average steps over last 7 days>,

  "insights": [<2-4 specific observations referencing actual numbers>],
  "nudges": [<2-3 concrete actions for today, not generic advice>],
  "pattern_alert": <single urgent warning string if a concerning pattern exists, otherwise null>,

  "bmi": <number or null>,
  "bmi_label": <"Underweight" | "Normal" | "Overweight" | "Obese" | null>,
  "bmi_trend": <"improving" | "stable" | "worsening" | null — compare last 2 body logs>,

  "week_summary": <1-2 sentence plain English summary of the week's health>
}

Scoring rules:
- sleep_score: 100 if avg >= 8h + quality good/great. Deduct 10 per hour below 7h. Deduct 15 for poor quality.
- activity_score: 100 if avg >= 10000 steps. Scale linearly. 0 if no step data.
- consistency_score: 100 if logged every day. Deduct 14 per missing day. Deduct 10 for high variance (std dev > 1.5h sleep or > 3000 steps).
- readiness_score: (sleep_score * 0.5) + (activity_score * 0.3) + (consistency_score * 0.2), rounded.
- readiness_label: 85+ = Optimal, 70+ = Good, 50+ = Fair, 30+ = Low, <30 = Rest day.
- readiness_color: Optimal/Good = green, Fair = yellow, Low = orange, Rest day = red.`;

// ============================================================
// GET /api/health/analyze
// ============================================================

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = createClient();

    // Pull last 30 days of health logs
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoff = thirtyDaysAgo.toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("health_logs")
      .select("*")
      .gte("log_date", cutoff)
      .order("log_date", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const logs = (data ?? []) as HealthLog[];

    // Need at least one log to analyze
    if (logs.length === 0) {
      return NextResponse.json({
        error: "no_data",
        message: "Start logging sleep and steps to get your health analysis.",
      }, { status: 200 });
    }

    // Build context for Groq
    const sleepLogs = logs.filter(l => l.metric_type === "sleep");
    const stepsLogs = logs.filter(l => l.metric_type === "steps");
    const bodyLogs  = logs.filter(l => l.metric_type === "body");

    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return d.toISOString().split("T")[0];
    });

    const context = [
      `=== HEALTH DATA (last 30 days, most recent first) ===`,
      `Today: ${new Date().toISOString().split("T")[0]}`,
      ``,
      `=== SLEEP LOGS (${sleepLogs.length} entries) ===`,
      sleepLogs.length > 0
        ? sleepLogs.map(l =>
            `${l.log_date}: ${l.sleep_hours}h, quality=${l.sleep_quality ?? "not set"}${l.notes ? `, notes="${l.notes}"` : ""}`
          ).join("\n")
        : "No sleep data",
      ``,
      `=== STEPS LOGS (${stepsLogs.length} entries) ===`,
      stepsLogs.length > 0
        ? stepsLogs.map(l => `${l.log_date}: ${l.steps} steps`).join("\n")
        : "No steps data",
      ``,
      `=== BODY METRICS (${bodyLogs.length} entries) ===`,
      bodyLogs.length > 0
        ? bodyLogs.map(l =>
            `${l.log_date}: weight=${l.weight_kg}kg, height=${l.height_cm}cm`
          ).join("\n")
        : "No body metrics",
      ``,
      `=== LAST 7 DAYS COVERAGE ===`,
      `Days with sleep logged: ${sleepLogs.filter(l => last7Days.includes(l.log_date)).length}/7`,
      `Days with steps logged: ${stepsLogs.filter(l => last7Days.includes(l.log_date)).length}/7`,
    ].join("\n");

    // Call Groq
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
      temperature: 0.15,
      max_tokens: 1024,
      messages: [
        { role: "system", content: HEALTH_PROMPT },
        { role: "user", content: context },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    let analysis: HealthAnalysis;

    try {
      analysis = JSON.parse(raw) as HealthAnalysis;
    } catch {
      console.error("[health/analyze] Groq returned malformed JSON:", raw);
      return NextResponse.json({ error: "AI returned malformed JSON." }, { status: 500 });
    }

    // Persist the readiness score to health_scores table
    // (non-fatal if table doesn't exist yet)
    const today = new Date().toISOString().split("T")[0];
    try {
      await supabase
        .from("health_scores")
        .upsert({
          score_date: today,
          readiness_score: analysis.readiness_score,
          sleep_component: analysis.sleep_score,
          activity_component: analysis.activity_score,
          consistency_component: analysis.consistency_score,
          ai_summary: analysis.week_summary,
        }, { onConflict: "score_date" });
    } catch {
      // Table may not exist yet — silently continue
    }

    return NextResponse.json({ analysis }, { status: 200 });

  } catch (err) {
    console.error("[health/analyze] error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
