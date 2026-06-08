import type { FastifyInstance } from "fastify";
import { generateEmbedding } from "../lib/embeddings";
import { createServiceClient, getFridayUserId } from "../lib/supabase";
import { getGraphService, getAIRouter } from "../lib/intelligence";
import type {
  IngestRequestBody,
  IngestResponse,
  GroqRouterPayload,
  TemporalEvent,
  EntityUpdate,
  IntentTag,
  DeviceType,
} from "@friday/shared";

const SYSTEM_PROMPT = `You are a cognitive routing engine. Take the user's unstructured transcript and extract it into a strict JSON schema. The user will mix past, present, and future events, mention people, and describe goals or actions.

Determine the intent_tag based on:
- "spark": excited, inspired, creative, breakthrough, new idea, energized, happy
- "friction": stressed, frustrated, worried, conflict, problem, issue, negative emotion
- "standard": neutral, factual, informational, routine

CRITICAL NAME RULES — follow these exactly:
1. Extract the person's REAL NAME ONLY. Strip all role descriptors from the name field.
   - "Shanavas Khan (father)" → name = "Shanavas Khan"
2. Use the FULL name whenever available. If only a role word appears with no real name, use that role.
3. The relationship belongs in interaction_type and ledger_note — NEVER in the name field.
4. If the same person is mentioned multiple times, emit only ONE entity_update.
5. interaction_type must be exactly: "family" | "friend" | "business" | "conflict"

Output EXACTLY this JSON format — no extra keys, no markdown:
{
  "intent_tag": "standard" | "spark" | "friction",
  "temporal_events": [
    {
      "time_horizon": "past" | "present" | "future",
      "estimated_date": "YYYY-MM-DD or contextual guess",
      "era": "Infer the life chapter or project phase",
      "event_summary": "Structured summary of the event"
    }
  ],
  "entity_updates": [
    {
      "name": "Clean real name only — NO role suffixes like (father) or (sister)",
      "interaction_type": "family" | "friend" | "business" | "conflict",
      "trust_signal": "positive" | "negative" | "neutral",
      "ledger_note": "What was learned — include relationship context here"
    }
  ],
  "extracted_tasks": [
    "A clean, direct, actionable to-do step."
  ]
}`;

function canonicalizeName(raw: string): string {
  return raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: IngestRequestBody }>("/ingest", async (request, reply) => {
    const body = request.body;
    const content = body.content?.trim() ?? "";

    if (!content) {
      return reply.code(400).send({ error: "content is required and must not be empty." });
    }

    const deviceType: DeviceType | null =
      body.device_type && ["mobile", "desktop"].includes(body.device_type)
        ? body.device_type
        : null;

    const localTimezone = body.local_timezone?.trim() ?? null;
    const locationText = body.location_text?.trim() ?? null;
    const locationLat = typeof body.location_lat === "number" ? body.location_lat : null;
    const locationLon = typeof body.location_lon === "number" ? body.location_lon : null;

    const supabase = createServiceClient();

    // Run Groq extraction and embedding concurrently via AIRouter gateway
    let groqRawJson: string;
    let embeddingVector: number[] | null;

    try {
      const [groqResult, embeddingResult] = await Promise.all([
        getAIRouter().generate(
          "memory_extraction",
          SYSTEM_PROMPT,
          content,
          { temperature: 0.2, maxTokens: 2048 }
        ),
        getAIRouter().embed(content),
      ]);

      groqRawJson = groqResult ?? "{}";
      embeddingVector = embeddingResult[0] ?? null;
    } catch (groqError) {
      const message = groqError instanceof Error ? groqError.message : "AIRouter Gateway error.";
      console.error("[ingest] AIRouter Gateway call failed:", groqError);
      return reply.code(502).send({ error: message });
    }

    let parsed: GroqRouterPayload;
    try {
      parsed = JSON.parse(groqRawJson) as GroqRouterPayload;
    } catch {
      console.error("[ingest] JSON parse failed. Raw output:", groqRawJson);
      return reply.code(500).send({ error: "Groq returned malformed JSON." });
    }

    const intentTag: IntentTag =
      parsed.intent_tag && ["standard", "spark", "friction"].includes(parsed.intent_tag)
        ? parsed.intent_tag
        : "standard";

    const temporalEvents: TemporalEvent[] = Array.isArray(parsed.temporal_events)
      ? parsed.temporal_events
      : [];

    const rawEntityUpdates: EntityUpdate[] = Array.isArray(parsed.entity_updates)
      ? parsed.entity_updates
      : [];

    const seenNames = new Set<string>();
    const entityUpdates: EntityUpdate[] = [];
    for (const entity of rawEntityUpdates) {
      const cleanName = canonicalizeName(entity.name ?? "");
      if (!cleanName) continue;
      const dedupeKey = cleanName.toLowerCase();
      if (seenNames.has(dedupeKey)) continue;
      seenNames.add(dedupeKey);
      entityUpdates.push({ ...entity, name: cleanName });
    }

    const extractedTasks: string[] = Array.isArray(parsed.extracted_tasks)
      ? parsed.extracted_tasks.filter(
          (t): t is string => typeof t === "string" && t.trim().length > 0
        )
      : [];

    // Write to raw_ledgers
    const ledgerInsert: Record<string, unknown> = {
      content,
      intent_tag: intentTag,
      device_type: deviceType,
      local_timezone: localTimezone,
    };
    if (locationText) ledgerInsert.location_text = locationText;
    if (locationLat !== null) ledgerInsert.location_lat = locationLat;
    if (locationLon !== null) ledgerInsert.location_lon = locationLon;

    const { data: ledgerData, error: ledgerError } = await supabase
      .from("raw_ledgers")
      .insert(ledgerInsert)
      .select("id")
      .single();

    if (ledgerError || !ledgerData) {
      console.error("[ingest] raw_ledgers insert failed:", ledgerError);
      return reply.code(500).send({ error: "Failed to commit to raw ledger." });
    }

    const rawLedgerId = ledgerData.id as string;

    // Concurrent writes: temporal + entity + tasks + embedding
    const embeddingWritePromise =
      embeddingVector !== null
        ? supabase
            .from("ledger_embeddings")
            .insert({
              raw_ledger_id: rawLedgerId,
              embedding: JSON.stringify(embeddingVector),
            })
            .then((res) => ({ error: res.error }))
        : Promise.resolve({ error: null });

    const temporalWritePromise =
      temporalEvents.length > 0
        ? supabase
            .from("temporal_memories")
            .insert(
              temporalEvents.map((e) => ({
                raw_ledger_id: rawLedgerId,
                time_horizon: e.time_horizon,
                estimated_date: e.estimated_date ?? null,
                era: e.era ?? null,
                event_summary: e.event_summary ?? null,
              }))
            )
            .then((res) => ({ error: res.error }))
        : Promise.resolve({ error: null });

    const entityWritePromise =
      entityUpdates.length > 0
        ? supabase
            .from("entity_ledger")
            .insert(
              entityUpdates.map((e) => ({
                raw_ledger_id: rawLedgerId,
                name: e.name,
                interaction_type: e.interaction_type ?? null,
                trust_signal: e.trust_signal,
                ledger_note: e.ledger_note ?? null,
              }))
            )
            .then((res) => ({ error: res.error }))
        : Promise.resolve({ error: null });

    const taskWritePromise =
      extractedTasks.length > 0
        ? supabase
            .from("todo_tasks")
            .insert(
              extractedTasks.map((task) => ({
                raw_ledger_id: rawLedgerId,
                task_description: task.trim(),
                status: "pending",
              }))
            )
            .then((res) => ({ error: res.error }))
        : Promise.resolve({ error: null });

    const [temporalResult, entityResult, taskResult, embeddingResult] = await Promise.all([
      temporalWritePromise,
      entityWritePromise,
      taskWritePromise,
      embeddingWritePromise,
    ]);

    if (temporalResult.error)
      console.error("[ingest] temporal_memories write error:", temporalResult.error);
    if (entityResult.error)
      console.error("[ingest] entity_ledger write error:", entityResult.error);
    if (taskResult.error)
      console.error("[ingest] todo_tasks write error:", taskResult.error);
    if (embeddingResult.error)
      console.error("[ingest] ledger_embeddings write error:", embeddingResult.error);

    // Graph ingestion — awaited so failures are visible in the response
    let graph_ingested = false;
    let graphResult: { nodes: any[]; edges: any[]; extraction: any } | null = null;
    try {
      graphResult = await getGraphService().ingestMemory(getFridayUserId(), content, rawLedgerId);
      graph_ingested = true;
    } catch (err) {
      console.error("[ingest] graph ingest error:", err);
      // Log to graph_ingestion_failures for later replay
      supabase.from("graph_ingestion_failures").insert({
        raw_ledger_id: rawLedgerId,
        error_message: err instanceof Error ? err.message : String(err),
        content_snippet: content.slice(0, 200),
      }).then(({ error: dbErr }) => {
        if (dbErr) console.error("[ingest] failed to log graph failure:", dbErr);
      });
    }

    // Dynamic import to avoid circular dependency
    const { getObservationService } = await import("../lib/intelligence");

    // Resolve entity names to Graph Node UUIDs to feed the Causal Engine
    const relatedEntities = entityUpdates.map(e => e.name);
    let sourceNodeId: string | null = null;
    let targetNodeId: string | null = null;

    try {
      const nodes = graphResult?.nodes || [];
      if (nodes.length > 0) {
        sourceNodeId = nodes[0].id;
        if (nodes.length > 1) {
          targetNodeId = nodes[1].id;
        } else {
          // If the memory mentions only one entity, set target_node_id to the user's own "Self" node ("You")
          const userId = getFridayUserId();
          const { data: existingSelf } = await supabase
            .from("graph_nodes")
            .select("id")
            .eq("user_id", userId)
            .eq("name", "You")
            .eq("node_type", "PERSON")
            .eq("is_archived", false)
            .maybeSingle();

          if (existingSelf) {
            targetNodeId = existingSelf.id;
          } else {
            const { data: createdSelf } = await supabase
              .from("graph_nodes")
              .insert({
                user_id: userId,
                name: "You",
                node_type: "PERSON",
                aliases: ["Me", "Self"],
                metadata: {},
              })
              .select("id")
              .single();

            if (createdSelf) {
              targetNodeId = createdSelf.id;
            }
          }
        }
      }
    } catch (e) {
      console.error("[ingest] Graph node lookup failed:", e);
    }

    // Activity pipeline — fire-and-forget (non-blocking, non-critical)
    getObservationService()
      .observe({
        user_id: getFridayUserId(),
        source: 'MANUAL',
        event_type: intentTag,
        title: content.slice(0, 120),
        description: content,
        occurred_at: new Date().toISOString(),
        importance_score: 0.5,
        confidence_score: 0.8,
        categories: [],
        metadata: { 
          raw_ledger_id: rawLedgerId,
          source_node_id: sourceNodeId,
          target_node_id: targetNodeId
        },
        related_entities: relatedEntities,
      })
      .catch(err => console.error("[ingest] observation pipeline error:", err));

    const response: IngestResponse = {
      success: true,
      raw_ledger_id: rawLedgerId,
      intent_tag: intentTag,
      temporal_count: temporalEvents.length,
      entity_count: entityUpdates.length,
      task_count: extractedTasks.length,
      embedding_stored: embeddingVector !== null && !embeddingResult.error,
      graph_ingested,
    };

    return reply.code(200).send(response);
  });
}
