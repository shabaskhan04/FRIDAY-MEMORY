// ============================================================
// prompts/confidence.prompt.ts
// Self-evaluation prompt for extraction confidence reassessment
// ============================================================

export const CONFIDENCE_ASSESSMENT_PROMPT = `You are reviewing a knowledge graph extraction for accuracy.

## Original memory:
"{{MEMORY}}"

## Current extraction:
{{EXTRACTION}}

## Your task:
1. For each node: verify it is clearly present in the memory. Reduce confidence for vague mentions.
2. For each edge: verify the relationship is explicitly stated or strongly implied. Remove hallucinated edges.
3. Correct node_type if misclassified.
4. Return the corrected extraction as JSON in the SAME format.

Rules:
- Do NOT add nodes not in the original extraction.
- Only reduce or maintain confidence values — never increase beyond the original.
- If an edge is clearly wrong, remove it entirely.
- Return ONLY valid JSON.

{
  "nodes": [...],
  "edges": [...]
}`;
