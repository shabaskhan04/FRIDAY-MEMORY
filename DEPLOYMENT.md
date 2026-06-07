# Friday — Deployment Runbook

## Overview

| Tier      | Platform              | Entry point                    |
|-----------|-----------------------|-------------------------------|
| Frontend  | Vercel                | `frontend/`                   |
| Backend   | DigitalOcean Droplet  | `backend/` via PM2            |
| Database  | Supabase (unchanged)  | No migration required         |

---

## Step 0 — Generate the API secret

Run once, store it somewhere safe:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set this value as:
- `FRIDAY_API_SECRET` on DigitalOcean
- `NEXT_PUBLIC_FRIDAY_API_SECRET` on Vercel

---

## Step 1 — DigitalOcean Droplet Setup

Recommended: Ubuntu 24.04, 2 vCPU / 2 GB RAM (Basic Droplet ~$18/month).

```bash
# 1. SSH in and update
apt update && apt upgrade -y

# 2. Install Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs git

# 3. Install PM2
npm install -g pm2

# 4. Clone repo
git clone https://github.com/youruser/friday.git /opt/friday
cd /opt/friday

# 5. Install dependencies and build
npm install                   # installs all workspaces
npm run build                 # builds shared → backend

# 6. Create .env.local
cp .env.local.example .env.local
nano .env.local               # fill in production values

# Copy .env.local into backend directory for PM2/Node resolution
cp .env.local backend/.env.local

# 7. Start with PM2
cd backend
pm2 start ecosystem.config.js --env production
pm2 save
pm2 startup                   # follow the printed command to enable auto-start
```

---

## Step 2 — DigitalOcean Firewall

Allow only these ports inbound on the Droplet firewall:
- 22 (SSH — restrict to your IP)
- 80 (HTTP — for Let's Encrypt / nginx proxy)
- 443 (HTTPS)

Do NOT expose port 3001 publicly. Use nginx as a reverse proxy.

```nginx
# /etc/nginx/sites-available/friday-api
server {
    listen 80;
    server_name api.friday.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name api.friday.yourdomain.com;

    ssl_certificate     /etc/letsencrypt/live/api.friday.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.friday.yourdomain.com/privkey.pem;

    location / {
        proxy_pass         http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 90s;     # allows long AI calls up to 90s
    }
}
```

```bash
# Install certbot and get SSL
apt install -y certbot python3-certbot-nginx
certbot --nginx -d api.friday.yourdomain.com
```

---

## Step 3 — Update Google OAuth Redirect URI

1. Go to [Google Cloud Console](https://console.cloud.google.com) → APIs & Services → Credentials
2. Find your OAuth 2.0 Client ID
3. Under "Authorised redirect URIs" add: `https://api.friday.yourdomain.com/google/callback`
4. Remove the old Vercel URI (e.g. `https://friday.vercel.app/api/google/callback`)
5. Save

---

## Step 4 — Vercel Deployment

```bash
cd frontend
vercel --prod
```

Set these environment variables in the Vercel dashboard:

| Variable                       | Value                                        |
|-------------------------------|----------------------------------------------|
| `NEXT_PUBLIC_SUPABASE_URL`    | `https://your-ref.supabase.co`              |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon key                             |
| `NEXT_PUBLIC_APP_PASSWORD`    | your app password                            |
| `NEXT_PUBLIC_FRIDAY_API_URL`  | `https://api.friday.yourdomain.com`         |
| `NEXT_PUBLIC_FRIDAY_API_SECRET` | the secret from Step 0                   |

---

## Step 5 — Smoke Tests

```bash
# 1. Backend health probe
curl https://api.friday.yourdomain.com/healthz
# Expected: {"ok":true,"ts":"...","env":"production"}

# 2. Auth gate
curl https://api.friday.yourdomain.com/todos
# Expected: {"error":"Unauthorized."}

# 3. Authenticated request
curl -H "Authorization: Bearer YOUR_SECRET" \
     https://api.friday.yourdomain.com/todos
# Expected: {"todos":[...]}

# 4. Google status
curl -H "Authorization: Bearer YOUR_SECRET" \
     https://api.friday.yourdomain.com/google/status
# Expected: {"connected":false} (until you authorise)

# 5. Frontend → open https://friday.vercel.app and verify dashboard loads
```

---

## PM2 Cheatsheet

```bash
pm2 status                          # show all processes
pm2 logs friday-api --lines 50      # tail API logs
pm2 logs friday-reflect-cron        # tail last reflect run
pm2 reload friday-api               # zero-downtime reload
pm2 restart friday-api              # hard restart

# Run workers manually
cd /opt/friday/backend
npx tsx src/workers/reflect.worker.ts    # test reflect
npx tsx src/workers/digest.worker.ts     # test digest
```

---

## Deploy Updates

```bash
cd /opt/friday
git pull
npm run build               # rebuild shared + backend
cd backend
pm2 reload friday-api       # zero-downtime reload
# PM2 cron workers pick up the new build on their next scheduled run
```

---

## Rollback

PM2 keeps the previous version of the process in memory during reload.
If something is broken:

```bash
pm2 revert friday-api       # restores previous process
```

For a full code rollback:

```bash
cd /opt/friday
git revert HEAD --no-edit
npm run build
cd backend && pm2 reload friday-api
```
