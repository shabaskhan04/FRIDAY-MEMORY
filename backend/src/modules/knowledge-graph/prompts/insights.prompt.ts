// ============================================================
// prompts/insights.prompt.ts
// Prompts for Ask Friday graph context injection
// ============================================================

export function buildGraphContextPrompt(
  question: string,
  relevantNodes: Array<{ name: string; type: string; description: string | null; importance: number }>,
  relevantEdges: Array<{ source: string; target: string; relationship: string; strength: number }>,
): string {
  const nodeLines = relevantNodes
    .slice(0, 15)
    .map(n => `- [${n.type}] ${n.name}${n.description ? ': ' + n.description : ''} (importance: ${n.importance.toFixed(2)})`)
    .join('\n');

  const edgeLines = relevantEdges
    .slice(0, 20)
    .map(e => `- ${e.source} --[${e.relationship}]--> ${e.target} (strength: ${e.strength.toFixed(2)})`)
    .join('\n');

  return `## Knowledge Graph Context

The following entities and relationships are relevant to this question:

### Entities:
${nodeLines || 'None found'}

### Relationships:
${edgeLines || 'None found'}

## Question: ${question}

Use the graph context above to give a more precise and connected answer. 
Reference specific entities and relationships where relevant.`;
}

export function buildWeeklyDigestPrompt(
  insights: Array<{ title: string; description: string; type: string }>,
  topNodes: Array<{ name: string; type: string; importance: number }>,
): string {
  const insightLines = insights
    .slice(0, 8)
    .map(i => `- [${i.type}] ${i.title}: ${i.description}`)
    .join('\n');

  const nodeLines = topNodes
    .slice(0, 10)
    .map(n => `- ${n.name} (${n.type}, importance: ${n.importance.toFixed(2)})`)
    .join('\n');

  return `## Knowledge Graph Weekly Summary

### Top Insights:
${insightLines || 'No insights yet'}

### Most Important Entities This Week:
${nodeLines || 'No entities yet'}

Generate a concise weekly digest section that:
1. Highlights what the user has been focused on
2. Calls out neglected goals or disconnected projects
3. Surfaces emerging patterns or rising importance entities
4. Suggests one actionable focus for next week

Keep it conversational, under 200 words.`;
}
