// ============================================================
// graph.query-resolver.ts — Rule-based NL query classification
// No LLM calls. Pure pattern matching.
// ============================================================

export type QueryType =
  | 'PERSON_SEARCH'
  | 'PROJECT_SEARCH'
  | 'GOAL_SEARCH'
  | 'RELATIONSHIP_SEARCH'
  | 'PATH_SEARCH'
  | 'ENTITY_SEARCH';

export interface QueryAnalysis {
  queryType:        QueryType;
  entities:         string[];   // extracted entity names from the query
  confidence:       number;     // 0–1
  relationshipType?: string;    // explicit rel type for RELATIONSHIP_SEARCH queries
}

// ---- Pattern banks (order matters — most specific first) ----

// Maps query patterns to a relType — capture group 1 is the target entity (may be empty for "my X" forms)
const DIRECTED_REL_PATTERNS: Array<{ pattern: RegExp; relType: string }> = [
  // OWNS
  { pattern: /who\s+owns?\s+(.+)/i,                                           relType: 'OWNS' },
  { pattern: /who\s+is\s+the\s+owner\s+of\s+(.+)/i,                          relType: 'OWNS' },
  { pattern: /what\s+(?:owns?|is\s+owned\s+by)\s+(.+)/i,                     relType: 'OWNS' },
  // WORKS_ON
  { pattern: /who\s+works?\s+on\s+(.+)/i,                                     relType: 'WORKS_ON' },
  { pattern: /who\s+is\s+working\s+on\s+(.+)/i,                               relType: 'WORKS_ON' },
  { pattern: /who\s+(?:is\s+building|built|develops?)\s+(.+)/i,               relType: 'WORKS_ON' },
  // COFOUNDER
  { pattern: /who\s+(?:co-?founded|founded|started|created)\s+(.+)/i,         relType: 'COFOUNDER' },
  { pattern: /who\s+are\s+my\s+co-?founders?/i,                               relType: 'COFOUNDER' },
  { pattern: /who\s+is\s+my\s+co-?founder/i,                                  relType: 'COFOUNDER' },
  // BUSINESS_PARTNER
  { pattern: /who\s+are\s+my\s+business\s+partners?/i,                        relType: 'BUSINESS_PARTNER' },
  { pattern: /who\s+is\s+my\s+business\s+partner/i,                           relType: 'BUSINESS_PARTNER' },
  { pattern: /who\s+is\s+(?:a\s+)?(?:business\s+)?partner\s+(?:of|with)\s+(.+)/i, relType: 'BUSINESS_PARTNER' },
  // WORKS_WITH
  { pattern: /who\s+works?\s+with\s+(.+)/i,                                   relType: 'WORKS_WITH' },
  { pattern: /who\s+collaborates?\s+with\s+(.+)/i,                            relType: 'WORKS_WITH' },
  // MANAGES
  { pattern: /who\s+manages?\s+(.+)/i,                                        relType: 'MANAGES' },
  // CONNECTED_TO
  { pattern: /who\s+is\s+connected\s+to\s+(.+)/i,                             relType: 'CONNECTED_TO' },
  { pattern: /what\s+(?:is|are)\s+(.+?)\s+(?:connected|related)\s+to/i,       relType: 'CONNECTED_TO' },
  // RELATED_TO
  { pattern: /what\s+organizations?\s+(?:are\s+)?(?:related|connected)\s+to\s+(.+)/i, relType: 'RELATED_TO' },
  // GOAL_OF
  { pattern: /what\s+(?:are\s+(?:the\s+)?)?goals?\s+(?:of|for)\s+(.+)/i,     relType: 'GOAL_OF' },
];

const RELATIONSHIP_PATTERNS = [
  /relationship between (.+?) and (.+)/i,
  /how (?:is|are) (.+?) (?:connected|related) to (.+)/i,
  /(?:link|connection|path) (?:between|from) (.+?) (?:to|and) (.+)/i,
  /what connects (.+?) (?:to|and) (.+)/i,
];

// PATH_SEARCH: multi-hop path queries between two named entities
const PATH_PATTERNS = [
  /(?:show|find|what is) (?:the )?(?:relationship )?path (?:between|from) (.+?) (?:to|and) (.+)/i,
  /how is (.+?) connected to (.+)/i,
  /how are (.+?) and (.+?) connected/i,
  /(?:trace|what links) (.+?) (?:to|and) (.+)/i,
];

const PERSON_PATTERNS = [
  /(?:discussed?|talked?|spoke?|spoke with|spoken with|mentioned) (?:with|to|about)? ?(.+)/i,
  /who (?:is|are|was|were) (.+)/i,
  /tell me about (.+?) (?:the person|the client|the friend)/i,
  /(?:about|regarding) (.+?) (?:person|client|friend|colleague)/i,
];

const GOAL_PATTERNS = [
  /(?:projects?|things?) (?:support|related to|connected to|aligned with) (?:my )?([\w\s]+) goal/i,
  /(?:what|which) (?:goals?|targets?|objectives?) (?:am i|are) (?:working on|pursuing|tracking)/i,
  /(?:fitness|health|business|learning|career) (?:goal|target|objective)/i,
  /goal(?:s)? (?:for|about|regarding) (.+)/i,
];

const PROJECT_PATTERNS = [
  /(?:what|who|which) (?:is|are) connected to (.+)/i,
  /tell me about (?:the )?(?:project )?(.+)/i,
  /(?:what|who) (?:works on|is part of|is involved in) (.+)/i,
  /(?:project|work|build|develop) (.+)/i,
];

// ---- Entity extraction helpers ------------------------------

const STOP_WORDS = new Set([
  'what', 'who', 'which', 'how', 'is', 'are', 'the', 'a', 'an',
  'my', 'i', 'me', 'to', 'with', 'and', 'or', 'for', 'in', 'on',
  'about', 'of', 'have', 'has', 'been', 'being', 'tell', 'show',
  'discussed', 'talked', 'spoke', 'mentioned', 'connected', 'related',
]);

function extractEntitiesFromCaptures(matches: RegExpMatchArray): string[] {
  return matches
    .slice(1)
    .filter(Boolean)
    .map(s => s.trim().replace(/[?!.,]+$/, ''))
    .filter(s => s.length > 1 && !STOP_WORDS.has(s.toLowerCase()));
}

function extractNounPhrases(query: string): string[] {
  // Extract capitalized words/phrases as likely entities
  const capitalized = query.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*/g) ?? [];

  // Also grab quoted phrases
  const quoted = [...query.matchAll(/"([^"]+)"/g)].map(m => m[1]);

  return [...new Set([...capitalized, ...quoted])].filter(
    e => !STOP_WORDS.has(e.toLowerCase()),
  );
}

// ---- Main classifier ----------------------------------------

export function resolveQuery(query: string): QueryAnalysis {
  const q = query.trim();
  console.log("[QUERY CLASSIFIER]", q);

  // 0. Directed relationship patterns (most specific — check before everything else)
  for (const { pattern, relType } of DIRECTED_REL_PATTERNS) {
    const m = q.match(pattern);
    if (m) {
      const entities = extractEntitiesFromCaptures(m);
      const result: QueryAnalysis = {
        queryType:        'RELATIONSHIP_SEARCH',
        relationshipType: relType,
        entities,
        confidence:       0.95,
      };
      console.log("[CLASSIFIED TYPE]", result.queryType);
      console.log("[CLASSIFIED REL]", result.relationshipType);
      return result;
    }
  }

  // 1. Path patterns — two named entities, asking for the connection path
  for (const pattern of PATH_PATTERNS) {
    const m = q.match(pattern);
    if (m) {
      const result: QueryAnalysis = {
        queryType:  'PATH_SEARCH',
        entities:   extractEntitiesFromCaptures(m),
        confidence: 0.95,
      };
      console.log("[CLASSIFIED TYPE]", result.queryType); console.log("[CLASSIFIED REL]", "(none)");
      return result;
    }
  }

  // 2. Relationship patterns (most specific — check first)
  for (const pattern of RELATIONSHIP_PATTERNS) {
    const m = q.match(pattern);
    if (m) {
      const result: QueryAnalysis = { queryType: 'RELATIONSHIP_SEARCH', entities: extractEntitiesFromCaptures(m), confidence: 0.9 };
      console.log("[CLASSIFIED TYPE]", result.queryType); console.log("[CLASSIFIED REL]", "(none)");
      return result;
    }
  }

  // 2. Person patterns
  for (const pattern of PERSON_PATTERNS) {
    const m = q.match(pattern);
    if (m) {
      const result: QueryAnalysis = { queryType: 'PERSON_SEARCH', entities: extractEntitiesFromCaptures(m), confidence: 0.85 };
      console.log("[CLASSIFIED TYPE]", result.queryType); console.log("[CLASSIFIED REL]", "(none)");
      return result;
    }
  }

  // 3. Goal patterns
  for (const pattern of GOAL_PATTERNS) {
    const m = q.match(pattern);
    if (m) {
      const result: QueryAnalysis = { queryType: 'GOAL_SEARCH', entities: extractEntitiesFromCaptures(m), confidence: 0.85 };
      console.log("[CLASSIFIED TYPE]", result.queryType); console.log("[CLASSIFIED REL]", "(none)");
      return result;
    }
  }

  // 4. Project patterns
  for (const pattern of PROJECT_PATTERNS) {
    const m = q.match(pattern);
    if (m) {
      const result: QueryAnalysis = { queryType: 'PROJECT_SEARCH', entities: extractEntitiesFromCaptures(m), confidence: 0.75 };
      console.log("[CLASSIFIED TYPE]", result.queryType); console.log("[CLASSIFIED REL]", "(none)");
      return result;
    }
  }

  // 5. Fallback: extract noun phrases, classify as ENTITY_SEARCH
  const result: QueryAnalysis = { queryType: 'ENTITY_SEARCH', entities: extractNounPhrases(q), confidence: 0.5 };
  console.log("[CLASSIFIED TYPE]", result.queryType); console.log("[CLASSIFIED REL]", "(none)");
  return result;
}
