/**
 * FRIDAY Query Analyzer
 *
 * Classifies queries and extracts named entities from the
 * entity_ledger table so retrieval weights adjust dynamically.
 */

import { SupabaseClient } from "@supabase/supabase-js";

export type QueryType =
  | "FACT_LOOKUP"
  | "PERSON_SEARCH"
  | "PROJECT_SEARCH"
  | "REFLECTION"
  | "ADVICE"
  | "TIMELINE";

export interface DetectedEntity {
  name: string;
  type: "PERSON" | "PROJECT";
  confidence: number;
}

export interface RetrievalWeights {
  semantic: number;
  keyword: number;
  entity: number;
  recency: number;
}

export interface QueryAnalysis {
  queryType: QueryType;
  entities: DetectedEntity[];
  weights: RetrievalWeights;
  cleanedQuery: string;
}

// ─── Weight presets ────────────────────────────────────────────────────────
//
// Recency uses a flat 2-tier score: 1.0 for memories <30 days old, 0.9 for
// everything older. The maximum possible recency contribution per query type
// is therefore: weight.recency * 1.0 (recent) vs weight.recency * 0.9 (old).
// The 0.1-point difference is intentionally small — enough to break ties
// between otherwise equal memories, without burying older ones.

const WEIGHT_PRESETS: Record<QueryType, RetrievalWeights> = {
  FACT_LOOKUP:    { semantic: 0.30, keyword: 0.45, entity: 0.15, recency: 0.10 },
  PERSON_SEARCH:  { semantic: 0.25, keyword: 0.30, entity: 0.35, recency: 0.10 },
  PROJECT_SEARCH: { semantic: 0.30, keyword: 0.25, entity: 0.35, recency: 0.10 },
  REFLECTION:     { semantic: 0.60, keyword: 0.15, entity: 0.10, recency: 0.15 },
  ADVICE:         { semantic: 0.65, keyword: 0.15, entity: 0.10, recency: 0.10 },
  TIMELINE:       { semantic: 0.30, keyword: 0.20, entity: 0.10, recency: 0.40 },
};

// ─── Signal word lists ─────────────────────────────────────────────────────

const REFLECTION_SIGNALS = ["pattern", "recurring", "tend to", "always", "usually", "often", "habit", "theme", "themes", "life", "journey", "typically", "keep"];
const ADVICE_SIGNALS      = ["should i", "what should", "how should", "advice", "recommend", "suggest", "help me decide"];
const TIMELINE_SIGNALS    = ["when did", "timeline", "history", "over time", "last week", "last month", "recently", "ago", "since", "before", "after"];

// ─── Entity matching against entity_ledger ─────────────────────────────────

async function detectEntities(
  query: string,
  supabase: SupabaseClient
): Promise<DetectedEntity[]> {
  const lower = query.toLowerCase();

  // Fetch all distinct names from entity_ledger (cached in practice by Supabase)
  const { data } = await supabase
    .from("entity_ledger")
    .select("name")
    .order("name");

  if (!data) return [];

  const seen = new Set<string>();
  const entities: DetectedEntity[] = [];

  for (const row of data as { name: string }[]) {
    const nameLower = row.name.toLowerCase();
    if (seen.has(nameLower)) continue;
    seen.add(nameLower);

    if (lower.includes(nameLower)) {
      entities.push({
        name: row.name,
        type: "PERSON",
        confidence: 1.0,
      });
    }
  }

  // Heuristic: capitalized mid-sentence words not already found
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
        entities.push({ name: w, type: "PERSON", confidence: 0.5 });
      }
    }
  }

  return entities;
}

// ─── Classification ────────────────────────────────────────────────────────

function classifyQuery(query: string, entities: DetectedEntity[]): QueryType {
  const lower = query.toLowerCase();

  if (REFLECTION_SIGNALS.some((s) => lower.includes(s))) return "REFLECTION";
  if (ADVICE_SIGNALS.some((s) => lower.includes(s)))      return "ADVICE";
  if (TIMELINE_SIGNALS.some((s) => lower.includes(s)))    return "TIMELINE";

  const hasPerson = entities.some((e) => e.type === "PERSON" && e.confidence >= 0.9);
  if (hasPerson) return "PERSON_SEARCH";

  return "FACT_LOOKUP";
}

// ─── Main export ───────────────────────────────────────────────────────────

export async function analyzeQuery(
  rawQuery: string,
  supabase: SupabaseClient
): Promise<QueryAnalysis> {
  const cleanedQuery = rawQuery.trim();
  const entities = await detectEntities(cleanedQuery, supabase);
  const queryType = classifyQuery(cleanedQuery, entities);
  const weights = WEIGHT_PRESETS[queryType];

  return { queryType, entities, weights, cleanedQuery };
}
