import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";

import { authMiddleware } from "./middleware/auth";
import { ingestRoutes } from "./routes/ingest";
import { memoryAskRoutes } from "./routes/memory/ask";
import { memorySearchRoutes } from "./routes/memory/search";
import { memoryReflectRoutes } from "./routes/memory/reflect";
import { weeklySummaryRoutes } from "./routes/weekly-summary";
import { healthRoutes } from "./routes/health";
import { tasksRoutes } from "./routes/tasks";
import { commandsRoutes } from "./routes/commands/index";
import { googleRoutes } from "./routes/google/index";
import { peopleRoutes } from "./routes/people";
import { todosRoutes } from "./routes/todos";

const PORT = parseInt(process.env.PORT ?? "3001", 10);
const HOST = process.env.HOST ?? "0.0.0.0";

async function build() {
  const app = Fastify({
    logger: {
      level: process.env.NODE_ENV === "production" ? "warn" : "info",
      transport:
        process.env.NODE_ENV !== "production"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
  });

  // ── Security ─────────────────────────────────────────────────
  await app.register(helmet, { contentSecurityPolicy: false });

  await app.register(cors, {
    origin: (origin, callback) => {
      const allowed = process.env.ALLOWED_ORIGIN ?? "http://localhost:3000";
      const allowList = allowed.split(",").map((s) => s.trim());

      // Allow non-browser requests (curl, server-to-server, same-origin callbacks)
      if (!origin) return callback(null, true);
      if (allowList.includes(origin)) return callback(null, true);

      callback(new Error(`CORS: origin '${origin}' is not allowed.`), false);
    },
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: true,
  });

  // ── Auth gate (all routes except /healthz and /google/callback) ──
  app.addHook("onRequest", authMiddleware);

  // ── Health probe (unauthenticated, for DO/PM2 health checks) ─
  app.get("/healthz", async () => ({
    ok: true,
    ts: new Date().toISOString(),
    env: process.env.NODE_ENV ?? "development",
  }));

  // ── Register all feature routes ───────────────────────────────
  await app.register(ingestRoutes);
  await app.register(memoryAskRoutes);
  await app.register(memorySearchRoutes);
  await app.register(memoryReflectRoutes);
  await app.register(weeklySummaryRoutes);
  await app.register(healthRoutes);
  await app.register(tasksRoutes);
  await app.register(commandsRoutes);
  await app.register(googleRoutes);
  await app.register(peopleRoutes);
  await app.register(todosRoutes);

  return app;
}

async function start() {
  const app = await build();

  try {
    await app.listen({ port: PORT, host: HOST });
    console.log(`[friday-api] Listening on http://${HOST}:${PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void start();
