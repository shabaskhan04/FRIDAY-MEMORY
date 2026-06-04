# LXV Cognitive Router

Layer 1 Ingestion Protocol — a Next.js 15 app that routes unstructured voice/text input into structured temporal memories and entity records using Groq + Supabase.

---

## Project Structure

```
cognitive-router/
├── app/
│   ├── globals.css          ← Baseline reset
│   ├── layout.tsx           ← Root layout + metadata
│   ├── page.tsx             ← Full UI (client component)
│   └── api/
│       └── ingest/
│           └── route.ts     ← POST /api/ingest — Groq + DB writes
├── lib/
│   └── supabase.ts          ← Supabase client factory
├── supabase/
│   └── setup.sql            ← Run once in Supabase SQL Editor
├── .env.local.example       ← Copy → .env.local, fill in keys
├── .gitignore
├── next.config.ts
├── package.json
└── tsconfig.json
```

---

## Prerequisites

- Node.js 18.17 or later — https://nodejs.org
- A Supabase account — https://supabase.com (free tier works)
- A Groq API key — https://console.groq.com/keys (free tier works)

---

## Step 1 — Get Your API Keys

### Supabase
1. Go to https://supabase.com and create a new project.
2. Wait for it to provision (~1 min).
3. Go to **Project Settings → API**.
4. Copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Groq
1. Go to https://console.groq.com/keys.
2. Click **Create API Key**.
3. Copy the key → `GROQ_API_KEY`

---

## Step 2 — Set Up the Database

1. In your Supabase project, go to **SQL Editor → New Query**.
2. Paste the entire contents of `supabase/setup.sql`.
3. Click **Run**.

You should see three tables created: `raw_ledgers`, `temporal_memories`, `entity_ledger`.

---

## Step 3 — Configure Environment Variables

In the project root, copy the example file:

```bash
cp .env.local.example .env.local
```

Open `.env.local` and fill in your three keys:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
GROQ_API_KEY=gsk_...
```

---

## Step 4 — Install Dependencies

```bash
npm install
```

---

## Step 5 — Run Locally

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

---

## Step 6 — Deploy to Vercel (Recommended)

Vercel is the fastest way to deploy a Next.js app.

### Option A — Vercel CLI (fastest)

```bash
# Install Vercel CLI globally (one-time)
npm install -g vercel

# From the project root:
vercel

# Follow the prompts:
# - Set up and deploy? → Y
# - Which scope? → your account
# - Link to existing project? → N
# - Project name? → cognitive-router (or any name)
# - Directory? → ./  (just press Enter)
```

After the first deploy, add your environment variables:

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY
vercel env add GROQ_API_KEY
```

Then redeploy to apply them:

```bash
vercel --prod
```

### Option B — Vercel Dashboard (drag and drop)

1. Go to https://vercel.com/new.
2. Import your GitHub repo (push the project to GitHub first), OR drag and drop the project folder.
3. In the **Environment Variables** section, add all three keys.
4. Click **Deploy**.

Your live URL will be: `https://cognitive-router-xxx.vercel.app`

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `Missing Supabase env vars` error | Make sure `.env.local` exists and has all three keys |
| 500 from `/api/ingest` | Check Vercel logs or terminal — usually a Groq API key issue |
| Data not appearing in notebook | Run `setup.sql` again; check RLS is disabled |
| Voice button does nothing | Chrome/Edge only; Safari has partial support; must be on HTTPS in prod |
| `groq-sdk not found` | Run `npm install` again |

---

## Tech Stack

- **Next.js 15** (App Router, TypeScript)
- **Groq SDK** — `llama-3.3-70b-versatile` with native JSON mode
- **Supabase** — PostgreSQL database
- **Lucide React** — Icons
- **Web Speech API** — Browser-native voice transcription
