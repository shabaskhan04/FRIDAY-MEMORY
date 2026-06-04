import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";

export async function GET(): Promise<NextResponse> {
  try {
    const supabase = createClient();

    // entity_ledger may NOT have created_at — use raw_ledger_id join for timestamps
    const { data: entityData, error: entityError } = await supabase
      .from("entity_ledger")
      .select("id, name, interaction_type, trust_signal, ledger_note, raw_ledger_id");

    if (entityError) {
      console.error("[people] entity_ledger fetch error:", entityError);
      return NextResponse.json({ error: "Failed to fetch people." }, { status: 500 });
    }

    if (!entityData || entityData.length === 0) {
      return NextResponse.json({ people: [] }, { status: 200 });
    }

    // Get raw_ledger timestamps for all referenced ledgers
    const rawIds = [...new Set((entityData).map((e) => e.raw_ledger_id as string))];
    const { data: rawData } = await supabase
      .from("raw_ledgers")
      .select("id, created_at")
      .in("id", rawIds);

    const tsMap: Record<string, string> = {};
    for (const r of rawData ?? []) {
      tsMap[r.id as string] = r.created_at as string;
    }

    // Group by name (case-insensitive)
    const grouped: Record<string, {
      name: string;
      interaction_type: string;
      latest_note: string;
      trust_signals: string[];
      entry_count: number;
      last_seen: string;
      raw_ledger_ids: string[];
    }> = {};

    for (const entry of entityData) {
      const key = (entry.name as string).toLowerCase().trim();
      const ts = tsMap[entry.raw_ledger_id as string] ?? new Date(0).toISOString();

      if (!grouped[key]) {
        grouped[key] = {
          name: (entry.name as string).trim(),
          interaction_type: entry.interaction_type as string,
          latest_note: entry.ledger_note as string,
          trust_signals: [],
          entry_count: 0,
          last_seen: ts,
          raw_ledger_ids: [],
        };
      }
      grouped[key].entry_count++;
      grouped[key].trust_signals.push(entry.trust_signal as string);
      grouped[key].raw_ledger_ids.push(entry.raw_ledger_id as string);
      if (new Date(ts) > new Date(grouped[key].last_seen)) {
        grouped[key].last_seen = ts;
        grouped[key].latest_note = entry.ledger_note as string;
        grouped[key].interaction_type = entry.interaction_type as string;
      }
    }

    // Determine dominant trust signal per person
    const people = Object.values(grouped).map((p) => {
      const counts = { positive: 0, negative: 0, neutral: 0 };
      for (const s of p.trust_signals) {
        if (s === "positive") counts.positive++;
        else if (s === "negative") counts.negative++;
        else counts.neutral++;
      }
      let dominant: "positive" | "negative" | "neutral" = "neutral";
      if (counts.positive >= counts.negative && counts.positive >= counts.neutral) dominant = "positive";
      else if (counts.negative >= counts.positive && counts.negative >= counts.neutral) dominant = "negative";
      return { ...p, dominant_trust: dominant };
    });

    people.sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime());

    return NextResponse.json({ people }, { status: 200 });
  } catch (err) {
    console.error("[people] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
