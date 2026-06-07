// ============================================================
// normalizer.ts — Raw content → structured NormalizedContent
// ============================================================
import type { NormalizedContent } from './ingestion.types';

/** djb2 hash — no crypto dependency */
function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0; // keep unsigned 32-bit
  }
  return h.toString(16).padStart(8, '0');
}

export class IngestionNormalizer {
  contentHash(content: string): string {
    return djb2(content.trim());
  }

  extractExternalId(raw: string, sourceType: string): string {
    // Try to pull an ID from common patterns
    const patterns: RegExp[] = [
      /["']id["']\s*:\s*["']([^"']+)["']/,
      /sha:\s*([a-f0-9]{7,40})/i,
      /uid:\s*([^\s,]+)/i,
      /message-id:\s*<([^>]+)>/i,
    ];
    for (const re of patterns) {
      const m = raw.match(re);
      if (m) return `${sourceType}:${m[1]}`;
    }
    return `${sourceType}:${this.contentHash(raw)}`;
  }

  normalize(raw: string, sourceType: string): NormalizedContent {
    const trimmed = raw.trim();
    const lines   = trimmed.split('\n').filter(Boolean);
    const title   = lines[0]?.slice(0, 200) ?? sourceType;
    const body    = trimmed;
    return {
      title,
      body,
      occurred_at:  new Date().toISOString(),
      external_id:  this.extractExternalId(trimmed, sourceType),
      content_hash: this.contentHash(trimmed),
      metadata:     { source_type: sourceType, char_count: trimmed.length },
    };
  }
}
