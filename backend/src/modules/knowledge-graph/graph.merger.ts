// ============================================================
// graph.merger.ts — Duplicate detection and node merging
// T9: is_locked enforcement
// ============================================================

import type { GraphRepository } from './graph.repository';
import type {
  GraphNode, DuplicateCandidate, MergeDecision,
} from './graph.types';

const AUTO_MERGE_THRESHOLD    = 0.95;
const SUGGEST_MERGE_THRESHOLD = 0.75;

export class GraphMerger {
  constructor(private readonly repo: GraphRepository) {}

  // ---- Duplicate detection ----------------------------------

  async findDuplicateCandidates(
    userId: string,
    node: GraphNode | { name: string; node_type: string; embedding?: number[] },
    existingNodeId?: string,
  ): Promise<DuplicateCandidate[]> {
    const candidates: DuplicateCandidate[] = [];
    const seenIds = new Set<string>(existingNodeId ? [existingNodeId] : []);

    // 1. Exact
    const exactMatches = await this.repo.findNodesByName(userId, node.name);
    for (const match of exactMatches) {
      if (seenIds.has(match.id)) continue;
      seenIds.add(match.id);
      candidates.push({ node: match, match_type: 'exact', similarity: 1.0 });
    }

    // 2. Normalized / fuzzy
    const normalized = this.normalize(node.name);
    const fuzzyMatches = await this.repo.fuzzyFindNodes(userId, normalized);
    for (const match of fuzzyMatches) {
      if (seenIds.has(match.id)) continue;
      const sim = this.normalizedSimilarity(node.name, match.name);
      if (sim >= SUGGEST_MERGE_THRESHOLD) {
        seenIds.add(match.id);
        candidates.push({ node: match, match_type: 'normalized', similarity: sim });
      }
    }

    // 3. Alias
    const aliasMatches = await this.repo.findNodesByAlias(userId, normalized);
    for (const match of aliasMatches) {
      if (seenIds.has(match.id)) continue;
      seenIds.add(match.id);
      candidates.push({ node: match, match_type: 'alias', similarity: 0.9 });
    }

    // 4. Semantic (if embedding provided)
    if ('embedding' in node && node.embedding?.length) {
      const semanticMatches = await this.repo.semanticSearchNodes(userId, node.embedding, 5, 0.92);
      for (const match of semanticMatches) {
        if (seenIds.has(match.id)) continue;
        seenIds.add(match.id);
        candidates.push({
          node:       match,
          match_type: 'semantic',
          similarity: (match as any).similarity ?? 0.92,
        });
      }
    }

    return candidates.sort((a, b) => b.similarity - a.similarity);
  }

  decideMerge(keepId: string, candidates: DuplicateCandidate[]): MergeDecision | null {
    // T9: never auto-approve a merge involving a locked node
    const strong = candidates.filter(c =>
      c.similarity >= AUTO_MERGE_THRESHOLD && !c.node.is_locked,
    );
    if (!strong.length) return null;

    return {
      keep_id:       keepId,
      merge_ids:     strong.map(c => c.node.id),
      auto_approved: true,
      confidence:    strong.reduce((s, c) => s + c.similarity, 0) / strong.length,
    };
  }

  /**
   * Execute a merge.
   * T9 enforcement: if keep_node or any dupe is locked, throw.
   * Locked nodes require explicit human approval outside this method.
   */
  async mergeNodes(userId: string, decision: MergeDecision): Promise<GraphNode> {
    const [keepNode, ...dupeNodes] = await Promise.all([
      this.repo.getNodeById(decision.keep_id, userId),
      ...decision.merge_ids.map(id => this.repo.getNodeById(id, userId)),
    ]);
    if (!keepNode) throw new Error(`Keep node ${decision.keep_id} not found`);

    // T9: Guard — locked nodes cannot be auto-merged
    if (keepNode.is_locked) {
      throw new Error(`Node "${keepNode.name}" is locked and cannot be merged without explicit approval.`);
    }
    for (const dupe of dupeNodes) {
      if (dupe?.is_locked) {
        throw new Error(`Node "${dupe.name}" is locked and cannot be merged without explicit approval.`);
      }
    }

    const allAliases  = new Set<string>(keepNode.aliases);
    let maxImportance = keepNode.importance_score;

    for (const dupe of dupeNodes) {
      if (!dupe) continue;
      dupe.aliases.forEach(a => allAliases.add(a));
      allAliases.add(this.normalize(dupe.name));
      if (dupe.name.toLowerCase() !== keepNode.name.toLowerCase()) {
        allAliases.add(dupe.name);
      }
      maxImportance = Math.max(maxImportance, dupe.importance_score);

      // Re-point edges — collect all upserts, then execute in parallel
      const edges = await this.repo.getEdgesByNode(userId, dupe.id, 'both');
      await Promise.all(edges.map(edge => {
        const newSource = edge.source_node_id === dupe.id ? decision.keep_id : edge.source_node_id;
        const newTarget = edge.target_node_id === dupe.id ? decision.keep_id : edge.target_node_id;
        if (newSource === newTarget) return Promise.resolve();
        return this.repo.upsertEdge({
          user_id:           userId,
          source_node_id:    newSource,
          target_node_id:    newTarget,
          relationship_type: edge.relationship_type,
          strength:          edge.strength,
          confidence:        edge.confidence,
          metadata:          edge.metadata,
          source_memory_ids: edge.source_memory_ids,
          is_pinned:         edge.is_pinned,
        });
      }));

      await this.repo.updateNode(dupe.id, userId, { is_archived: true });
      await this.repo.logEvent(userId, 'NODE_MERGED', dupe.id, 'node', {
        merged_into: decision.keep_id,
      });
    }

    const updated = await this.repo.updateNode(decision.keep_id, userId, {
      aliases:          Array.from(allAliases),
      importance_score: maxImportance,
    });

    await this.repo.logEvent(userId, 'NODE_UPDATED', decision.keep_id, 'node', {
      reason:      'merge',
      merged_from: decision.merge_ids,
    });

    return updated;
  }

  /**
   * Lock a node — prevents auto-merge and auto-rename.
   */
  async lockNode(userId: string, nodeId: string): Promise<void> {
    const node = await this.repo.getNodeById(nodeId, userId);
    if (!node) throw new Error(`Node ${nodeId} not found`);
    await this.repo.updateNode(nodeId, userId, { is_locked: true });
    await this.repo.logEvent(userId, 'NODE_UPDATED', nodeId, 'node', { reason: 'locked' });
  }

  /**
   * Unlock a node — allows merging again.
   */
  async unlockNode(userId: string, nodeId: string): Promise<void> {
    await this.repo.updateNode(nodeId, userId, { is_locked: false });
    await this.repo.logEvent(userId, 'NODE_UPDATED', nodeId, 'node', { reason: 'unlocked' });
  }

  // ---- Helpers ----------------------------------------------

  private normalize(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  }

  private normalizedSimilarity(a: string, b: string): number {
    const na = this.normalize(a);
    const nb = this.normalize(b);
    if (na === nb) return 1.0;
    const setA = new Set(na.split(/\s+/));
    const setB = new Set(nb.split(/\s+/));
    const intersection = new Set([...setA].filter(w => setB.has(w)));
    const union        = new Set([...setA, ...setB]);
    return intersection.size / union.size;
  }
}
