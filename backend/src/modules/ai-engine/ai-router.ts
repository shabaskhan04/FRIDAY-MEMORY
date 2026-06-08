// ============================================================
// ai-router.ts — AI Gateway
// Rules #2, #3, #4, #6, #9, #10, #11
//
// ALL LLM calls MUST go through this module.
// No module may call groq.chat.completions.create() directly.
// ============================================================
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AIFeature, AIModel, AIProvider } from './ai-usage';
import {
  recordUsageInMemory, logUsageToDb, estimateCost,
} from './ai-usage';
import {
  hashPrompt, getCached, setCached,
} from './ai-cache';
import {
  checkRateLimit, enforceTokenBudget, estimateTokens,
} from './ai-rate-limiter';

// ---- Model routing (Rule #3) ------------------------------

// L1 tasks: 8B model — fast, cheap, sufficient
const L1_MODEL: AIModel    = 'llama-3.1-8b-instant';
const L1_PROVIDER: AIProvider = 'groq';

// L2 tasks: 70B model — strategic, complex reasoning
const L2_MODEL: AIModel    = 'llama-3.3-70b-versatile';
const L2_PROVIDER: AIProvider = 'groq';

// Features that require L2 (Rule #3)
const L2_FEATURES = new Set<AIFeature>([
  'ask_friday',
  'weekly_review',
  'strategic_review',
]);

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GroqClient {
  chat: {
    completions: {
      create(params: {
        model: string;
        messages: ChatMessage[];
        max_tokens?: number;
        temperature?: number;
      }): Promise<{
        choices: Array<{ message: { content: string } }>;
        usage?: { prompt_tokens: number; completion_tokens: number };
      }>;
    };
  };
}

export interface OpenAIClient {
  embeddings: {
    create(params: {
      model: string;
      input: string | string[];
    }): Promise<{
      data: Array<{ embedding: number[] }>;
      usage?: { total_tokens: number };
    }>;
  };
}

// ---- Router -----------------------------------------------

export class AIRouter {
  constructor(
    private readonly groq:   GroqClient,
    private readonly openai: OpenAIClient,
    private readonly db:     SupabaseClient | null = null,
    private readonly userId: string = 'system',
  ) {}

  /**
   * generate() — general text completion.
   * Routes to L1 or L2 based on feature. Caches result.
   */
  async generate(
    feature: AIFeature,
    systemPrompt: string,
    userPrompt: string,
    options: { temperature?: number; maxTokens?: number } = {},
  ): Promise<string> {
    checkRateLimit(feature);

    const combined = systemPrompt + '\n' + userPrompt;
    enforceTokenBudget(feature, estimateTokens(combined));

    const key = hashPrompt(systemPrompt, userPrompt);
    const cached = await getCached(this.db, key);
    if (cached) return cached;

    const model    = L2_FEATURES.has(feature) ? L2_MODEL    : L1_MODEL;
    const provider = L2_FEATURES.has(feature) ? L2_PROVIDER : L1_PROVIDER;
    const t0 = Date.now();

    const result = await this.callWithFallback(model, [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ], options);

    const latency_ms = Date.now() - t0;
    const tokens_in  = result.usage?.prompt_tokens     ?? estimateTokens(combined);
    const tokens_out = result.usage?.completion_tokens ?? estimateTokens(result.text);
    const cost       = estimateCost(model, tokens_in, tokens_out);

    recordUsageInMemory({ feature, provider, model, tokens_in, tokens_out, estimated_cost: cost, cached: false, latency_ms, timestamp: new Date().toISOString() });
    if (this.db) await logUsageToDb(this.db, this.userId, { feature, provider, model, tokens_in, tokens_out, estimated_cost: cost, cached: false, latency_ms, timestamp: new Date().toISOString() });
    await setCached(this.db, key, result.text, feature);

    return result.text;
  }

  /**
   * extract() — structured JSON extraction. Always L1.
   * Rule #8: accepts multiple inputs for batch processing.
   */
  async extract(
    feature: AIFeature,
    systemPrompt: string,
    inputs: string[],
  ): Promise<string[]> {
    if (!inputs.length) return [];

    // Rule #8: batch up to 8 items into a single call
    const BATCH = 8;
    const results: string[] = [];

    for (let i = 0; i < inputs.length; i += BATCH) {
      const batch = inputs.slice(i, i + BATCH);
      const batchPrompt = batch.length === 1
        ? batch[0]
        : batch.map((t, j) => `## Item ${j + 1}\n${t}`).join('\n\n---\n\n');

      const raw = await this.generate(feature, systemPrompt, batchPrompt);

      // For multi-item batches, split by JSON objects
      if (batch.length === 1) {
        results.push(raw);
      } else {
        const parsed = this.splitBatchResponse(raw, batch.length);
        results.push(...parsed);
      }
    }

    return results;
  }

  /**
   * classify() — always L1. Returns category string.
   */
  async classify(
    feature: AIFeature,
    systemPrompt: string,
    input: string,
  ): Promise<string> {
    return this.generate(feature, systemPrompt, input);
  }

  /**
   * summarize() — L1 for short, L2 for weekly/strategic.
   */
  async summarize(
    feature: AIFeature,
    systemPrompt: string,
    content: string,
  ): Promise<string> {
    return this.generate(feature, systemPrompt, content);
  }

  /**
   * embed() — OpenAI text-embedding-3-small only.
   * Rule #7: only for memory ingestion and semantic retrieval.
   */
  async embed(texts: string | string[]): Promise<number[][]> {
    const inputs = Array.isArray(texts) ? texts : [texts];
    const t0 = Date.now();

    const response = await this.openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: inputs,
    });

    const tokens    = response.usage?.total_tokens ?? inputs.reduce((s, t) => s + estimateTokens(t), 0);
    const cost      = estimateCost('text-embedding-3-small', tokens, 0);
    const latency_ms = Date.now() - t0;

    recordUsageInMemory({
      feature: 'memory_extraction', provider: 'openai', model: 'text-embedding-3-small',
      tokens_in: tokens, tokens_out: 0, estimated_cost: cost,
      cached: false, latency_ms, timestamp: new Date().toISOString(),
    });
    if (this.db) await logUsageToDb(this.db, this.userId, {
      feature: 'memory_extraction', provider: 'openai', model: 'text-embedding-3-small',
      tokens_in: tokens, tokens_out: 0, estimated_cost: cost,
      cached: false, latency_ms, timestamp: new Date().toISOString(),
    });

    return response.data.map(d => d.embedding);
  }

  // ---- Fallback chain (Rule #11) ---------------------------

  private async callWithFallback(
    model: AIModel,
    messages: ChatMessage[],
    options: { temperature?: number; maxTokens?: number },
  ): Promise<{ text: string; usage?: { prompt_tokens: number; completion_tokens: number } }> {
    // Try primary model
    try {
      const res = await this.groq.chat.completions.create({
        model,
        messages,
        max_tokens:  options.maxTokens  ?? 1024,
        temperature: options.temperature ?? 0.2,
      });
      return {
        text:  res.choices[0].message.content,
        usage: res.usage as any,
      };
    } catch (primaryErr) {
      // L2 → L1 fallback
      if (model === L2_MODEL) {
        try {
          const res = await this.groq.chat.completions.create({
            model:       L1_MODEL,
            messages,
            max_tokens:  options.maxTokens  ?? 1024,
            temperature: options.temperature ?? 0.2,
          });
          return { text: res.choices[0].message.content, usage: res.usage as any };
        } catch { /* fall through */ }
      }
      // L1/L2 → rule-based empty response (never fail completely)
      console.error('[AIRouter] All models failed, returning empty:', primaryErr);
      return { text: '' };
    }
  }

  private splitBatchResponse(raw: string, count: number): string[] {
    // Extract up to `count` JSON objects from a batch response
    const results: string[] = [];
    const cleaned = raw.replace(/```(?:json)?\n?/g, '').replace(/```/g, '');
    let depth = 0, start = -1;
    for (let i = 0; i < cleaned.length; i++) {
      if (cleaned[i] === '{') { if (depth === 0) start = i; depth++; }
      else if (cleaned[i] === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          results.push(cleaned.slice(start, i + 1));
          start = -1;
          if (results.length >= count) break;
        }
      }
    }
    // Pad with empty objects if batch split failed
    while (results.length < count) results.push('{}');
    return results;
  }
}
