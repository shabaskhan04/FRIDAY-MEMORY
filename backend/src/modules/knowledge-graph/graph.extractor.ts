// ============================================================
// graph.extractor.ts — LLM extraction pipeline
// Rule #2: uses AIRouter, never calls Groq directly
// Rule #8: batchExtract() processes multiple memories in 1 call
// ============================================================

import type { AIRouter } from '../ai-engine/ai-router';
import type {
  ExtractionResult, ExtractedNode, ExtractedEdge, NodeType, RelationshipType,
} from './graph.types';
import { ExtractionResultSchema } from './graph.schemas';
import { EXTRACTION_SYSTEM_PROMPT, buildExtractionUserPrompt } from './prompts/extraction.prompt';

const VALID_NODE_TYPES = new Set([
  'PERSON', 'PROJECT', 'BUSINESS', 'GOAL', 'TASK',
  'EVENT', 'LOCATION', 'MEMORY', 'HEALTH_METRIC', 'CONCEPT', 'DOCUMENT', 'CUSTOM',
]);
const VALID_REL_TYPES = new Set([
  'OWNS', 'WORKS_ON', 'CONNECTED_TO', 'MENTIONED_WITH', 'FRIEND_OF',
  'CLIENT_OF', 'RELATED_TO', 'PART_OF', 'LOCATED_IN', 'DEPENDS_ON',
  'CAUSED_BY', 'GOAL_OF', 'TRACKS', 'ATTENDED', 'INTERESTED_IN',
  'SPOKE_WITH', 'REQUESTED', 'MANAGES', 'CREATED', 'EMPLOYED_BY',
  'BUSINESS_PARTNER', 'COFOUNDER', 'WORKS_WITH',
  'MANAGER_OF', 'REPORTS_TO', 'FAMILY_MEMBER',
]);

// Role-descriptor phrases that should never become standalone nodes.
// These are possessive role labels, not entity names.
const ROLE_DESCRIPTOR_PATTERNS = [
  /^my\s+(business\s+partner|friend|sister|brother|mother|father|parent|manager|boss|employee|client|colleague|partner|cofounder|co-founder|mentor|assistant|teammate)s?$/i,
];

function isRoleDescriptor(name: string): boolean {
  return ROLE_DESCRIPTOR_PATTERNS.some(p => p.test(name.trim()));
}

export class GraphExtractor {
  constructor(private readonly router: AIRouter) {}

  // ---- Single memory extraction ----------------------------

  async extractFromMemory(rawMemory: string, existingContext?: string): Promise<ExtractionResult> {
    const userPrompt = buildExtractionUserPrompt(rawMemory, existingContext);
    const raw = await this.router.generate(
      'memory_extraction',
      EXTRACTION_SYSTEM_PROMPT,
      userPrompt,
    );
    return this.parseAndValidate(raw);
  }

  // ---- Rule #8: batch extraction (up to 8 memories per LLM call) ---

  async batchExtract(memories: string[]): Promise<ExtractionResult[]> {
    if (!memories.length) return [];
    const raws = await this.router.extract(
      'batch_extraction',
      EXTRACTION_SYSTEM_PROMPT,
      memories.map(m => buildExtractionUserPrompt(m)),
    );
    return raws.map(raw => {
      try { return this.parseAndValidate(raw); }
      catch { return { nodes: [], edges: [], raw_llm_response: raw }; }
    });
  }

  // ---- Confidence reassessment (only if avgConfidence < 0.65) ---

  async assessConfidence(rawMemory: string, extraction: ExtractionResult): Promise<ExtractionResult> {
    const { CONFIDENCE_ASSESSMENT_PROMPT } = await import('./prompts/confidence.prompt');
    const prompt = CONFIDENCE_ASSESSMENT_PROMPT
      .replace('{{MEMORY}}', rawMemory)
      .replace('{{EXTRACTION}}', JSON.stringify({ nodes: extraction.nodes, edges: extraction.edges }));

    const raw = await this.router.generate(
      'confidence_reassessment',
      'You are a critical AI reviewer. Respond only in JSON.',
      prompt,
    );
    try {
      const reassessed = parseJSON(raw);
      if (!reassessed?.nodes?.length) return extraction;
      return {
        nodes: sanitizeNodes(reassessed.nodes ?? extraction.nodes),
        edges: sanitizeEdges(reassessed.edges ?? extraction.edges, reassessed.nodes ?? extraction.nodes),
        raw_llm_response: raw,
      };
    } catch { return extraction; }
  }

  // ---- Helpers ---------------------------------------------

  private parseAndValidate(raw: string): ExtractionResult {
    console.log("[RAW EXTRACTION JSON]", raw);
    const parsed = parseJSON(raw);
    // Sanitize FIRST — maps unknown node_type → CUSTOM, unknown relationship_type → RELATED_TO.
    // Only then run strict schema validation, which is now guaranteed to pass.
    const nodes = sanitizeNodes(parsed.nodes ?? []);
    const edges = sanitizeEdges(parsed.edges ?? [], nodes);
    console.log("[SANITIZED NODES]", nodes.map(n => ({ name: n.name, type: n.node_type })));
    console.log("[SANITIZED EDGES]", edges.map(e => ({ source: e.source, rel: e.relationship_type, target: e.target })));
    // Validate the already-sanitized output — this must not throw.
    ExtractionResultSchema.parse({ nodes, edges, raw_llm_response: raw });
    return { nodes, edges, raw_llm_response: raw };
  }
}

function parseJSON(raw: string): any {
  const cleaned = raw.replace(/```(?:json)?\n?/g, '').replace(/```/g, '').trim();
  const start   = cleaned.indexOf('{');
  const end     = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('No JSON in response');
  return JSON.parse(cleaned.slice(start, end + 1));
}

function sanitizeNodes(nodes: any[]): ExtractedNode[] {
  return (nodes ?? [])
    .filter(n => n?.name && typeof n.name === 'string')
    .filter(n => {
      if (isRoleDescriptor(n.name)) {
        console.warn(`[graph] dropped role-descriptor node: "${n.name}"`);
        return false;
      }
      return true;
    })
    .map(n => ({
      name:        n.name.trim(),
      node_type:   VALID_NODE_TYPES.has(n.node_type) ? n.node_type as NodeType : (() => {
        console.warn(`[graph] unknown node type: "${n.node_type}" -> CUSTOM`);
        return 'CUSTOM' as NodeType;
      })(),
      description: n.description ?? undefined,
      aliases:     Array.isArray(n.aliases) ? n.aliases : [],
      confidence:  typeof n.confidence === 'number' ? Math.min(1, Math.max(0, n.confidence)) : 0.7,
      metadata:    n.metadata ?? {},
    }));
}

function sanitizeEdges(edges: any[], nodes: ExtractedNode[]): ExtractedEdge[] {
  const nodeNames = new Set(nodes.map(n => n.name));
  return (edges ?? [])
    .filter(e => e?.source && e?.target && e?.relationship_type)
    .filter(e => {
      if (e.source === e.target) {
        console.warn(`[graph] skipped self-loop edge: "${e.source}" → "${e.target}"`);
        return false;
      }
      return nodeNames.has(e.source) && nodeNames.has(e.target);
    })
    .map(e => ({
      source:            e.source.trim(),
      target:            e.target.trim(),
      relationship_type: VALID_REL_TYPES.has(e.relationship_type)
        ? e.relationship_type as RelationshipType : (() => {
          console.warn(`[graph] unknown relationship type: "${e.relationship_type}" -> RELATED_TO`);
          return 'RELATED_TO' as RelationshipType;
        })(),
      confidence: typeof e.confidence === 'number' ? Math.min(1, Math.max(0, e.confidence)) : 0.7,
      metadata:   e.metadata ?? {},
    }));
}
