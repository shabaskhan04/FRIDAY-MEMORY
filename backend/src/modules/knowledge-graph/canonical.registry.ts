// ============================================================
// canonical.registry.ts — P1: Canonical entity management
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CanonicalEntity, CreateCanonicalEntityInput, GraphNode,
} from './graph.types';
import type { GraphRepository } from './graph.repository';

export class CanonicalRegistry {
  constructor(
    private readonly db:   SupabaseClient,
    private readonly repo: GraphRepository,
  ) {}

  // ---- CRUD ------------------------------------------------

  async createCanonicalEntity(input: CreateCanonicalEntityInput): Promise<CanonicalEntity> {
    const { data, error } = await this.db
      .from('graph_canonical_entities')
      .insert(input)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async getCanonicalEntity(userId: string, canonicalId: string): Promise<CanonicalEntity | null> {
    const { data, error } = await this.db
      .from('graph_canonical_entities')
      .select()
      .eq('user_id', userId)
      .eq('canonical_id', canonicalId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async findByCanonicalId(userId: string, canonicalId: string): Promise<GraphNode[]> {
    const { data, error } = await this.db
      .rpc('get_nodes_by_canonical', { p_user_id: userId, p_canonical_id: canonicalId });
    if (error) throw error;
    return data ?? [];
  }

  async listCanonicalEntities(userId: string, entityType?: string): Promise<CanonicalEntity[]> {
    let query = this.db
      .from('graph_canonical_entities')
      .select()
      .eq('user_id', userId)
      .order('display_name');
    if (entityType) query = query.eq('entity_type', entityType);
    const { data, error } = await query;
    if (error) throw error;
    return data ?? [];
  }

  /**
   * Update display_name or aliases on a canonical entity.
   * canonical_id is immutable and cannot be changed here.
   */
  async updateCanonicalEntity(
    userId: string,
    canonicalId: string,
    patch: { display_name?: string; description?: string; aliases?: string[] },
  ): Promise<CanonicalEntity> {
    const { data, error } = await this.db
      .from('graph_canonical_entities')
      .update(patch)
      .eq('user_id', userId)
      .eq('canonical_id', canonicalId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  // ---- Assignment ------------------------------------------

  /**
   * Assign a canonical_id to a graph node.
   * Creates the canonical entity if it doesn't exist.
   * Locked nodes can hold canonical IDs — locking doesn't block this.
   */
  async assignCanonicalId(
    userId: string,
    nodeId: string,
    canonicalId: string,
    createIfMissing?: Omit<CreateCanonicalEntityInput, 'user_id' | 'canonical_id'>,
  ): Promise<GraphNode> {
    // Ensure canonical entity exists
    let canonical = await this.getCanonicalEntity(userId, canonicalId);
    if (!canonical) {
      if (!createIfMissing) throw new Error(`Canonical entity '${canonicalId}' not found. Pass createIfMissing to auto-create.`);
      canonical = await this.createCanonicalEntity({ user_id: userId, canonical_id: canonicalId, ...createIfMissing });
    }

    const updated = await this.repo.updateNode(nodeId, userId, { canonical_id: canonicalId } as any);
    await this.repo.logEvent(userId, 'CANONICAL_ASSIGNED', nodeId, 'node', { canonical_id: canonicalId });
    return updated;
  }

  /**
   * Resolve a natural name or alias to its canonical entity.
   * Searches canonical entity aliases first, then falls back to node name search.
   */
  async resolveCanonicalEntity(userId: string, name: string): Promise<CanonicalEntity | null> {
    // 1. Try exact display_name match
    const { data: exact } = await this.db
      .from('graph_canonical_entities')
      .select()
      .eq('user_id', userId)
      .ilike('display_name', name)
      .maybeSingle();
    if (exact) return exact;

    // 2. Try alias match
    const { data: byAlias } = await this.db
      .from('graph_canonical_entities')
      .select()
      .eq('user_id', userId)
      .contains('aliases', [name.toLowerCase()]);
    if (byAlias?.length) return byAlias[0];

    // 3. Try canonical_id contains name (case-insensitive slug match)
    const slug = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const { data: bySlug } = await this.db
      .from('graph_canonical_entities')
      .select()
      .eq('user_id', userId)
      .ilike('canonical_id', `%${slug}%`)
      .maybeSingle();
    return bySlug ?? null;
  }

  /**
   * Get all graph nodes that share the same canonical identity
   * (i.e. variants like "Orin", "Orin Platform", "Orin AI").
   */
  async getCanonicalVariants(userId: string, canonicalId: string): Promise<GraphNode[]> {
    return this.findByCanonicalId(userId, canonicalId);
  }
}
