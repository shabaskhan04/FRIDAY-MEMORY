// ============================================================
// graph.types.ts — Core domain types for Friday Knowledge Graph
// ============================================================

export type NodeType =
  | 'PERSON' | 'PROJECT' | 'BUSINESS' | 'GOAL' | 'TASK'
  | 'EVENT' | 'LOCATION' | 'MEMORY' | 'HEALTH_METRIC'
  | 'CONCEPT' | 'DOCUMENT' | 'CUSTOM';

export type RelationshipType =
  | 'OWNS' | 'WORKS_ON' | 'CONNECTED_TO' | 'MENTIONED_WITH'
  | 'FRIEND_OF' | 'CLIENT_OF' | 'RELATED_TO' | 'PART_OF'
  | 'LOCATED_IN' | 'DEPENDS_ON' | 'CAUSED_BY' | 'GOAL_OF'
  | 'TRACKS' | 'ATTENDED' | 'INTERESTED_IN' | 'SPOKE_WITH'
  | 'REQUESTED' | 'MANAGES' | 'CREATED' | 'EMPLOYED_BY'
  // P4 — goal alignment
  | 'ALIGNS_WITH' | 'CONTRIBUTES_TO' | 'DISTRACTS_FROM'
  // Social / professional roles
  | 'BUSINESS_PARTNER' | 'COFOUNDER' | 'WORKS_WITH'
  | 'MANAGER_OF' | 'REPORTS_TO' | 'FAMILY_MEMBER';

export type EventType =
  | 'NODE_CREATED' | 'NODE_UPDATED' | 'NODE_MERGED'
  | 'EDGE_CREATED' | 'EDGE_UPDATED' | 'EDGE_REMOVED'
  | 'EDGE_PINNED'  | 'EDGE_UNPINNED'
  | 'SNAPSHOT_TAKEN' | 'SCORE_UPDATED'
  | 'CONTRADICTION_DETECTED' | 'CANONICAL_ASSIGNED';

// ============================================================
// DB row shapes (mirror Postgres columns exactly)
// ============================================================

export interface GraphNode {
  id: string;
  user_id: string;
  node_type: NodeType;
  name: string;
  description: string | null;
  aliases: string[];
  metadata: Record<string, unknown>;
  importance_score: number;
  confidence_score: number;
  source_count: number;       // P6: how many distinct sources support this node
  mention_count: number;
  last_mentioned_at: string;
  embedding: number[] | null;
  source_memory_ids: string[];
  canonical_id: string | null; // P1: stable identity across name changes
  is_archived: boolean;
  is_locked: boolean;
  created_at: string;
  updated_at: string;
}

export interface GraphEdge {
  id: string;
  user_id: string;
  source_node_id: string;
  target_node_id: string;
  relationship_type: RelationshipType;
  strength: number;
  confidence: number;
  source_count: number;       // P6: how many distinct sources support this edge
  mention_count: number;
  last_seen_at: string;
  metadata: Record<string, unknown>;
  source_memory_ids: string[];
  is_pinned: boolean;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface GraphSnapshot {
  id: string;
  user_id: string;
  snapshot: { nodes: GraphNode[]; edges: GraphEdge[] };
  node_count: number;
  edge_count: number;
  top_entities: SnapshotSummaryNode[];
  top_projects: SnapshotSummaryNode[];
  top_people:   SnapshotSummaryNode[];
  top_goals:    SnapshotSummaryNode[];
  trigger: string | null;
  created_at: string;
}

export interface GraphEvent {
  id: string;
  user_id: string;
  event_type: EventType;
  entity_id: string | null;
  entity_kind: 'node' | 'edge' | null;
  payload: Record<string, unknown>;
  created_at: string;
}

// ============================================================
// Input / DTO types
// ============================================================

export interface CreateNodeInput {
  user_id: string;
  node_type: NodeType;
  name: string;
  description?: string;
  aliases?: string[];
  metadata?: Record<string, unknown>;
  importance_score?: number;
  confidence_score?: number;
  embedding?: number[];
  source_memory_ids?: string[];
}

export interface UpdateNodeInput {
  name?: string;
  description?: string;
  aliases?: string[];
  metadata?: Record<string, unknown>;
  importance_score?: number;
  confidence_score?: number;
  embedding?: number[];
  is_archived?: boolean;
  is_locked?: boolean;
}

export interface CreateEdgeInput {
  user_id: string;
  source_node_id: string;
  target_node_id: string;
  relationship_type: RelationshipType;
  strength?: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
  source_memory_ids?: string[];
  is_pinned?: boolean;
}


// ============================================================
// Extraction pipeline types
// ============================================================

export interface ExtractedNode {
  name: string;
  node_type: NodeType;
  description?: string | null;
  aliases?: string[];
  confidence: number;
  metadata?: Record<string, unknown>;
}

export interface ExtractedEdge {
  source: string;            // node name
  target: string;            // node name
  relationship_type: RelationshipType;
  confidence: number;
  metadata?: Record<string, unknown>;
}

export interface ExtractionResult {
  nodes: ExtractedNode[];
  edges: ExtractedEdge[];
  raw_llm_response: string;
}

// ============================================================
// Duplicate detection
// ============================================================

export interface DuplicateCandidate {
  node: GraphNode;
  match_type: 'exact' | 'normalized' | 'alias' | 'semantic';
  similarity: number;        // 0–1
}

export interface MergeDecision {
  keep_id: string;
  merge_ids: string[];
  auto_approved: boolean;    // false = needs human approval
  confidence: number;
}

// ============================================================
// Traversal
// ============================================================

export interface NeighborhoodNode {
  node: GraphNode;
  depth: number;
  path: string[];            // node ids
}

export interface TraversalResult {
  root: GraphNode;
  neighbors: NeighborhoodNode[];
  edges: GraphEdge[];
}

// ============================================================
// Scoring
// ============================================================

export interface ScoringContext {
  mention_count: number;
  last_mentioned_at: Date;
  edge_count: number;
  avg_edge_strength: number;
}

export interface ScoreBreakdown {
  recency_score: number;
  frequency_score: number;
  connectivity_score: number;
  final_importance: number;
}

// ============================================================
// Insight types
// ============================================================

export interface GraphInsight {
  type: InsightType;
  title: string;
  description: string;
  entity_ids: string[];
  score: number;             // relevance of this insight
  generated_at: string;
}

export type InsightType =
  | 'MOST_CONNECTED'
  | 'RECENTLY_ACTIVE'
  | 'NEGLECTED_GOAL'
  | 'RISING_IMPORTANCE'
  | 'DISCONNECTED_PROJECT'
  | 'INACTIVE_PERSON'
  | 'GROWING_PROJECT'
  | 'EMERGING_ENTITY'
  | 'CROSS_DOMAIN_CONNECTION';

// ============================================================
// Search
// ============================================================

export interface GraphSearchResult {
  node: GraphNode;
  score: number;
  match_reason: 'exact' | 'alias' | 'semantic' | 'fuzzy';
}

export interface SearchGraphQuery {
  query: string;
  user_id: string;
  node_types?: NodeType[];
  limit?: number;
  embedding?: number[];
  min_importance?: number;
}

// ============================================================
// P1 — Canonical entities
// ============================================================

export interface CanonicalEntity {
  id: string;
  user_id: string;
  canonical_id: string;       // stable key, e.g. 'PROJECT_ORIN' — never changes
  display_name: string;
  entity_type: string;
  description: string | null;
  aliases: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateCanonicalEntityInput {
  user_id: string;
  canonical_id: string;
  display_name: string;
  entity_type: string;
  description?: string;
  aliases?: string[];
}

// ============================================================
// P2 — Structured snapshot summary
// ============================================================

export interface SnapshotSummaryNode {
  id: string;
  name: string;
  node_type: NodeType;
  importance_score: number;
}

export interface SnapshotComparison {
  from_snapshot_id: string;
  to_snapshot_id:   string;
  from_date:        string;
  to_date:          string;
  nodes_added:      number;
  nodes_removed:    number;
  edges_added:      number;
  edges_removed:    number;
  emerging_entities: SnapshotSummaryNode[];   // new + importance > avg
  declining_entities: SnapshotSummaryNode[];  // present in both, importance dropped
}

// ============================================================
// P3 — Attention engine
// ============================================================

export interface AttentionScore {
  node: GraphNode;
  attention_score:       number;  // 0–1 composite
  mention_score:         number;
  recency_score:         number;
  relationship_growth:   number;
  edge_activity:         number;
}

export interface AttentionDistribution {
  by_type: Record<NodeType, number>;  // average attention per type
  total_nodes: number;
  computed_at: string;
}

// ============================================================
// P4 — Goal alignment
// ============================================================

export interface GoalAlignmentResult {
  goal_id:      string;
  goal_name:    string;
  contributors: Array<{ node: GraphNode; strength: number; rel_type: RelationshipType }>;
  detractors:   Array<{ node: GraphNode; strength: number; rel_type: RelationshipType }>;
  alignment_score: number;   // 0–1: 1 = fully supported, 0 = no support
}

export interface ProjectAlignmentResult {
  project_id:    string;
  project_name:  string;
  aligned_goals: Array<{ goal: GraphNode; path_length: number }>;
  alignment_score: number;
}

// ============================================================
// P5 — Contradiction detection
// ============================================================

export type ContradictionType =
  | 'GOAL_REVERSAL'
  | 'PROJECT_REVERSAL'
  | 'PRIORITY_REVERSAL'
  | 'RELATIONSHIP_REVERSAL'
  | 'BELIEF_CONFLICT';

export interface Contradiction {
  contradiction_type: ContradictionType;
  confidence:         number;
  entity_ids:         string[];
  evidence:           ContradictionEvidence[];
  detected_at:        string;
}

export interface ContradictionEvidence {
  event_id:    string | null;
  description: string;
  timestamp:   string;
  payload:     Record<string, unknown>;
}

// ============================================================
// P6 — Confidence tracking
// ============================================================

export interface ConfidenceBreakdown {
  source_count:         number;
  mention_frequency:    number;   // normalised 0–1
  consistency_score:    number;   // 0–1: how consistent the signals are
  stability_score:      number;   // 0–1: edge/node hasn't changed erratically
  final_confidence:     number;   // 0–1 weighted composite
}

// ============================================================
// Path finding
// ============================================================

export interface PathStep {
  node:              GraphNode;
  edge_to_next:      GraphEdge | null;   // null on the last step
  relationship_type: string | null;      // null on the last step
}

export interface PathResult {
  found:            boolean;
  source:           GraphNode | null;
  target:           GraphNode | null;
  steps:            PathStep[];
  node_ids:         string[];
  edge_types:       string[];
  hop_count:        number;
  avg_strength:     number;
  total_strength:   number;   // sum of edge strengths along path
  path_confidence:  number;   // avg of edge confidences along path
  /** Human-readable path, e.g. "Sarah --[WORKS_ON]--> FRIDAY <--[OWNS]-- Khan Designs" */
  summary:          string;
}

// ============================================================
// Entity profiles
// ============================================================

export interface EdgeWithNode {
  edge:           GraphEdge;
  connected_node: GraphNode;
}

export interface EntityProfile {
  node:                  GraphNode;
  incoming_edges:        EdgeWithNode[];   // edges where node is the target
  outgoing_edges:        EdgeWithNode[];   // edges where node is the source
  connected_nodes:       GraphNode[];      // deduped union of both directions
  relationship_summary:  string;          // human-readable graph-native summary
}

