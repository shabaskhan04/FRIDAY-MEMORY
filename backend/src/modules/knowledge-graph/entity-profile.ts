// ============================================================
// entity-profile.ts — Graph-native entity profiles
// ============================================================

import type { GraphRepository } from './graph.repository';
import type { GraphSearch }     from './graph.search';
import type { EntityProfile, EdgeWithNode, GraphNode } from './graph.types';

export class EntityProfiler {
  constructor(
    private readonly repo:   GraphRepository,
    private readonly search: GraphSearch,
  ) {}

  async getEntityProfile(userId: string, name: string): Promise<EntityProfile | null> {
    const node = await this.search.findByName(userId, name);
    if (!node) return null;
    return this.getEntityProfileById(userId, node.id);
  }

  async getEntityProfileById(userId: string, nodeId: string): Promise<EntityProfile | null> {
    const node = await this.repo.getNodeById(nodeId, userId);
    if (!node) return null;

    const [outRaw, inRaw] = await Promise.all([
      this.repo.getEdgesByNode(userId, nodeId, 'outbound'),
      this.repo.getEdgesByNode(userId, nodeId, 'inbound'),
    ]);

    const hydrate = async (edges: typeof outRaw, outbound: boolean): Promise<EdgeWithNode[]> =>
      (await Promise.all(edges.map(async e => {
        const connected_node = await this.repo.getNodeById(
          outbound ? e.target_node_id : e.source_node_id, userId,
        );
        return connected_node ? { edge: e, connected_node } : null;
      }))).filter((r): r is EdgeWithNode => r !== null);

    const [outgoing_edges, incoming_edges] = await Promise.all([
      hydrate(outRaw, true),
      hydrate(inRaw, false),
    ]);

    const seen = new Set<string>();
    const connected_nodes: GraphNode[] = [];
    for (const { connected_node } of [...outgoing_edges, ...incoming_edges]) {
      if (!seen.has(connected_node.id)) {
        seen.add(connected_node.id);
        connected_nodes.push(connected_node);
      }
    }

    const relationship_summary = buildSummary(node, outgoing_edges, incoming_edges);
    return { node, incoming_edges, outgoing_edges, connected_nodes, relationship_summary };
  }
}

function buildSummary(node: GraphNode, outgoing: EdgeWithNode[], incoming: EdgeWithNode[]): string {
  const lines = [`## ${node.name} [${node.node_type}]`];
  if (node.description) lines.push(node.description);

  if (outgoing.length) {
    lines.push('\n### Outgoing');
    for (const { edge, connected_node } of outgoing)
      lines.push(`  ${node.name} --[${edge.relationship_type}]--> ${connected_node.name}`);
  }
  if (incoming.length) {
    lines.push('\n### Incoming');
    for (const { edge, connected_node } of incoming)
      lines.push(`  ${connected_node.name} --[${edge.relationship_type}]--> ${node.name}`);
  }
  if (!outgoing.length && !incoming.length) lines.push('\nNo relationships recorded.');

  return lines.join('\n');
}
