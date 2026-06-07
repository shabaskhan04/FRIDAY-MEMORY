import type { FastifyInstance } from "fastify";
import { createServiceClient } from "../lib/supabase";

function groupKey(name: string): string {
  return name
    .replace(/\s*\([^)]*\)\s*$/, "")
    .toLowerCase()
    .trim();
}

function betterDisplayName(a: string, b: string): string {
  const aHasSuffix = /\([^)]*\)/.test(a);
  const bHasSuffix = /\([^)]*\)/.test(b);
  if (aHasSuffix && !bHasSuffix) return b;
  if (!aHasSuffix && bHasSuffix) return a;
  return a.length >= b.length ? a : b;
}

export async function peopleRoutes(app: FastifyInstance): Promise<void> {
  // GET /people
  app.get("/people", async (_request, reply) => {
    try {
      const supabase = createServiceClient();

      const { data: entityData, error: entityError } = await supabase
        .from("entity_ledger")
        .select("id, name, interaction_type, trust_signal, ledger_note, raw_ledger_id");

      if (entityError) {
        console.error("[people] entity_ledger fetch error:", entityError);
        return reply.code(500).send({ error: "Failed to fetch people." });
      }

      if (!entityData || entityData.length === 0) {
        return reply.send({ people: [] });
      }

      const rawIds = [
        ...new Set((entityData as { raw_ledger_id: string }[]).map((e) => e.raw_ledger_id)),
      ];

      const { data: rawData } = await supabase
        .from("raw_ledgers")
        .select("id, created_at")
        .in("id", rawIds);

      const tsMap: Record<string, string> = {};
      for (const r of (rawData ?? []) as { id: string; created_at: string }[]) {
        tsMap[r.id] = r.created_at;
      }

      type GroupedEntry = {
        name: string;
        interaction_type: string;
        latest_note: string;
        trust_signals: string[];
        entry_count: number;
        last_seen: string;
        raw_ledger_ids: string[];
        name_variants: Set<string>;
      };

      const grouped: Record<string, GroupedEntry> = {};

      for (const entry of entityData as {
        name: string;
        interaction_type: string;
        trust_signal: string;
        ledger_note: string;
        raw_ledger_id: string;
      }[]) {
        const rawName = entry.name.trim();
        const key = groupKey(rawName);
        const ts = tsMap[entry.raw_ledger_id] ?? new Date(0).toISOString();

        if (!grouped[key]) {
          grouped[key] = {
            name: rawName,
            interaction_type: entry.interaction_type,
            latest_note: entry.ledger_note,
            trust_signals: [],
            entry_count: 0,
            last_seen: ts,
            raw_ledger_ids: [],
            name_variants: new Set([rawName]),
          };
        } else {
          grouped[key].name = betterDisplayName(grouped[key].name, rawName);
          grouped[key].name_variants.add(rawName);
        }

        grouped[key].entry_count++;
        grouped[key].trust_signals.push(entry.trust_signal);
        grouped[key].raw_ledger_ids.push(entry.raw_ledger_id);

        if (new Date(ts) > new Date(grouped[key].last_seen)) {
          grouped[key].last_seen = ts;
          grouped[key].latest_note = entry.ledger_note;
          grouped[key].interaction_type = entry.interaction_type;
        }
      }

      const people = Object.values(grouped).map((p) => {
        const counts = { positive: 0, negative: 0, neutral: 0 };
        for (const s of p.trust_signals) {
          if (s === "positive") counts.positive++;
          else if (s === "negative") counts.negative++;
          else counts.neutral++;
        }
        let dominant: "positive" | "negative" | "neutral" = "neutral";
        if (counts.positive >= counts.negative && counts.positive >= counts.neutral)
          dominant = "positive";
        else if (counts.negative >= counts.positive && counts.negative >= counts.neutral)
          dominant = "negative";

        return {
          name: p.name,
          name_variants: [...p.name_variants],
          interaction_type: p.interaction_type,
          latest_note: p.latest_note,
          trust_signals: p.trust_signals,
          entry_count: p.entry_count,
          last_seen: p.last_seen,
          raw_ledger_ids: p.raw_ledger_ids,
          dominant_trust: dominant,
        };
      });

      people.sort((a, b) => new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime());

      return reply.send({ people });
    } catch (err) {
      console.error("[people] unexpected error:", err);
      return reply.code(500).send({ error: "Internal server error." });
    }
  });

  // GET /people/:name
  app.get<{ Params: { name: string } }>("/people/:name", async (request, reply) => {
    try {
      const decodedName = decodeURIComponent(request.params.name);
      const canonicalKey = groupKey(decodedName);
      const supabase = createServiceClient();

      const { data: allEntries, error: entriesError } = await supabase
        .from("entity_ledger")
        .select("id, raw_ledger_id, name, interaction_type, trust_signal, ledger_note");

      if (entriesError) {
        return reply.code(500).send({ error: "Failed to fetch person data." });
      }

      const entries = (
        (allEntries ?? []) as {
          id: string;
          raw_ledger_id: string;
          name: string;
          interaction_type: string;
          trust_signal: string;
          ledger_note: string;
        }[]
      ).filter((e) => groupKey(e.name) === canonicalKey);

      if (entries.length === 0) {
        return reply.send({
          name: decodedName,
          entries: [],
          raw_ledgers: [],
          temporal_memories: [],
          linked_todos: [],
        });
      }

      const rawLedgerIds = entries.map((e) => e.raw_ledger_id);

      const [rawRes, temporalRes, todosRes] = await Promise.all([
        supabase
          .from("raw_ledgers")
          .select("id, content, created_at, intent_tag, local_timezone, location_text, device_type")
          .in("id", rawLedgerIds)
          .order("created_at", { ascending: false }),
        supabase
          .from("temporal_memories")
          .select("id, raw_ledger_id, time_horizon, estimated_date, era, event_summary")
          .in("raw_ledger_id", rawLedgerIds)
          .order("estimated_date", { ascending: false }),
        supabase
          .from("todo_tasks")
          .select("id, task_description, status, created_at")
          .in("raw_ledger_id", rawLedgerIds)
          .order("created_at", { ascending: false }),
      ]);

      const tsMap: Record<string, string> = {};
      for (const r of (rawRes.data ?? []) as { id: string; created_at: string }[]) {
        tsMap[r.id] = r.created_at;
      }

      const enrichedEntries = entries
        .map((e) => ({ ...e, created_at: tsMap[e.raw_ledger_id] ?? null }))
        .sort(
          (a, b) =>
            new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()
        );

      return reply.send({
        name: decodedName,
        entries: enrichedEntries,
        raw_ledgers: rawRes.data ?? [],
        temporal_memories: temporalRes.data ?? [],
        linked_todos: todosRes.data ?? [],
      });
    } catch (err) {
      console.error("[people/:name] unexpected error:", err);
      return reply.code(500).send({ error: "Internal server error." });
    }
  });
}
