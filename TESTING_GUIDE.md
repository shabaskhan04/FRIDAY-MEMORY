# FRIDAY Hybrid Retrieval — Complete Setup & Testing Guide

## What changed in V2

| Layer | Old behaviour | New behaviour |
|---|---|---|
| Search | Pure semantic (pgvector cosine only) | Hybrid: semantic + keyword + entity + recency |
| Recency | Exponential decay — old memories vanished | Flat 2-tier: recent = 1.0, older = 0.9, floor never below 0.9 |
| Query analysis | None | Classifies every query → adjusts weights dynamically |
| Entity boosting | None | Detects names from your `entity_ledger`, boosts memories that mention them |
| Ask Friday | Retrieve → answer | Hybrid retrieve → re-rank → answer with entity/query-type metadata |
| Reflection | None | POST `/api/memory/reflect` — daily pattern synthesis |

---

## Step 1 — Run migrations in order

Go to **Supabase → SQL Editor → New Query** and run these files one at a time, in order.

### 1a. If you haven't run the originals yet
```
supabase/setup.sql
supabase/schema-upgrade.sql
supabase/semantic-search.sql
```

### 1b. Run the V2 migration (the only new file)
```
supabase/hybrid-search.sql
```

**What it does:**
- Adds `fts_vector` generated column to `raw_ledgers` (auto-updates on insert)
- Creates GIN index on `fts_vector`
- Adds `is_reflection`, `reflection_type`, `source_memory_ids` columns
- Creates `match_memories_keyword(query_text, match_count)` RPC
- Creates `match_memories_hybrid(query_embedding, query_text, ...)` RPC
- Creates `insert_reflection(...)` RPC

**Verify it worked** — run this in SQL Editor:
```sql
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN ('match_memories_hybrid', 'match_memories_keyword', 'insert_reflection');
```
You should see all 3 rows.

---

## Step 2 — Drop in the new files

Replace these 5 files in your project (all others are unchanged):

```
lib/queryAnalyzer.ts                    ← NEW file
app/api/memory/search/route.ts          ← REPLACED
app/api/memory/ask/route.ts             ← REPLACED
app/api/memory/reflect/route.ts         ← NEW file
components/memory/memory-tab.tsx        ← REPLACED
```

No new npm packages needed. No new env vars needed.

---

## Step 3 — Seed test memories

Run this entire block in **Supabase → SQL Editor**. It inserts 12 realistic
memories with known content so you can verify each retrieval mode works.

```sql
-- ============================================================
-- FRIDAY V2 — Test seed data
-- Run in Supabase SQL Editor.
-- Creates memories across different topics, people, time periods.
-- Embeddings will be generated on next ingest; for keyword/entity
-- testing, content alone is sufficient.
-- ============================================================

-- Clear any previous test data (optional — comment out to keep real data)
-- DELETE FROM public.entity_ledger  WHERE ledger_note LIKE '%[TEST]%';
-- DELETE FROM public.raw_ledgers    WHERE content      LIKE '%[TEST]%';

-- ── Recent memories (< 30 days → recency_score = 1.0) ────────

INSERT INTO public.raw_ledgers (content, intent_tag, created_at) VALUES
(
  '[TEST] Played badminton with Nidha today. She showed me a new wrist technique for backhand drops. Lost 3 sets but learned a lot.',
  'spark',
  NOW() - INTERVAL '2 days'
),
(
  '[TEST] Had a long call with Nidha about her new job at the design agency. She seems excited but nervous about the client work.',
  'standard',
  NOW() - INTERVAL '5 days'
),
(
  '[TEST] Khan Designs project: finished the logo revisions. Client approved the monogram variant. Next step is the brand guidelines doc.',
  'spark',
  NOW() - INTERVAL '3 days'
),
(
  '[TEST] Feeling stuck on the Orin feature. The state management is getting complex. Might need to refactor before adding new screens.',
  'friction',
  NOW() - INTERVAL '1 day'
),
(
  '[TEST] Read about compound interest for the first time in a practical way. Started a small SIP of 2000/month. Feels like a real adult decision.',
  'spark',
  NOW() - INTERVAL '7 days'
);

-- ── Older memories (> 30 days → recency_score = 0.9) ─────────

INSERT INTO public.raw_ledgers (content, intent_tag, created_at) VALUES
(
  '[TEST] Nidha taught me how to cook dal makhani properly. The secret is slow cooking on low heat for 45 minutes. The butter goes in at the very end.',
  'spark',
  NOW() - INTERVAL '45 days'
),
(
  '[TEST] Khan Designs kick-off meeting. The client wants a rebrand for their premium product line. Budget is tight but scope is interesting.',
  'standard',
  NOW() - INTERVAL '60 days'
),
(
  '[TEST] Orin v1 shipped to beta testers. 12 signups in first hour. Two bugs reported — both in the notification flow.',
  'spark',
  NOW() - INTERVAL '90 days'
),
(
  '[TEST] Keep procrastinating on the Static project. Every time I sit down to work on it I end up doing something else. Need to understand why.',
  'friction',
  NOW() - INTERVAL '120 days'
),
(
  '[TEST] Had a difficult conversation with Nidha. She felt I was not listening when she was stressed. She was right. I need to be more present.',
  'friction',
  NOW() - INTERVAL '50 days'
),
(
  '[TEST] Started meditating every morning. 10 minutes with Headspace. First week was hard to stay consistent but by day 5 it felt natural.',
  'spark',
  NOW() - INTERVAL '180 days'
),
(
  '[TEST] Finished reading Atomic Habits. The key idea I keep returning to: you do not rise to the level of your goals, you fall to the level of your systems.',
  'spark',
  NOW() - INTERVAL '200 days'
);

-- ── Entity ledger entries (so entity detection works) ─────────

-- Get the IDs of the test memories that mention Nidha and insert entity rows
INSERT INTO public.entity_ledger (raw_ledger_id, name, interaction_type, trust_signal, ledger_note)
SELECT id, 'Nidha', 'friend', 'positive', '[TEST] auto-seeded'
FROM public.raw_ledgers
WHERE content LIKE '%Nidha%' AND content LIKE '%[TEST]%';

INSERT INTO public.entity_ledger (raw_ledger_id, name, interaction_type, trust_signal, ledger_note)
SELECT id, 'Khan Designs', 'project', 'neutral', '[TEST] auto-seeded'
FROM public.raw_ledgers
WHERE content LIKE '%Khan Designs%' AND content LIKE '%[TEST]%';

INSERT INTO public.entity_ledger (raw_ledger_id, name, interaction_type, trust_signal, ledger_note)
SELECT id, 'Orin', 'project', 'positive', '[TEST] auto-seeded'
FROM public.raw_ledgers
WHERE content LIKE '%Orin%' AND content LIKE '%[TEST]%';

-- Verify seed
SELECT id, intent_tag, created_at, left(content, 60) AS preview
FROM public.raw_ledgers
WHERE content LIKE '%[TEST]%'
ORDER BY created_at DESC;
```

---

## Step 4 — Verify FTS index is working

In SQL Editor:
```sql
-- Should return memories mentioning "badminton" or "Nidha"
SELECT id, ts_rank(fts_vector, websearch_to_tsquery('english', 'Nidha badminton'), 32) AS rank, left(content, 80)
FROM public.raw_ledgers
WHERE fts_vector @@ websearch_to_tsquery('english', 'Nidha badminton')
  AND content LIKE '%[TEST]%'
ORDER BY rank DESC;
```

Expected: 1–2 rows, rank > 0.

```sql
-- Verify recency tiers directly
SELECT
  left(content, 60) AS preview,
  created_at,
  CASE
    WHEN EXTRACT(EPOCH FROM (NOW() - created_at)) < 2592000 THEN 1.0
    ELSE 0.9
  END AS expected_recency_score
FROM public.raw_ledgers
WHERE content LIKE '%[TEST]%'
ORDER BY created_at DESC;
```

Expected: memories from last 30 days show `1.0`, older ones show `0.9`.

---

## Step 5 — API test queries

Use these with `curl`, Postman, or your browser devtools while the app is running (`npm run dev`).

### 5a. Keyword-dominant: exact name + activity

```bash
curl -s -X POST http://localhost:3000/api/memory/search \
  -H "Content-Type: application/json" \
  -d '{"query": "Nidha badminton", "debug": true}' | jq .
```

**What to look for:**
- `query_analysis.query_type` → `"PERSON_SEARCH"`
- `query_analysis.entities` → contains `{ name: "Nidha", type: "PERSON", confidence: 1.0 }`
- `query_analysis.weights.entity` → `0.35`
- Top result should be the badminton memory
- That result's `keyword_score` > 0, `entity_score` > 0, `matched_entities` contains `"nidha"`

---

### 5b. Pure semantic: concept with no exact keyword

```bash
curl -s -X POST http://localhost:3000/api/memory/search \
  -H "Content-Type: application/json" \
  -d '{"query": "cooking lessons from a friend", "debug": true}' | jq .
```

**What to look for:**
- `query_type` → `"FACT_LOOKUP"` (no entity signal)
- The dal makhani memory should surface via `semantic_score` even though it contains none of the query words
- `keyword_score` will be 0 for that result; `semantic_score` carries it

---

### 5c. Project search with entity boost

```bash
curl -s -X POST http://localhost:3000/api/memory/search \
  -H "Content-Type: application/json" \
  -d '{"query": "Khan Designs progress", "debug": true}' | jq .
```

**What to look for:**
- `query_type` → `"PROJECT_SEARCH"` or `"PERSON_SEARCH"` (Khan Designs is in entity_ledger)
- Both Khan Designs memories surface
- `entity_score` is non-zero on both
- Recent one (3 days old) has `recency_score: 1` vs older one (60 days) `recency_score: 0.9`

---

### 5d. Reflection query: semantic dominant

```bash
curl -s -X POST http://localhost:3000/api/memory/search \
  -H "Content-Type: application/json" \
  -d '{"query": "what patterns do I keep repeating", "debug": true}' | jq .
```

**What to look for:**
- `query_type` → `"REFLECTION"`
- `weights` → `{ semantic: 0.60, keyword: 0.15, entity: 0.10, recency: 0.15 }`
- Procrastination and relationship memories should surface
- `semantic_score` is what drives ranking here, not keyword

---

### 5e. Timeline query: recency-weighted

```bash
curl -s -X POST http://localhost:3000/api/memory/search \
  -H "Content-Type: application/json" \
  -d '{"query": "what have I been doing recently", "debug": true}' | jq .
```

**What to look for:**
- `query_type` → `"TIMELINE"`
- `weights.recency` → `0.40` (highest of all query types)
- Results sorted towards newer memories
- Older memories still appear (recency_score = 0.9 keeps them competitive, not invisible)

---

### 5f. Ask Friday: synthesis test

```bash
curl -s -X POST http://localhost:3000/api/memory/ask \
  -H "Content-Type: application/json" \
  -d '{"query": "What have I learned from Nidha?"}' | jq .
```

**What to look for:**
- `query_type` → `"PERSON_SEARCH"`
- `entities_detected` → `["Nidha"]`
- `answer` references specific content (badminton technique, dal makhani, the difficult conversation)
- `citations` array — each has `id`, `final_score`, `matched_entities`
- `cited_ids` matches IDs in `citations`

---

### 5g. Ask Friday: advice query

```bash
curl -s -X POST http://localhost:3000/api/memory/ask \
  -H "Content-Type: application/json" \
  -d '{"query": "Should I keep working on Orin or focus on Static first?"}' | jq .
```

**What to look for:**
- `query_type` → `"ADVICE"`
- `weights` → `{ semantic: 0.65, ... }` (semantic dominant)
- Answer should reason from the Orin shipping memory and the Static procrastination memory
- If evidence is weak, Friday should say so

---

### 5h. Reflection engine

```bash
curl -s -X POST http://localhost:3000/api/memory/reflect | jq .
```

**What to look for:**
- `{ "status": "ok", "insights_saved": 3 }` (or similar count)
- Then in Supabase: `SELECT content FROM raw_ledgers WHERE is_reflection = true ORDER BY created_at DESC LIMIT 5;`
- You should see entries like `[REFLECTION:MOST_DISCUSSED_TOPIC] ...` and `[REFLECTION:DAILY_SUMMARY] ...`

---

## Step 6 — Score sanity checks

Run these in SQL Editor after you have real/test memories with embeddings.

### Recency tier verification
```sql
SELECT
  left(content, 50) AS preview,
  CASE
    WHEN EXTRACT(EPOCH FROM (NOW() - created_at)) < 2592000 THEN 1.0
    ELSE 0.9
  END AS recency_score,
  created_at::date AS date
FROM public.raw_ledgers
WHERE content LIKE '%[TEST]%'
  AND (is_reflection IS NULL OR is_reflection = false)
ORDER BY created_at DESC;
```

All rows should show either `1.0` (recent) or `0.9` (older). No value between. No zeros.

### Keyword search direct
```sql
SELECT
  left(content, 60) AS preview,
  ts_rank(fts_vector, websearch_to_tsquery('english', 'badminton wrist technique'), 32) AS kw_score
FROM public.raw_ledgers
WHERE fts_vector @@ websearch_to_tsquery('english', 'badminton wrist technique')
ORDER BY kw_score DESC;
```

### FTS vs semantic gap test
This query has no exact keyword overlap with the dal makhani memory but should
be retrieved via semantic path:
```sql
-- This will return 0 rows from keyword — that's expected
SELECT count(*) AS keyword_hits
FROM public.raw_ledgers
WHERE fts_vector @@ websearch_to_tsquery('english', 'cooking lesson from a friend');
```
Keyword hits = 0, but the `/api/memory/search` API call in 5b should still return
the dal makhani memory via `semantic_score`. That gap is what hybrid retrieval fixes.

---

## Step 7 — What good scores look like

When you call `/api/memory/search` with `debug: true`, each memory in the response
has a `_debug` breakdown (or the scores are top-level on each memory object). Here
is how to read them:

| Score | Range | Meaning |
|---|---|---|
| `semantic_score` | 0 – 1 | Cosine similarity to query embedding. > 0.70 = strong match |
| `keyword_score` | 0 – 1 | Normalised ts_rank. 1.0 = best keyword match in this result set |
| `entity_score` | 0, 0.4, 0.8, 1.0 | +0.4 per matched entity, capped at 1.0 |
| `recency_score` | 0.9 or 1.0 | 1.0 = last 30 days, 0.9 = older. Never lower |
| `final_score` | 0 – 1+ | Weighted sum. Used for ranking |

**A typical strong result** for `"Nidha badminton"`:
```
semantic_score:  0.82   (embedding understood the activity context)
keyword_score:   1.00   (exact name + word match)
entity_score:    0.40   (Nidha detected)
recency_score:   1.00   (2 days old)
final_score:     ~0.79  (0.82×0.25 + 1.0×0.30 + 0.40×0.35 + 1.0×0.10)
```

**A strong old memory** for the same query — it still competes:
```
semantic_score:  0.75
keyword_score:   0.60
entity_score:    0.40
recency_score:   0.90   ← 0.9 not 0, so it's still visible
final_score:     ~0.67
```

---

## Common issues and fixes

**`fts_vector` column does not exist**
→ Run `supabase/hybrid-search.sql` in SQL Editor. You may have only run the older files.

**`match_memories_hybrid` function does not exist**
→ Same fix — run `hybrid-search.sql`.

**Entity detection not working (entity_score always 0)**
→ Check that `entity_ledger` has rows. Run the seed SQL block in Step 3, or ingest a memory mentioning a real name and let the ingest pipeline create the entity rows automatically.

**`fts_vector` NULL on old rows**
→ The column is `GENERATED ALWAYS AS ... STORED` which means it only populates on INSERT or UPDATE. Old rows before the migration have NULL. Fix:
```sql
UPDATE public.raw_ledgers SET content = content WHERE is_reflection IS NOT TRUE;
```
This touches every row and forces the generated column to recompute.

**Semantic search returns nothing (0 results)**
→ Embeddings are stored in `ledger_embeddings`. Check that table is populated:
```sql
SELECT count(*) FROM public.ledger_embeddings;
```
If 0: your ingest pipeline is using Ollama (check `EMBEDDING_PROVIDER` env var) and it may not be running. Switch to `EMBEDDING_PROVIDER=openai` in `.env.local`.

**Reflection endpoint returns `skipped`**
→ You need at least 3 non-reflection memories created in the last 24 hours. Ingest some content first, then POST to `/api/memory/reflect`.
