# Friday Knowledge Graph Engine

A production-grade, PostgreSQL-backed knowledge graph module for the Friday AIOS backend.

---

## Architecture Overview

```
knowledge-graph/
├── graph.service.ts      # Orchestration layer — all external calls go here
├── graph.repository.ts   # Supabase/Postgres data access
├── graph.extractor.ts    # LLM extraction pipeline
├── graph.merger.ts       # Duplicate detection and node merging
├── graph.search.ts       # Exact + fuzzy + semantic search
├── graph.traversal.ts    # BFS/DFS graph algorithms
├── graph.insights.ts     # Intelligence engines
├── graph.scoring.ts      # Temporal scoring and decay formulas
├── graph.types.ts        # TypeScript types (DB rows, DTOs, domain)
├── graph.schemas.ts      # Zod validation schemas
├── schema.sql            # Postgres schema with indexes and functions
└── prompts/
    ├── extraction.prompt.ts   # LLM extraction system prompt
    ├── confidence.prompt.ts   # Confidence reassessment prompt
    └── insights.prompt.ts     # Ask Friday and digest prompts
```

---

## Database

Run `schema.sql` against your Supabase project. It creates:

| Table | Purpose |
|-------|---------|
| `graph_nodes` | All entity nodes (people, projects, goals, etc.) |
| `graph_edges` | Directed relationships between nodes |
| `graph_snapshots` | Periodic full-graph captures for diffing |
| `graph_events` | Immutable audit log for every mutation |

### Required Supabase RPC functions

The repository calls three Postgres functions. Add them to your schema:

```sql
-- Fuzzy node search via pg_trgm
CREATE OR REPLACE FUNCTION search_nodes_fuzzy(
  p_user_id UUID, p_name TEXT, p_threshold FLOAT
) RETURNS SETOF graph_nodes LANGUAGE sql STABLE AS $$
  SELECT * FROM graph_nodes
  WHERE user_id = p_user_id
    AND is_archived = FALSE
    AND similarity(name, p_name) >= p_threshold
  ORDER BY similarity(name, p_name) DESC;
$$;

-- Semantic search via pgvector
CREATE OR REPLACE FUNCTION search_nodes_semantic(
  p_user_id UUID, p_embedding VECTOR(1536), p_limit INT, p_min_score FLOAT
) RETURNS TABLE(id UUID, similarity FLOAT) LANGUAGE sql STABLE AS $$
  SELECT id, 1 - (embedding <=> p_embedding) AS similarity
  FROM graph_nodes
  WHERE user_id = p_user_id
    AND is_archived = FALSE
    AND embedding IS NOT NULL
    AND 1 - (embedding <=> p_embedding) >= p_min_score
  ORDER BY similarity DESC
  LIMIT p_limit;
$$;

-- Mention increment (atomic)
CREATE OR REPLACE FUNCTION increment_node_mention(p_node_id UUID, p_user_id UUID)
RETURNS VOID LANGUAGE sql AS $$
  UPDATE graph_nodes
  SET mention_count = mention_count + 1,
      last_mentioned_at = NOW()
  WHERE id = p_node_id AND user_id = p_user_id;
$$;

CREATE OR REPLACE FUNCTION increment_edge_mention(p_edge_id UUID, p_user_id UUID)
RETURNS VOID LANGUAGE sql AS $$
  UPDATE graph_edges
  SET mention_count = mention_count + 1,
      last_seen_at = NOW()
  WHERE id = p_edge_id AND user_id = p_user_id;
$$;
```

---

## Dependency Injection Setup

```typescript
import { createClient } from '@supabase/supabase-js';
import { GraphRepository } from './graph.repository';
import { GraphExtractor }  from './graph.extractor';
import { GraphMerger }     from './graph.merger';
import { GraphSearch }     from './graph.search';
import { GraphTraversal }  from './graph.traversal';
import { GraphInsights }   from './graph.insights';
import { GraphService }    from './graph.service';

const db      = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!);
const embedFn = async (text: string) => { /* call OpenAI text-embedding-3-small */ };
const llm     = { chat: async (messages) => { /* call GPT-4o */ } };

const repo       = new GraphRepository(db);
const extractor  = new GraphExtractor(llm);
const merger     = new GraphMerger(repo);
const search     = new GraphSearch(repo, embedFn);
const traversal  = new GraphTraversal(repo);
const insights   = new GraphInsights(repo);

export const graphService = new GraphService(
  repo, extractor, merger, search, traversal, insights, embedFn,
);
```

---

## API Reference

### Ingestion
```typescript
// Ingest raw memory → extract → dedup → persist nodes and edges
await graphService.ingestMemory(userId, "Spent 3 hours on Orin, spoke with hotel client", memoryId);
```

### Node operations
```typescript
await graphService.getNode(userId, nodeId);
await graphService.findNodeByName(userId, "Orin");
await graphService.getMostImportantNodes(userId, 20);
await graphService.createNode({ user_id, node_type: 'PROJECT', name: 'Orin', ... });
```

### Graph traversal
```typescript
await graphService.getConnectedNodes(userId, nodeId);
await graphService.getNodeNeighborhood(userId, nodeId, depth=2);
await graphService.getShortestPath(userId, fromId, toId);
```

### Search
```typescript
await graphService.searchGraph({ query: "scholarships", user_id: userId });
await graphService.getProjectGraph(userId, "Orin");
```

### Intelligence
```typescript
await graphService.generateInsights(userId);       // all insight engines
await graphService.getRecentGraphChanges(userId);  // audit log
```

### Maintenance (run as cron)
```typescript
await graphService.decayStaleEdges(userId);        // daily
await graphService.takeSnapshot(userId, 'weekly'); // weekly digest trigger
await graphService.refreshNodeScores(userId, ids); // after bulk ingestion
```

---

## Scoring Model

```
importance_score = 0.40 × recency + 0.35 × frequency + 0.25 × connectivity

recency      = e^(-λ·t)            λ = ln(2) / 30 days
frequency    = log(min(count, 100)) / log(100)
connectivity = (edge_count / 50) × avg_edge_strength

edge_strength_decay = strength × e^(-λ·t),  floored at 0.05
edge_strength_boost = current + (1 - current) × 0.15
```

---

## Integration Points

| System | Integration |
|--------|-------------|
| Memory ingestion | Call `graphService.ingestMemory()` after saving each memory |
| Ask Friday | Call `graphService.buildQueryContext()` to inject graph context before LLM call |
| Weekly digest | Call `graphService.generateInsights()` + `takeSnapshot('weekly_digest')` |
| Health system | Ingest health logs with `node_type: 'HEALTH_METRIC'` |
| MCP layer (future) | Expose `searchGraph`, `getNodeNeighborhood`, `generateInsights` as MCP tools |
| Android app (future) | REST/WebSocket wrappers around `GraphService` public methods |

---

## Duplicate Detection Strategy

1. **Exact match** (similarity = 1.0) — case-insensitive name match
2. **Normalized match** (≥ 0.75) — strip punctuation, Jaccard word similarity
3. **Alias match** (0.9) — check stored `aliases` array
4. **Semantic match** (≥ 0.92) — cosine similarity on embeddings

Auto-merge threshold: **0.95**. Below that: flagged for human approval.

---

## Implementation Roadmap

**Phase 1 — Foundation (done)**
- [x] Schema + indexes
- [x] Types + validation
- [x] Repository
- [x] Scoring formulas
- [x] Traversal algorithms

**Phase 2 — Intelligence (done)**
- [x] LLM extraction pipeline
- [x] Duplicate detection + merging
- [x] Semantic + fuzzy search
- [x] Insight engines

**Phase 3 — Integration**
- [ ] Wire into memory ingestion pipeline
- [ ] Add graph context injection to Ask Friday
- [ ] Add graph summary section to weekly digest
- [ ] Set up cron jobs for decay + snapshot

**Phase 4 — Optimization**
- [ ] Cache hot neighborhoods in Redis
- [ ] Materialized view for top-N nodes per user
- [ ] Background score refresh queue (Bull/BullMQ)
- [ ] Incremental embedding updates (skip if name unchanged)
