// ============================================================
// Query analysis types
// ============================================================

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
