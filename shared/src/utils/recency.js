"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recencyScore = recencyScore;
/**
 * Flat 2-tier recency scoring for lifelong memory.
 *
 * Memories from the last 30 days get a slight boost (1.0),
 * while all older memories remain highly accessible (0.9).
 * No memory ever decays below 0.9.
 *
 * The SQL RPC (match_memories_hybrid) uses the same logic via CASE WHEN.
 * This TypeScript version is the canonical reference for any
 * in-memory pipelines that run outside the SQL layer.
 */
function recencyScore(createdAt) {
    const days = (Date.now() - new Date(createdAt).getTime()) / (1000 * 3600 * 24);
    return days < 30 ? 1.0 : 0.9;
}
//# sourceMappingURL=recency.js.map