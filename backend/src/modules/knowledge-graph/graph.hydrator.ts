// ============================================================
// graph.hydrator.ts — Normalize raw Supabase row → GraphNode
//
// Problem: Supabase JS deserializes VECTOR(1536) as a string
// (e.g. "[0.1,0.2,...]") instead of number[].
// GraphNode.embedding is typed as number[] | null.
// This utility parses the string into number[] at the boundary.
// ============================================================

import type { GraphNode } from './graph.types';

/**
 * Parse a VECTOR string returned by Supabase into number[].
 * Returns null for null/undefined input. Returns as-is if already an array.
 */
function parseEmbedding(raw: unknown): number[] | null {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Hydrate a single raw Supabase graph_nodes row into a typed GraphNode. */
export function hydrateNode(raw: Record<string, unknown>): GraphNode {
  return { ...(raw as unknown as GraphNode), embedding: parseEmbedding(raw.embedding) };
}

/** Hydrate an array of raw rows. */
export function hydrateNodes(rows: Record<string, unknown>[]): GraphNode[] {
  return rows.map(hydrateNode);
}

/** Hydrate a semantic search row that includes a similarity score. */
export function hydrateSemanticNode(
  raw: Record<string, unknown>,
): GraphNode & { similarity: number } {
  return { ...hydrateNode(raw), similarity: raw.similarity as number };
}
