// ============================================================
// Health logging types
// ============================================================

export type MetricType = "sleep" | "steps" | "body";

export interface HealthLog {
  id?: string;
  log_date: string;
  metric_type: MetricType;
  sleep_hours?: number;
  sleep_quality?: "poor" | "fair" | "good" | "great";
  steps?: number;
  weight_kg?: number;
  height_cm?: number;
  notes?: string;
}

export interface HealthAnalysis {
  readiness_score: number;
  readiness_label: "Optimal" | "Good" | "Fair" | "Low" | "Rest day" | "No data";
  readiness_color: "green" | "yellow" | "orange" | "red";
  sleep_score: number;
  activity_score: number;
  consistency_score: number;
  sleep_debt_hours: number | null;
  avg_sleep_7d: number | null;
  avg_steps_7d: number | null;
  insights: string[];
  nudges: string[];
  pattern_alert: string | null;
  bmi: number | null;
  bmi_label: "Underweight" | "Normal" | "Overweight" | "Obese" | null;
  bmi_trend: "improving" | "stable" | "worsening" | null;
  week_summary: string;
}

export interface HealthLogRequestBody {
  metric_type: MetricType;
  log_date: string;
  sleep_hours?: number;
  sleep_quality?: string;
  steps?: number;
  weight_kg?: number;
  height_cm?: number;
  notes?: string;
}
