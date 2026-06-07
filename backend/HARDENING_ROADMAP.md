# FRIDAY HARDENING ROADMAP
Generated: 2026-06-07 | Audit basis: full static code analysis of all 8 engines

---

## ENGINE VALIDATION PLAN

### 1. Knowledge Graph Engine
**Purpose:** Extract entities and relationships from every memory, store them in a graph, and inject graph context into every Ask Friday response.

**Code path:**
```
POST /ingest
  → ingest.ts → getGraphService().ingestMemory(userId, content, ledgerId)   [fire-and-forget]
GET /memory/ask
  → ask.ts → getGraphService().buildQueryContext(userId, query, embedding)
  → groq.chat.completions.create(...)                                        [BUG: bypasses AIRouter]
GET /graph/path → graph/path.ts → graphService.getShortestPath()
GET /graph/profile/:name → entity-profile.ts
GET /graph/analytics → graph-analytics.ts
```

**Test scenarios:**
| Query | Expected |
|---|---|
| Who owns FRIDAY? | Shabas --[OWNS]--> FRIDAY edge returned |
| Who works on FRIDAY? | PERSON nodes with WORKS_ON/WORKS_WITH edges |
| How is Sarah connected to Khan Designs? | Shortest path with labelled relationship |
| Ingest memory with bad DB | Graph error surfaced, not silently swallowed |

**Weaknesses found:**
- W1: `ingest.ts:221` — `getGraphService().ingestMemory().catch(...)` — fire-and-forget, graph failures are invisible to caller
- W2: `graph.repository.ts:createSnapshot()` — no pagination: fetches ALL nodes + ALL edges for snapshot (`SELECT * FROM graph_nodes WHERE user_id = ?` with no LIMIT)
- W3: `graph.repository.ts:getEdgesByNodeIds()` — builds unbounded OR filter, degrades with >50 node IDs
- W4: `ask.ts:~120` — `groq.chat.completions.create()` directly, bypasses AIRouter entirely

---

### 2. Observation Engine
**Purpose:** Classify and score raw signals (manual, git, calendar, health) into structured observations.

**Code path:**
```
ObservationService.observe(input)
  → ObservationProcessor.process(input)
  → ObservationClassifier.classify()       [deterministic, no LLM]
  → calculateImportanceScore()
  → ObservationRepository.create()
```

**Entry points:** NONE — no routes registered in server.ts.

**Test scenarios:**
| Input | Expected |
|---|---|
| 5 MANUAL observations for FRIDAY | distribution.by_source.MANUAL = 5 |
| 1 MANUAL observation for Static | FRIDAY dominates (5x vs 1x) |
| TASK_COMPLETED observation | category = WORK, importance > 0.5 |

**Weaknesses found:**
- W5: Zero HTTP routes — `ObservationService` is unreachable from any external caller
- W6: `observation.types.ts:related_entities` — `string[]` of entity names, never resolved to `graph_nodes.id` UUIDs
- W7: `ObservationService.drainUnprocessed()` — no scheduled job calls it; unprocessed observations accumulate indefinitely

---

### 3. Activity Engine
**Purpose:** Correlate observations into timed activity clusters (e.g., "Worked on FRIDAY for 3 hours").

**Code path:**
```
ActivityService.processObservations(userId, observations)
  → CorrelationEngine.correlate(observations)
  → ActivityRepository.createMany(inputs)
  → ActivityRepository.linkObservations(activityId, obsIds)
```

**Entry points:** NONE — `processObservations()` is never called from any route or job.

**Test scenarios:**
| Input | Expected |
|---|---|
| 5 FRIDAY work observations | ≥1 WORK activity created, FRIDAY dominant |
| enrichSignalQuality() called | scores populated in-memory |

**Weaknesses found:**
- W8: `activity.service.ts:processObservations()` — complete logic, zero call sites
- W9: `activity.service.ts:enrichSignalQuality()` — enriches in-memory only, caller must persist; no caller exists

---

### 4. Decision Engine
**Purpose:** Create decisions, attach outcomes and evaluations, score quality of decision-making over time.

**Code path:**
```
DecisionService.createDecision(input)
  → CreateDecisionSchema.parse(input)      [Zod validation]
  → DecisionRepository.create()
  [linkDecisionToEntity() is NEVER called]

DecisionService.evaluateDecision(userId, id, input)
  → DecisionEvaluationEngine.evaluate()
  → updates decision status (COMPLETED if score ≥ 0.6, FAILED if < 0.3)
```

**Entry points:** NONE — no routes registered in server.ts.

**Test scenarios:**
| Scenario | Expected |
|---|---|
| Revenue opportunity, confidence=0.9 | Decision created, validation passes |
| Deadline conflict, success_score=0.3 | Status → FAILED |
| Invalid confidence_score=5 | Zod throws ZodError |

**Weaknesses found:**
- W10: `decision.service.ts:createDecision()` — calls `repo.create()` but never calls `linkDecisionToEntity()`. The decision_entities table is never populated at creation time.
- W11: `decision.service.ts:summariseDecision()` — named "summarise" but does pure aggregation math; does not call LLM despite the name implying it.

---

### 5. Causal Engine
**Purpose:** Model cause-effect relationships on graph edges; find root causes and downstream effects.

**Code path:**
```
CausalService.findCausalPath(userId, from, to)
  → CausalAnalysis.findCausalPath()
  → CausalPathEngine.findCausalPath()      [iterative BFS with O(1) cycle guard]
  → CausalRepository.getCausalEdgesFrom()  [per-hop DB query]

CausalService.processObservation()         [STUB — returns void]
```

**Entry points:** NONE — no routes registered.

**Test scenarios:**
| Chain | Expected |
|---|---|
| traffic-spike → db-overload → server-crash | path.hop_count = 2, path traversed correctly |
| findRootCauses(server-crash) | traffic-spike identified as root |
| findDownstreamEffects(traffic-spike) | server-crash reachable |
| processObservation() called | nothing happens (stub) |

**Weaknesses found:**
- W12: `causal.service.ts:processObservation()` — documented stub, entire body is commented-out TODO. No causal edges are ever auto-created from observations.
- W13: `causal.analysis.ts:getStrongestCausalChains()` — N+1 query pattern: calls `findDownstreamEffects()` (which does recursive BFS with per-edge DB queries) for each of the top N influential nodes × their target count.
- W14: `CausalPathEngine` — each BFS hop fetches edges from DB individually. For a 5-hop chain this is 5+ sequential DB round-trips.

---

### 6. Review Engine
**Purpose:** Generate strategic weekly/monthly reviews from the knowledge graph state.

**Code path:**
```
ReviewService.generateStrategicReview(ctx, trigger)
  → FocusEngine.getFocusAreas(entities)        [pure computation]
  → RiskEngine.detectRisks(entities)           [pure computation]
  → PriorityEngine.calculatePriority(entities) [pure computation]
  → RecommendationEngine.generateRecommendations()
  → supabase.from('strategic_reviews').insert()
```

**Entry points:** NONE — `ReviewService` is never instantiated.

**Test scenarios:**
| Scenario | Expected |
|---|---|
| Weekly review, GOAL last seen 20 days ago | neglected_goals includes that goal |
| Recommendations generated | recommendations.length > 0 |
| overall_score | between 0 and 1 |

**Weaknesses found:**
- W15: `review.service.ts` — never instantiated in `server.ts` or `intelligence.ts`. The entire engine is dead code at runtime.
- W16: Two parallel weekly review systems: `routes/weekly-summary.ts` → `weekly_summaries` table vs `ReviewService` → `strategic_reviews` table. They never merge.
- W17: `ReviewContext` requires caller to pre-fetch and assemble all graph entities. No helper exists to do this — the context assembly is the missing piece for HTTP exposure.

---

### 7. AI Engine
**Purpose:** Route all LLM calls through a single gateway with caching, cost tracking, model selection, and rate limiting.

**Code path:**
```
AIRouter.generate(feature, systemPrompt, userPrompt)
  → checkRateLimit(feature)                [in-memory counter]
  → enforceTokenBudget(feature, tokens)
  → getCached(db, hash)                    [ai_response_cache table]
  → callWithFallback(model, messages)      [L2 → L1 fallback]
  → logUsageToDb(db, userId, metrics)
  → setCached(db, hash, result)
```

**Test scenarios:**
| Scenario | Expected |
|---|---|
| feature = ask_friday | routes to llama-3.3-70b-versatile (L2) |
| feature = memory_extraction | routes to llama-3.1-8b-instant (L1) |
| L2 model fails | falls back to L1, does not throw |
| observation_classification | throws immediately (rate limit = 0) |
| prompt > budget | throws RateLimitError |

**Weaknesses found:**
- W18: `ask.ts` — direct `groq.chat.completions.create()` call bypasses AIRouter entirely. No caching, no cost tracking, no model fallback for the highest-traffic endpoint.
- W19: `ai-rate-limiter.ts` — `getDailyCallCount()` reads from an in-memory Map. All counters reset on server restart. `ai_budget_config` table exists but is never read.

---

### 8. Autonomous Ingestion
**Purpose:** Accept text/voice memories, run LLM extraction, persist to raw_ledgers + entity_ledger + graph.

**Code path:**
```
POST /ingest
  → ingest.ts → Groq extraction (llama-3.3-70b) [bypasses AIRouter]
  → raw_ledgers insert
  → Promise.all([temporal_memories, entity_ledger, todo_tasks, ledger_embeddings])
  → getGraphService().ingestMemory().catch()     [fire-and-forget]
```

**Test scenarios:**
| Input | Expected |
|---|---|
| "Met Shanavas Khan (father) today" | entity.name = "Shanavas Khan" (no suffix) |
| Memory with 2 tasks | task_count = 2 in response |
| Same entity name twice in one memory | deduplicated to 1 entity_ledger row |
| DB connection fails mid-write | partial success, error logged |

**Weaknesses found:**
- W20: `ingest.ts:221` — fire-and-forget graph ingestion. `IngestResponse` has no `graph_ingested` field. Callers cannot tell if the graph was updated.
- W21: `ingest.ts` — calls `groq.chat.completions.create()` directly. Not routed through AIRouter. No caching of identical memories. No cost tracking for ingestion LLM calls.
- W22: `auth.ts:17` — `token !== apiSecret` — plain string equality is vulnerable to timing attacks.
- W23: `supabase.ts:getFridayUserId()` — returns `process.env.FRIDAY_USER_ID`. Hardcoded single-user. All data siloed under one user ID regardless of who calls the API.

---

---

# HARDENING ROADMAP

## Priority 1 — Critical Bugs
*These cause silent data loss or broken core functionality right now.*

### BUG-1: Graph ingestion errors are invisible
- **File:** `src/routes/ingest.ts:221`
- **Function:** async IIFE after `Promise.all([...])`
- **Root cause:** `getGraphService().ingestMemory().catch(err => console.error(err))` — error is swallowed. Caller gets `200 OK` even when the graph was not updated.
- **Fix:**
```typescript
// Replace fire-and-forget with tracked result
let graph_ingested = false;
try {
  await getGraphService().ingestMemory(getFridayUserId(), content, rawLedgerId);
  graph_ingested = true;
} catch (err) {
  console.error('[ingest] graph ingest error:', err);
}
// Add to response:
return reply.code(200).send({ ...response, graph_ingested });
```

---

### BUG-2: Ask Friday bypasses AIRouter
- **File:** `src/routes/memory/ask.ts:~120`
- **Function:** `memoryAskRoutes` handler
- **Root cause:** `groq.chat.completions.create(...)` called directly. Bypasses caching, cost tracking, L1/L2 routing, fallback chain, and rate limiting.
- **Fix:**
```typescript
// Replace:
const completion = await groq.chat.completions.create({ model: "llama-3.3-70b-versatile", ... });

// With:
const answer = await getAIRouter().generate('ask_friday', systemPrompt, userPrompt, { maxTokens: 700, temperature: 0.3 });
```

---

### BUG-3: linkDecisionToEntity() never called at decision creation
- **File:** `src/modules/decision-engine/decision.service.ts:35`
- **Function:** `createDecision()`
- **Root cause:** `decision.service.ts` calls `repo.create(validated)` and returns. `linkDecisionToEntity()` exists but has no call site during creation. `decision_entities` table is always empty for new decisions.
- **Fix:** After `repo.create()`, resolve entity names against graph nodes and call `linkDecisionToEntity()` for each matched node.

---

### BUG-4: Timing attack on auth token comparison
- **File:** `src/middleware/auth.ts:17`
- **Function:** `authMiddleware`
- **Root cause:** `token !== apiSecret` — plain string equality. An attacker can measure response time differences to determine the secret character-by-character.
- **Fix:**
```typescript
import { timingSafeEqual } from 'crypto';

const safe = (a: string, b: string) =>
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

if (!token || !safe(token, apiSecret)) {
  reply.code(401).send({ error: 'Unauthorized.' });
}
```

---

## Priority 2 — Reliability Issues
*These cause silent failures, missing data, or broken pipelines under normal use.*

### REL-1: ActivityService.processObservations() has no call site
- **File:** `src/modules/activity-engine/activity.service.ts`
- **Function:** `processObservations()`
- **Root cause:** Complete implementation, zero callers. The activity timeline is never populated.
- **Fix:** In `ingest.ts`, after writing observations, call:
```typescript
activityService.processObservations(userId, [{ source: 'MANUAL', ...parsed }]).catch(console.error);
```

---

### REL-2: ObservationService has no HTTP routes
- **File:** `src/server.ts`
- **Root cause:** `ObservationService` is never instantiated or registered.
- **Fix:** Add to `server.ts`:
```typescript
import { observationRoutes } from './routes/observation';
await app.register(observationRoutes); // GET /observation/recent, POST /observation
```

---

### REL-3: ReviewService is never instantiated
- **File:** `src/lib/intelligence.ts`
- **Root cause:** `ReviewService` is never wired in `intelligence.ts`. No route calls it.
- **Fix:** Instantiate in `intelligence.ts` and expose `POST /review/generate`, `GET /review/latest`.

---

### REL-4: Two parallel weekly review systems
- **Files:** `src/routes/weekly-summary.ts` → `weekly_summaries` table; `src/modules/review-engine/review.service.ts` → `strategic_reviews` table
- **Root cause:** Both systems generate weekly summaries independently. No merge, no cross-reference.
- **Fix:** Route `weekly-summary.ts` through `ReviewService.generateStrategicReview()` so both write to `strategic_reviews`. Deprecate `weekly_summaries`.

---

### REL-5: AI budget counters reset on restart
- **File:** `src/modules/ai-engine/ai-rate-limiter.ts`
- **Function:** `getDailyCallCount()`
- **Root cause:** Counters live in a module-level `Map`. Server restart loses all budget state. `ai_budget_config` table exists but is never read.
- **Fix:** On startup, load persisted counts from `ai_usage_metrics` for today. Reset the in-memory map from DB rows.

---

### REL-6: CausalService.processObservation() is a stub
- **File:** `src/modules/causal-engine/causal.service.ts:62`
- **Function:** `processObservation()`
- **Root cause:** Entire function body is a commented-out TODO block. No causal edges are ever auto-created from observations.
- **Fix (Phase 2):** Implement the `GIT_COMMIT` and `CALENDAR_EVENT` handlers first, as those have the clearest causal semantics (commit → PR → deployment).

---

## Priority 3 — Performance Issues
*These will cause degraded response times or failures as data grows.*

### PERF-1: Snapshot creation fetches entire graph with no limit
- **File:** `src/modules/knowledge-graph/graph.repository.ts:createSnapshot()`
- **Root cause:** `SELECT * FROM graph_nodes WHERE user_id = ?` and `SELECT * FROM graph_edges WHERE user_id = ?` — no LIMIT. A user with 5,000 nodes will cause OOM or timeout.
- **Fix:** Replace with a summary snapshot:
```typescript
// Store only top 500 nodes by importance + their edges
const nodes = await this.db.from('graph_nodes').select().eq('user_id', userId)
  .order('importance_score', { ascending: false }).limit(500);
```

---

### PERF-2: getEdgesByNodeIds OR filter is unbounded
- **File:** `src/modules/knowledge-graph/graph.repository.ts:getEdgesByNodeIds()`
- **Root cause:** `.or(nodeIds.map(id => `source_node_id.eq.${id},target_node_id.eq.${id}`).join(','))` — 100 node IDs = 200 OR clauses. PostgreSQL planner falls back to sequential scan.
- **Fix:** Chunk nodeIds into batches of 50 and merge results:
```typescript
const CHUNK = 50;
const results: GraphEdge[] = [];
for (let i = 0; i < nodeIds.length; i += CHUNK) {
  const chunk = nodeIds.slice(i, i + CHUNK);
  const { data } = await this.db.from('graph_edges').select()
    .eq('user_id', userId).eq('is_archived', false)
    .or(chunk.map(id => `source_node_id.eq.${id},target_node_id.eq.${id}`).join(','));
  results.push(...(data ?? []));
}
```

---

### PERF-3: CausalAnalysis.getStrongestCausalChains() has N+1 pattern
- **File:** `src/modules/causal-engine/causal.analysis.ts:getStrongestCausalChains()`
- **Root cause:** Calls `findDownstreamEffects()` per influential node × per target. Each `findDownstreamEffects()` call does recursive BFS with per-hop DB queries.
- **Fix:** Pre-fetch all causal edges once, then run all BFS traversals in-memory:
```typescript
const allEdges = await this.repo.getAllCausalEdges(userId, 500);
// Build adjacency list in-memory, run BFS without further DB calls
```

---

### PERF-4: CausalPathEngine per-hop DB queries
- **File:** `src/modules/causal-engine/causal-path.engine.ts`
- **Root cause:** Each BFS hop calls `this.repo.getCausalEdgesFrom()` → 1 DB query per node visited. A 5-hop chain with branching = 5–25 sequential DB round-trips.
- **Fix:** Same as PERF-3 — pre-load all edges into memory for the subgraph before traversal.

---

### PERF-5: refreshNodeScores runs Promise.all per node — no batch update
- **File:** `src/modules/knowledge-graph/graph.service.ts:refreshNodeScores()`
- **Root cause:** `Promise.all(batch.map(async id => { ... repo.updateNodeScores(id) }))` — N parallel updates instead of a single bulk update.
- **Fix:** Collect all `{ id, importance_score }` pairs and issue one `UPDATE ... WHERE id = ANY(?)` using an RPC function.

---

## Priority 4 — Missing Capabilities
*These are intentional gaps. Implement after Priority 1–3 are resolved.*

### CAP-1: Observation connectors
- Calendar connector is lowest friction — Google OAuth tokens already exist.
- Implement `ICalendarConnector` using `googleapis` (already in `package.json`).
- Register in `ObservationService.registerConnector()` at startup.
- Wire output to `ActivityService.processObservations()`.

### CAP-2: CRM ↔ Graph bridge
- `entity_ledger` (people from ingest) and `graph_nodes` (PERSON type) are completely separate.
- Add a post-ingest step: for each `entity_ledger` row, call `GraphSearch.findByName()` and upsert a PERSON node.

### CAP-3: ReviewService HTTP exposure
- Add `POST /review/generate` and `GET /review/latest`.
- The only missing piece is context assembly: fetch top graph entities by importance and build `ReviewContext`.

### CAP-4: Integration Engine workflow registration
- `OrchestrationEngine.processObservation()` calls `this.workflows.get('OBSERVATION_INGESTION')` — but no workflow is ever registered.
- Define `WorkflowDefinition` objects for `OBSERVATION_INGESTION` and `WEEKLY_REVIEW` at startup.

### CAP-5: Digital Twin / BI Engine
- No existing code or schema. Do not build until Priority 1–4 are resolved.

---

## Summary table

| ID | Severity | File | Function | Status |
|---|---|---|---|---|
| BUG-1 | Critical | ingest.ts | fire-and-forget graph | Open |
| BUG-2 | Critical | ask.ts | direct groq call | Open |
| BUG-3 | Critical | decision.service.ts | createDecision | Open |
| BUG-4 | Critical | auth.ts | authMiddleware | Open |
| REL-1 | High | activity.service.ts | processObservations | Open |
| REL-2 | High | server.ts | missing obs routes | Open |
| REL-3 | High | intelligence.ts | ReviewService unwired | Open |
| REL-4 | High | weekly-summary.ts / review.service.ts | dual systems | Open |
| REL-5 | High | ai-rate-limiter.ts | in-memory counters | Open |
| REL-6 | High | causal.service.ts | processObservation stub | Open |
| PERF-1 | Medium | graph.repository.ts | createSnapshot | Open |
| PERF-2 | Medium | graph.repository.ts | getEdgesByNodeIds | Open |
| PERF-3 | Medium | causal.analysis.ts | getStrongestCausalChains | Open |
| PERF-4 | Medium | causal-path.engine.ts | per-hop DB queries | Open |
| PERF-5 | Low | graph.service.ts | refreshNodeScores | Open |
| CAP-1 | Low | observation-engine | Calendar connector | Open |
| CAP-2 | Low | ingest.ts | CRM→Graph bridge | Open |
| CAP-3 | Low | server.ts | Review HTTP routes | Open |
| CAP-4 | Low | integration-engine | workflow registration | Open |
| CAP-5 | None | — | Digital Twin / BI | Not started |
