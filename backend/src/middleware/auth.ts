import type { FastifyRequest, FastifyReply } from "fastify";
import { timingSafeEqual } from "crypto";

/**
 * Validates the Authorization: Bearer <FRIDAY_API_SECRET> header.
 * Skip auth on /healthz (internal probe) and /google/callback (OAuth redirect).
 */
export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const skip = ["/healthz", "/google/callback"];
  if (skip.some((p) => request.url.startsWith(p))) return;

  const apiSecret = process.env.FRIDAY_API_SECRET;
  if (!apiSecret) {
    reply.code(500).send({ error: "FRIDAY_API_SECRET is not configured on the server." });
    return;
  }

  const authHeader = request.headers["authorization"] ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  const valid =
    token.length > 0 &&
    token.length === apiSecret.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(apiSecret));

  if (!valid) {
    reply.code(401).send({ error: "Unauthorized." });
  }
}
