import type { FastifyInstance } from "fastify";
import {
  stageCalendarEvent,
  stageEmail,
  stageTask,
} from "../lib/google-staging";
import { getFridayUserId } from "../lib/supabase";
import { getAIRouter } from "../lib/intelligence";

interface TaskExecuteBody {
  query: string;
  timezone?: string;
}

const TASK_SYSTEM_PROMPT = `You are Friday's action router. The user wants to DO something — classify their intent and extract payload.

Return ONLY valid JSON — no markdown, no extra keys:
{
  "tool": "calendar_insert" | "gmail_send" | "tasks_insert" | "unknown",
  "confidence": 0.0–1.0,
  "payload": {
    // For calendar_insert:
    "title": "...", "startTime": "ISO 8601", "endTime": "ISO 8601 (optional)",
    "description": "optional", "location": "optional"
    // For gmail_send:
    "to": "email@example.com", "subject": "...", "body": "...", "cc": "optional"
    // For tasks_insert:
    "title": "...", "dueDate": "YYYY-MM-DD (optional)", "notes": "optional"
  },
  "message": "One sentence confirming what you understood."
}

Current date/time: {{NOW}}
Timezone: {{TZ}}`;

export async function tasksRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: TaskExecuteBody }>("/tasks/execute", async (request, reply) => {
    const query    = request.body.query?.trim() ?? "";
    const timezone = request.body.timezone?.trim() || "UTC";
    if (!query) {
      return reply.code(400).send({ error: "query is required." });
    }

    const userId = getFridayUserId();

    const now = new Date().toLocaleString("en-US", {
      timeZone: timezone,
      dateStyle: "full",
      timeStyle: "short",
    });

    const systemPrompt = TASK_SYSTEM_PROMPT
      .replace("{{NOW}}", now)
      .replace("{{TZ}}", timezone);

    let parsed: {
      tool: string;
      confidence: number;
      payload: Record<string, string>;
      message: string;
    };

    try {
      const raw = await getAIRouter().generate(
        "command_parse",
        systemPrompt,
        query,
        { temperature: 0.1, maxTokens: 512 },
      );
      parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()) as typeof parsed;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Task classification failed.";
      console.error("[tasks/execute] AIRouter error:", err);
      return reply.code(502).send({ error: message });
    }

    const { tool, payload, message } = parsed;

    if (!tool || tool === "unknown" || !payload) {
      return reply.send({
        success: false,
        message: message ?? "I couldn't figure out what action to take. Try being more specific.",
      });
    }

    try {
      let id: string;

      if (tool === "calendar_insert") {
        if (!payload.title || !payload.startTime) {
          return reply.code(422).send({ error: "Could not extract title and startTime." });
        }
        const result = await stageCalendarEvent(userId, {
          title: payload.title,
          startTime: payload.startTime,
          endTime: payload.endTime,
          description: payload.description,
          location: payload.location,
        });
        id = result.id;
      } else if (tool === "gmail_send") {
        if (!payload.to || !payload.subject || !payload.body) {
          return reply.code(422).send({ error: "Could not extract to, subject, and body." });
        }
        const result = await stageEmail(userId, {
          to: payload.to,
          subject: payload.subject,
          body: payload.body,
          cc: payload.cc,
        });
        id = result.id;
      } else if (tool === "tasks_insert") {
        if (!payload.title) {
          return reply.code(422).send({ error: "Could not extract task title." });
        }
        const result = await stageTask(userId, {
          title: payload.title,
          dueDate: payload.dueDate,
          notes: payload.notes,
        });
        id = result.id;
      } else {
        return reply.send({ success: false, message: `Unsupported tool: ${tool}` });
      }

      return reply.code(201).send({ success: true, commandId: id, tool, message });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to stage action.";
      console.error("[tasks/execute] staging error:", err);
      return reply.code(500).send({ error: msg });
    }
  });
}
