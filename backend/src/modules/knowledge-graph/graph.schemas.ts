// ============================================================
// graph.schemas.ts — Zod validation schemas
// ============================================================

import { z } from 'zod';

// ---- Enums ----

export const NodeTypeSchema = z.enum([
  'PERSON', 'PROJECT', 'BUSINESS', 'GOAL', 'TASK',
  'EVENT', 'LOCATION', 'MEMORY', 'HEALTH_METRIC',
  'CONCEPT', 'DOCUMENT', 'CUSTOM',
]);

export const RelationshipTypeSchema = z.enum([
  'OWNS', 'WORKS_ON', 'CONNECTED_TO', 'MENTIONED_WITH',
  'FRIEND_OF', 'CLIENT_OF', 'RELATED_TO', 'PART_OF',
  'LOCATED_IN', 'DEPENDS_ON', 'CAUSED_BY', 'GOAL_OF',
  'TRACKS', 'ATTENDED', 'INTERESTED_IN', 'SPOKE_WITH',
  'REQUESTED', 'MANAGES', 'CREATED', 'EMPLOYED_BY',
  'ALIGNS_WITH', 'CONTRIBUTES_TO', 'DISTRACTS_FROM',
  // Social / professional roles
  'BUSINESS_PARTNER', 'COFOUNDER', 'WORKS_WITH',
  'MANAGER_OF', 'REPORTS_TO', 'FAMILY_MEMBER',
]);

// ---- Nodes ----

export const CreateNodeSchema = z.object({
  user_id:          z.string().uuid(),
  node_type:        NodeTypeSchema,
  name:             z.string().min(1).max(255),
  description:      z.string().max(2000).optional(),
  aliases:          z.array(z.string()).default([]),
  metadata:         z.record(z.unknown()).default({}),
  importance_score: z.number().min(0).max(1).default(0.5),
  confidence_score: z.number().min(0).max(1).default(1.0),
  source_memory_ids: z.array(z.string().uuid()).default([]),
});

export const UpdateNodeSchema = z.object({
  name:             z.string().min(1).max(255).optional(),
  description:      z.string().max(2000).optional(),
  aliases:          z.array(z.string()).optional(),
  metadata:         z.record(z.unknown()).optional(),
  importance_score: z.number().min(0).max(1).optional(),
  confidence_score: z.number().min(0).max(1).optional(),
  is_archived:      z.boolean().optional(),
});

// ---- Edges ----

export const CreateEdgeSchema = z.object({
  user_id:           z.string().uuid(),
  source_node_id:    z.string().uuid(),
  target_node_id:    z.string().uuid(),
  relationship_type: RelationshipTypeSchema,
  strength:          z.number().min(0).max(1).default(0.5),
  confidence:        z.number().min(0).max(1).default(1.0),
  metadata:          z.record(z.unknown()).default({}),
  source_memory_ids: z.array(z.string().uuid()).default([]),
}).refine(d => d.source_node_id !== d.target_node_id, {
  message: 'Self-loops not allowed',
});

// ---- Search ----

export const SearchGraphSchema = z.object({
  query:          z.string().min(1).max(500),
  user_id:        z.string().uuid(),
  node_types:     z.array(NodeTypeSchema).optional(),
  limit:          z.number().int().min(1).max(100).default(20),
  min_importance: z.number().min(0).max(1).default(0),
});

// ---- Extraction ----

export const ExtractedNodeSchema = z.object({
  name:        z.string().min(1),
  node_type:   NodeTypeSchema,
  description: z.string().nullable().optional(),
  aliases:     z.array(z.string()).default([]),
  confidence:  z.number().min(0).max(1),
  metadata:    z.record(z.unknown()).default({}),
});

export const ExtractedEdgeSchema = z.object({
  source:            z.string().min(1),
  target:            z.string().min(1),
  relationship_type: RelationshipTypeSchema,
  confidence:        z.number().min(0).max(1),
  metadata:          z.record(z.unknown()).default({}),
});

export const ExtractionResultSchema = z.object({
  nodes: z.array(ExtractedNodeSchema),
  edges: z.array(ExtractedEdgeSchema),
  raw_llm_response: z.string(),
});
