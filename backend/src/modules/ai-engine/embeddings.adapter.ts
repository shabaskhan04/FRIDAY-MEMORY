// ============================================================
// embeddings.adapter.ts
//
// Adapts the production generateEmbedding() function to satisfy
// AIRouter's OpenAIClient interface without installing the OpenAI SDK.
// ============================================================

import { generateEmbedding } from '../../lib/embeddings';
import type { OpenAIClient } from './ai-router';

/**
 * Builds an OpenAIClient-compatible object backed by the existing
 * generateEmbedding() dispatcher (supports openai/huggingface/ollama
 * via EMBEDDING_PROVIDER env var).
 *
 * Handles batch input by running requests in parallel.
 * If any embedding fails (generateEmbedding returns null), throws so
 * AIRouter can surface the error rather than silently producing bad data.
 */
export function createEmbeddingAdapter(): OpenAIClient {
  return {
    embeddings: {
      async create(params: { model: string; input: string | string[] }) {
        const inputs = Array.isArray(params.input) ? params.input : [params.input];
        const results = await Promise.all(inputs.map(generateEmbedding));

        for (let i = 0; i < results.length; i++) {
          if (results[i] === null) {
            throw new Error(`[EmbeddingAdapter] embedding failed for input index ${i}`);
          }
        }

        return {
          data: (results as number[][]).map(embedding => ({ embedding })),
          // Supabase/Groq paths don't use token counts from embeddings;
          // returning 0 keeps AIRouter's cost accounting a no-op (cost = $0 for non-OpenAI).
          usage: { total_tokens: 0 },
        };
      },
    },
  };
}
