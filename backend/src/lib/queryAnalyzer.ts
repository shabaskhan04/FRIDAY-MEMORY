import { SupabaseClient } from "@supabase/supabase-js";
import type { QueryType, DetectedEntity, RetrievalWeights, QueryAnalysis } from "@friday/shared";

const WEIGHT_PRESETS: Record<QueryType, RetrievalWeights> = {
  FACT_LOOKUP:    { semantic: 0.30, keyword: 0.45, entity: 0.15, recency: 0.10 },
  PERSON_SEARCH:  { semantic: 0.25, keyword: 0.30, entity: 0.35, recency: 0.10 },
  PROJECT_SEARCH: { semantic: 0.30, keyword: 0.25, entity: 0.35, recency: 0.10 },
  REFLECTION:     { semantic: 0.60, keyword: 0.15, entity: 0.10, recency: 0.15 },
  ADVICE:         { semantic: 0.65, keyword: 0.15, entity: 0.10, recency: 0.10 },
  TIMELINE:       { semantic: 0.30, keyword: 0.20, entity: 0.10, recency: 0.40 },
};

const REFLECTION_SIGNALS = ["pattern", "recurring", "tend to", "always", "usually", "often", "habit", "theme", "themes", "life", "journey", "typically", "keep"];
const ADVICE_SIGNALS      = ["should i", "what should", "how should", "advice", "recommend", "suggest", "help me decide"];
const TIMELINE_SIGNALS    = ["when did", "timeline", "history", "over time", "last week", "last month", "recently", "ago", "since", "before", "after"];

async function detectEntities(query: string, supabase: SupabaseClient): Promise<DetectedEntity[]> {
  const lower = query.toLowerCase();

  // Join entity_ledger with graph_nodes to get real node types
  const { data: ledgerRows } = await supabase
    .from("entity_ledger")
    .select("name")
    .order("name");

  const { data: nodeRows } = await supabase
    .from("graph_nodes")
    .select("name, node_type")
    .eq("is_archived", false);

  const nodeTypeMap = new Map<string, string>();
  for (const row of (nodeRows ?? []) as { name: string; node_type: string }[]) {
    nodeTypeMap.set(row.name.toLowerCase(), row.node_type);
  }

  if (!ledgerRows) return [];

  const seen = new Set<string>();
  const entities: DetectedEntity[] = [];

  for (const row of ledgerRows as { name: string }[]) {
    const nameLower = row.name.toLowerCase();
    if (seen.has(nameLower)) continue;
    seen.add(nameLower);

    if (lower.includes(nameLower)) {
      const rawType = nodeTypeMap.get(nameLower) ?? "PERSON";
      const type = (["PERSON", "PROJECT", "GOAL", "COMPANY", "PLACE"].includes(rawType)
        ? rawType
        : "PERSON") as DetectedEntity["type"];
      entities.push({ name: row.name, type, confidence: 1.0 });
    }
  }

  const words = query.split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    const w = words[i].replace(/[^a-zA-Z]/g, "");
    if (
      w.length > 2 &&
      /^[A-Z]/.test(w) &&
      !/^(The|A|An|In|On|At|To|For|Of|And|Or|But|Is|Was|What|When|How|Why|Who|Did|Do|Does|My|Me|I)$/.test(w)
    ) {
      const wl = w.toLowerCase();
      if (!entities.some((e) => e.name.toLowerCase() === wl)) {
        const rawType = nodeTypeMap.get(wl) ?? "PERSON";
        const type = (["PERSON", "PROJECT", "GOAL", "COMPANY", "PLACE"].includes(rawType)
          ? rawType
          : "PERSON") as DetectedEntity["type"];
        entities.push({ name: w, type, confidence: 0.5 });
      }
    }
  }

  return entities;
}

function classifyQuery(query: string, entities: DetectedEntity[]): QueryType {
  const lower = query.toLowerCase();
  if (REFLECTION_SIGNALS.some((s) => lower.includes(s))) return "REFLECTION";
  if (ADVICE_SIGNALS.some((s) => lower.includes(s)))      return "ADVICE";
  if (TIMELINE_SIGNALS.some((s) => lower.includes(s)))    return "TIMELINE";
  const hasPerson  = entities.some((e) => e.type === "PERSON"  && e.confidence >= 0.9);
  const hasProject = entities.some((e) => e.type === "PROJECT" && e.confidence >= 0.9);
  const hasGoal    = entities.some((e) => e.type === "GOAL"    && e.confidence >= 0.9);
  if (hasProject || hasGoal) return "PROJECT_SEARCH";
  if (hasPerson) return "PERSON_SEARCH";
  return "FACT_LOOKUP";
}

export async function analyzeQuery(rawQuery: string, supabase: SupabaseClient): Promise<QueryAnalysis> {
  const cleanedQuery = rawQuery.trim();
  const entities = await detectEntities(cleanedQuery, supabase);
  const queryType = classifyQuery(cleanedQuery, entities);
  const weights = WEIGHT_PRESETS[queryType];
  return { queryType, entities, weights, cleanedQuery };
}
