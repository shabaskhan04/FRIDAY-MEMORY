/**
 * reflect.worker.ts
 *
 * Standalone PM2 cron process — runs daily at 03:00.
 * PM2 config: cron_restart: "0 3 * * *", exec_mode: "fork", autorestart: false
 *
 * Also safe to run manually: npx tsx src/workers/reflect.worker.ts
 */
import { runReflection } from "../routes/memory/reflect";
import { getObservationService } from "../lib/intelligence";
import { getFridayUserId } from "../lib/supabase";

// Ensure env is loaded when run directly
import "dotenv/config";

async function main(): Promise<void> {
  const hoursBack = parseInt(process.env.REFLECT_HOURS_BACK ?? "24", 10);
  console.log(`[reflect.worker] Starting — analysing last ${hoursBack}h of memories…`);

  try {
    // Drain any observations that were saved but never processed
    const drained = await getObservationService().drainUnprocessed(getFridayUserId());
    if (drained > 0) console.log(`[reflect.worker] Drained ${drained} unprocessed observations.`);

    const result = await runReflection(hoursBack);

    if (result.status === "ok") {
      console.log(`[reflect.worker] Done — ${result.insights_saved ?? 0} insights saved.`);
    } else {
      console.log(`[reflect.worker] Skipped — ${result.reason ?? "unknown reason"}`);
    }

    process.exit(0);
  } catch (err) {
    console.error("[reflect.worker] Fatal error:", err);
    process.exit(1);
  }
}

void main();
