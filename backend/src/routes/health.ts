import type { FastifyInstance } from "fastify";
import { getAIRouter } from "../lib/intelligence";
import { createServiceClient } from "../lib/supabase";
import type { HealthLog, HealthAnalysis, HealthLogRequestBody } from "@friday/shared";

// ── CRUD ─────────────────────────────────────────────────────

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (_request, reply) => {
    try {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("health_logs")
        .select("*")
        .order("log_date", { ascending: false })
        .limit(90);

      if (error) {
        console.error("[health] fetch error:", error);
        return reply.code(500).send({ error: "Failed to fetch health logs." });
      }

      return reply.send({ logs: (data ?? []) as HealthLog[] });
    } catch (err) {
      console.error("[health] GET unexpected error:", err);
      return reply.code(500).send({ error: "Internal server error." });
    }
  });

  app.post<{ Body: HealthLogRequestBody }>("/health", async (request, reply) => {
    const body = request.body;

    const VALID_METRIC_TYPES = ["sleep", "steps", "body"] as const;
    if (!body.metric_type || !VALID_METRIC_TYPES.includes(body.metric_type)) {
      return reply.code(400).send({
        error: `metric_type must be one of: ${VALID_METRIC_TYPES.join(", ")}.`,
      });
    }

    if (!body.log_date || !/^\d{4}-\d{2}-\d{2}$/.test(body.log_date)) {
      return reply.code(400).send({ error: "log_date must be YYYY-MM-DD." });
    }

    const record: Record<string, unknown> = {
      log_date: body.log_date,
      metric_type: body.metric_type,
    };

    if (body.metric_type === "sleep") {
      if (body.sleep_hours !== undefined) record.sleep_hours = body.sleep_hours;
      if (body.sleep_quality !== undefined) record.sleep_quality = body.sleep_quality;
    } else if (body.metric_type === "steps") {
      if (body.steps !== undefined) record.steps = body.steps;
    } else if (body.metric_type === "body") {
      if (body.weight_kg !== undefined) record.weight_kg = body.weight_kg;
      if (body.height_cm !== undefined) record.height_cm = body.height_cm;
    }

    if (body.notes) record.notes = body.notes;

    try {
      const supabase = createServiceClient();
      const { data, error } = await supabase
        .from("health_logs")
        .upsert(record, { onConflict: "log_date,metric_type" })
        .select()
        .single();

      if (error) {
        console.error("[health] POST upsert error:", error);
        return reply.code(500).send({ error: "Failed to save health log.", detail: error.message });
      }

      return reply.code(201).send({ log: data });
    } catch (err) {
      console.error("[health] POST unexpected error:", err);
      return reply.code(500).send({ error: "Internal server error." });
    }
  });

  // ── AI Analysis ─────────────────────────────────────────────

  app.get("/health/analyze", async (_request, reply) => {
    try {
      const supabase = createServiceClient();

      const { data: logs, error } = await supabase
        .from("health_logs")
        .select("*")
        .order("log_date", { ascending: false })
        .limit(90);

      if (error) {
        return reply.code(500).send({ error: "Failed to fetch health logs for analysis." });
      }

      if (!logs || logs.length === 0) {
        return reply.code(200).send({
          readiness_score: 0,
          readiness_label: "No data",
          readiness_color: "red",
          sleep_score: 0,
          activity_score: 0,
          consistency_score: 0,
          sleep_debt_hours: null,
          avg_sleep_7d: null,
          avg_steps_7d: null,
          insights: ["No health data recorded yet."],
          nudges: ["Start logging your sleep and steps to get personalised insights."],
          pattern_alert: null,
          bmi: null,
          bmi_label: null,
          bmi_trend: null,
          week_summary: "No data available.",
        } satisfies HealthAnalysis);
      }

      const SYSTEM_PROMPT = `You are Friday's health intelligence engine. Analyse the provided 90-day health log data and return a structured JSON analysis.

Return ONLY valid JSON — no markdown, no preamble:
{
  "readiness_score": <0–100 integer>,
  "readiness_label": "Optimal" | "Good" | "Fair" | "Low" | "Rest day",
  "readiness_color": "green" | "yellow" | "orange" | "red",
  "sleep_score": <0–100>,
  "activity_score": <0–100>,
  "consistency_score": <0–100>,
  "sleep_debt_hours": <number or null>,
  "avg_sleep_7d": <number or null>,
  "avg_steps_7d": <number or null>,
  "insights": ["Specific data-backed insight 1", "..."],
  "nudges": ["Actionable nudge 1", "..."],
  "pattern_alert": "Most important pattern or anomaly (1 sentence, or null)",
  "bmi": <number or null>,
  "bmi_label": "Underweight" | "Normal" | "Overweight" | "Obese" | null,
  "bmi_trend": "improving" | "stable" | "worsening" | null,
  "week_summary": "2-sentence narrative of the past 7 days."
}`;

      const logsJson = JSON.stringify(logs, null, 0);

      const raw = await getAIRouter().generate(
        "health_analysis",
        SYSTEM_PROMPT,
        `Health logs (90 days):\n${logsJson}`,
        { temperature: 0.2, maxTokens: 1024 }
      );
      const cleaned = raw.replace(/```json|```/g, "").trim();

      let analysis: HealthAnalysis;
      try {
        analysis = JSON.parse(cleaned) as HealthAnalysis;
      } catch {
        return reply.code(500).send({ error: "Groq returned malformed JSON for health analysis." });
      }

      return reply.send(analysis);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Health analysis failed.";
      console.error("[health/analyze] error:", err);
      return reply.code(500).send({ error: message });
    }
  });
}
