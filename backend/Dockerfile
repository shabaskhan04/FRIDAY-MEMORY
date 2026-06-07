# ── Stage 1: Build ───────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Copy shared package first (workspace dependency)
COPY shared/package*.json ./shared/
COPY shared/tsconfig.json  ./shared/
COPY shared/src/           ./shared/src/

# Build shared
WORKDIR /app/shared
RUN npm ci && npm run build

# Copy backend
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci

COPY backend/tsconfig.json ./
COPY backend/src/          ./src/

# Resolve @friday/shared to the local build
RUN node -e "\
  const p = require('./package.json'); \
  p.dependencies['@friday/shared'] = 'file:../shared'; \
  require('fs').writeFileSync('./package.json', JSON.stringify(p, null, 2)); \
"
RUN npm install --prefer-offline

RUN npm run build

# ── Stage 2: Production runtime ─────────────────────────────
FROM node:22-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

# Install PM2 globally
RUN npm install -g pm2

COPY --from=builder /app/backend/dist         ./dist
COPY --from=builder /app/backend/node_modules ./node_modules
COPY --from=builder /app/backend/package.json ./package.json
COPY backend/ecosystem.config.js               ./ecosystem.config.js

EXPOSE 3001

# Health check (DigitalOcean App Platform / DO Droplet health probe)
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/healthz || exit 1

CMD ["pm2-runtime", "ecosystem.config.js", "--env", "production"]
