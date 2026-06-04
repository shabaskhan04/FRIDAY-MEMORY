import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> }
): Promise<NextResponse> {
  try {
    const { name } = await params;
    const decodedName = decodeURIComponent(name);
    const supabase = createClient();

    // entity_ledger has NO created_at — fetch without it
    const { data: entries, error: entriesError } = await supabase
      .from("entity_ledger")
      .select("id, raw_ledger_id, interaction_type, trust_signal, ledger_note")
      .ilike("name", decodedName);

    if (entriesError) {
      console.error("[people/name] entity_ledger error:", entriesError);
      return NextResponse.json({ error: "Failed to fetch person data.", detail: entriesError.message }, { status: 500 });
    }

    if (!entries || entries.length === 0) {
      return NextResponse.json({
        name: decodedName,
        entries: [],
        raw_ledgers: [],
        temporal_memories: [],
      }, { status: 200 });
    }

    const rawLedgerIds = entries.map((e) => e.raw_ledger_id as string);

    // Fetch raw_ledgers with timestamps (the source of truth for timing)
    const { data: rawLedgers, error: rawError } = await supabase
      .from("raw_ledgers")
      .select("id, content, created_at, intent_tag, local_timezone, location_text, device_type")
      .in("id", rawLedgerIds)
      .order("created_at", { ascending: false });

    if (rawError) console.error("[people/name] raw_ledgers error:", rawError);

    // Build a timestamp map to enrich entity entries
    const tsMap: Record<string, string> = {};
    for (const r of rawLedgers ?? []) {
      tsMap[r.id as string] = r.created_at as string;
    }

    // Enrich entries with timestamps from raw_ledgers
    const enrichedEntries = entries.map((e) => ({
      ...e,
      created_at: tsMap[e.raw_ledger_id as string] ?? null,
    })).sort((a, b) =>
      new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
    );

    // Temporal memories linked to this person's raw ledgers
    const { data: temporalMemories, error: temporalError } = await supabase
      .from("temporal_memories")
      .select("id, raw_ledger_id, time_horizon, estimated_date, era, event_summary")
      .in("raw_ledger_id", rawLedgerIds)
      .order("estimated_date", { ascending: false });

    if (temporalError) console.error("[people/name] temporal_memories error:", temporalError);

    // Todos linked to this person's raw ledgers
    const { data: linkedTodos } = await supabase
      .from("todo_tasks")
      .select("id, task_description, status, created_at")
      .in("raw_ledger_id", rawLedgerIds)
      .order("created_at", { ascending: false });

    return NextResponse.json(
      {
        name: decodedName,
        entries: enrichedEntries,
        raw_ledgers: rawLedgers ?? [],
        temporal_memories: temporalMemories ?? [],
        linked_todos: linkedTodos ?? [],
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[people/name] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error." }, { status: 500 });
  }
}
