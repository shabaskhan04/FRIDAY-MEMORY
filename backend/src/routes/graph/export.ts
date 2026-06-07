import type { FastifyInstance } from 'fastify';
import { getFridayUserId, createServiceClient } from '../../lib/supabase';
import type { GraphNode, GraphEdge } from '../../modules/knowledge-graph/graph.types';

export async function graphExportRoutes(app: FastifyInstance): Promise<void> {
  app.get('/graph/export', async (_request, reply) => {
    const userId = getFridayUserId();
    const db     = createServiceClient();

    const [{ data: nodes }, { data: edges }] = await Promise.all([
      db.from('graph_nodes').select().eq('user_id', userId).eq('is_archived', false),
      db.from('graph_edges').select().eq('user_id', userId).eq('is_archived', false),
    ]);

    return reply.send({
      nodes: (nodes ?? []).map((n: GraphNode) => ({
        id:    n.id,
        label: n.name,
        type:  n.node_type,
        data:  { description: n.description, importance: n.importance_score, mentions: n.mention_count },
      })),
      edges: (edges ?? []).map((e: GraphEdge) => ({
        id:     e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        label:  e.relationship_type,
        data:   { strength: e.strength, confidence: e.confidence },
      })),
      node_count:  (nodes ?? []).length,
      edge_count:  (edges ?? []).length,
      exported_at: new Date().toISOString(),
    });
  });
}
