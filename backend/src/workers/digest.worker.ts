/**
 * digest.worker.ts
 *
 * Standalone PM2 cron process — runs weekly on Monday at 08:00.
 * PM2 config: cron_restart: "0 8 * * 1", exec_mode: "fork", autorestart: false
 *
 * Generates the weekly summary and stores it in Supabase so the
 * frontend can read it without triggering an expensive Groq call.
 *
 * Also safe to run manually: npx tsx src/workers/digest.worker.ts
 */
import "dotenv/config";
import { generateWeeklySummary } from "../routes/weekly-summary";
import { createServiceClient } from "../lib/supabase";

async function main(): Promise<void> {
  console.log("[digest.worker] Starting weekly digest generation…");

  try {
    const summary = await generateWeeklySummary();

    // Persist to Supabase so the frontend can read it instantly
    const supabase = createServiceClient();
    const { error } = await supabase.from("weekly_summaries").upsert(
      {
        week_start: summary.week_start,
        week_end: summary.week_end,
        payload: summary,
        generated_at: new Date().toISOString(),
      },
      { onConflict: "week_start" }
    );

    if (error) {
      console.error("[digest.worker] Failed to persist summary:", error.message);
      // Don't exit(1) — summary was generated, just couldn't persist
    } else {
      console.log(
        `[digest.worker] Done — ${summary.entry_count} memories summarised for week starting ${summary.week_start}`
      );
    }

    process.exit(0);
  } catch (err) {
    console.error("[digest.worker] Fatal error:", err);
    process.exit(1);
  }
}

void main();
