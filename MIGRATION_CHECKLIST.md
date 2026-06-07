# Friday — Migration Checklist

Use this to track progress as you cut over each endpoint.
Check off each item when the backend route is live and the frontend is pointing to it.

---

## Phase 0 — Cleanup (do first, no behaviour change)

- [ ] Delete `app/api/ingest/` subtree in the Next.js repo (it's a stale duplicate ~80 files)
- [ ] Verify no imports anywhere reference files inside `app/api/ingest/`
- [ ] Commit: "chore: remove orphaned ingest subtree"

---

## Phase 1 — Shared package

- [ ] Create `shared/` directory with `package.json`, `tsconfig.json`
- [ ] Move types from monolith inline routes → `shared/src/types/*.ts`
- [ ] Move `lib/recency.ts` → `shared/src/utils/recency.ts`
- [ ] Add `@friday/shared` to workspace in root `package.json`
- [ ] Verify `npm run build:shared` succeeds
- [ ] Update monolith to import from `@friday/shared` where applicable
- [ ] Commit: "feat: extract shared TypeScript types into @friday/shared"

---

## Phase 2 — Backend scaffolding (no traffic yet)

- [ ] Create `backend/` directory with `server.ts`, all routes returning 501
- [ ] Configure Fastify with CORS and auth middleware
- [ ] Create Docker image and push to registry
- [ ] Deploy to DigitalOcean Droplet (PM2 start)
- [ ] Set all environment variables on the Droplet
- [ ] Confirm `/healthz` returns `{"ok":true}`
- [ ] Confirm auth gate blocks unauthenticated requests
- [ ] Commit: "feat: scaffold backend Fastify server on DigitalOcean"

---

## Phase 3 — Low-risk CRUD endpoints

- [ ] Port `GET /api/people` → `GET /people` on backend ✓ (implemented)
- [ ] Port `GET /api/people/[name]` → `GET /people/:name` ✓
- [ ] Port `GET /api/todos` → `GET /todos` ✓
- [ ] Port `PATCH /api/todos` → `PATCH /todos` ✓
- [ ] Port `GET|POST /api/health` → `GET|POST /health` ✓
- [ ] Update `frontend/lib/api-client.ts` to point these to DigitalOcean ✓
- [ ] Update all component `fetch` calls to use `api-client.ts` functions
  - [ ] people view
  - [ ] todos view
  - [ ] health view
- [ ] Keep old Next.js routes as fallback for 1 week
- [ ] Verify in production — check Supabase logs confirm writes are coming from backend IP
- [ ] Commit: "feat(phase3): move people, todos, health CRUD to backend"

---

## Phase 4 — Search and Ask (read-heavy, no side effects)

- [ ] Port `POST /api/memory/search` → `POST /memory/search` ✓
- [ ] Port `POST /api/memory/ask` → `POST /memory/ask` ✓
- [ ] Update frontend search component to use `api-client.ts` ✓
- [ ] Update frontend ask/chat component to use `api-client.ts` ✓
- [ ] Verify citation accuracy matches monolith behaviour
- [ ] Verify hybrid scoring returns same ranking for known queries
- [ ] Commit: "feat(phase4): move memory search and ask to backend"

---

## Phase 5 — Ingest (critical write path)

- [ ] Port `POST /api/ingest` → `POST /ingest` ✓
- [ ] Add feature flag in frontend: `USE_BACKEND_INGEST=true`
- [ ] Run both versions in parallel for 24h (shadow mode: call both, use Next.js result)
- [ ] Verify `raw_ledgers` count, embedding storage, entity extraction match expected
- [ ] Remove feature flag, point all ingest calls to backend
- [ ] Delete old `app/api/ingest/route.ts` from Next.js
- [ ] Commit: "feat(phase5): move memory ingest to backend"

---

## Phase 6 — Google OAuth

- [ ] Port `/api/google/connect` → `/google/connect` ✓
- [ ] Port `/api/google/callback` → `/google/callback` ✓
- [ ] Port `/api/google/status` → `/google/status` ✓
- [ ] Update Google Cloud Console: add new redirect URI, remove old Vercel URI
- [ ] Update `GOOGLE_REDIRECT_URI` env var on Droplet to production backend URL
- [ ] Update `frontend/lib/api-client.ts` `getGoogleConnectUrl()` to use backend URL ✓
- [ ] Update `getGoogleStatus()` calls in frontend
- [ ] Test full OAuth flow (connect → callback → status shows connected)
- [ ] Commit: "feat(phase6): move Google OAuth to backend"

---

## Phase 7 — Commands and approval engine

- [ ] Port `POST /api/tasks/execute` → `POST /tasks/execute` ✓
- [ ] Port `POST /api/commands/stage/*` → `POST /commands/stage/*` ✓
- [ ] Port `POST /api/commands/execute/[id]` → `POST /commands/execute/:id` ✓
- [ ] Port `POST /api/commands/deny/[id]` → `POST /commands/deny/:id` ✓
- [ ] Update `action-approval-modal.tsx` to call `api-client.ts` ✓
- [ ] Update task execution UI to call `api-client.ts` ✓
- [ ] Test: create a task, approve it, verify it appears in Google Tasks
- [ ] Commit: "feat(phase7): move commands and approval engine to backend"

---

## Phase 8 — Long-running jobs to PM2 workers

- [ ] Port `POST /api/memory/reflect` → `POST /memory/reflect` (on-demand) ✓
- [ ] Deploy `reflect.worker.ts` as PM2 cron (03:00 daily) ✓
- [ ] Deploy `digest.worker.ts` as PM2 cron (Monday 08:00) ✓
- [ ] Verify cron workers run at scheduled time (`pm2 logs friday-reflect-cron`)
- [ ] Update frontend: "Insights" section reads pre-generated reflections from Supabase
  - [ ] Add `weekly_summaries` table read (or keep the on-demand `/weekly-summary` endpoint)
- [ ] Remove Vercel cron config (if any) for reflect/digest
- [ ] Commit: "feat(phase8): move reflect and digest to PM2 workers"

---

## Phase 9 — Delete Next.js API routes

- [ ] Delete `app/api/` from `frontend/` (all route files)
- [ ] Remove from `frontend/package.json`:
  - [ ] `groq-sdk`
  - [ ] `googleapis`
  - [ ] Server-only Supabase imports
- [ ] Remove from `frontend/lib/`:
  - [ ] `supabase-server.ts`
  - [ ] `google-token.ts`
  - [ ] `google-staging.ts`
  - [ ] `action-staging.ts`
  - [ ] `queryAnalyzer.ts`
  - [ ] `recency.ts` (now in shared)
- [ ] Run `next build` — confirm zero API route files in output
- [ ] Confirm bundle size reduced
- [ ] Commit: "feat(phase9): frontend is now pure UI — all API routes removed"

---

## Final Verification

- [ ] All features work end-to-end from the Vercel frontend URL
- [ ] Supabase service role key is NOT present anywhere in the frontend codebase
- [ ] Google secrets are NOT present anywhere in the frontend codebase
- [ ] PM2 status shows 3 processes: friday-api (×2 cluster), reflect-cron, digest-cron
- [ ] `/healthz` returns 200
- [ ] Full ingest → search → ask cycle works
- [ ] Google OAuth connect/disconnect cycle works
- [ ] Health log → analyze works
- [ ] Weekly summary generates
- [ ] Task staging → approval → execution works

---

## Files Deleted From Next.js Monolith (end state)

```
app/api/                           ← entire directory removed
lib/google-token.ts                ← moved to backend
lib/google-staging.ts              ← moved to backend
lib/action-staging.ts              ← moved to backend
lib/queryAnalyzer.ts               ← moved to backend
lib/recency.ts                     ← moved to shared
lib/supabase-server.ts             ← moved to backend
```

## Files Kept In Frontend

```
app/page.tsx                       ← update API calls to use api-client.ts
app/layout.tsx                     ← unchanged
app/globals.css                    ← unchanged
app/offline/page.tsx               ← unchanged
components/                        ← all 14 memory + ui + pwa components (update fetch calls)
lib/supabase-client.ts             ← renamed from lib/supabase.ts (anon key only)
lib/api-client.ts                  ← NEW: typed HTTP client for backend
lib/utils.ts                       ← unchanged
public/                            ← unchanged
next.config.ts                     ← simplified
```
