import type { FastifyInstance } from "fastify";
import { google } from "googleapis";
import { getOAuth2Client } from "../../lib/google-token";
import {
  stageCalendarEvent,
  stageEmail,
  stageTask,
  type CalendarPayload,
  type EmailPayload,
  type TaskPayload,
} from "../../lib/google-staging";
import { createServiceClient, getFridayUserId } from "../../lib/supabase";
import { getAIRouter } from "../../lib/intelligence";
import type { PendingCommand, ToolName } from "@friday/shared";

const GMAIL_PROMPT = `Extract email fields from the user's natural language input.
Return ONLY valid JSON, no markdown, no explanation.
Use today's context for any relative dates. If a field is not mentioned, omit it.
Schema:
{
  "to": "recipient email address",
  "subject": "email subject line",
  "body": "email body text",
  "cc": "optional cc address"
}`;

const CALENDAR_PROMPT = `Extract calendar event fields from the user's natural language input.
Return ONLY valid JSON, no markdown, no explanation.
Convert any relative times (tomorrow, next Monday, 3pm) to ISO 8601 format.
If endTime is not mentioned, omit it.
Schema:
{
  "title": "event title",
  "startTime": "ISO 8601 datetime string",
  "endTime": "ISO 8601 datetime string (optional)",
  "description": "optional description",
  "location": "optional location"
}`;

async function parseWithAI(
  systemPrompt: string,
  content: string,
  timezone: string,
): Promise<Record<string, string>> {
  const now = new Date().toLocaleString("en-IN", {
    timeZone: timezone,
    dateStyle: "full",
    timeStyle: "short",
  });
  const raw = await getAIRouter().generate(
    "command_parse",
    `${systemPrompt}\n\nCurrent date/time: ${now}\nTimezone: ${timezone}`,
    content,
    { temperature: 0.1, maxTokens: 400 },
  );
  return JSON.parse(raw.replace(/```json|```/g, "").trim()) as Record<string, string>;
}

// ── Google action executors ────────────────────────────────────

async function executeCalendarInsert(payload: CalendarPayload): Promise<void> {
  const auth = await getOAuth2Client();
  const calendar = google.calendar({ version: "v3", auth });

  await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: payload.title,
      location: payload.location ?? undefined,
      description: payload.description ?? undefined,
      start: {
        dateTime: payload.startTime,
      },
      end: {
        dateTime: payload.endTime ?? payload.startTime,
      },
    },
  });
}

async function executeGmailSend(payload: EmailPayload): Promise<void> {
  const auth = await getOAuth2Client();
  const gmail = google.gmail({ version: "v1", auth });

  const messageParts = [
    `To: ${payload.to}`,
    payload.cc ? `Cc: ${payload.cc}` : "",
    `Subject: ${payload.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    payload.body,
  ]
    .filter(Boolean)
    .join("\r\n");

  const encodedMessage = Buffer.from(messageParts).toString("base64url");

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encodedMessage },
  });
}

async function executeTaskInsert(payload: TaskPayload): Promise<void> {
  const auth = await getOAuth2Client();
  const tasks = google.tasks({ version: "v1", auth });

  const taskBody: { title: string; due?: string; notes?: string } = {
    title: payload.title,
  };

  if (payload.dueDate) {
    taskBody.due = new Date(payload.dueDate).toISOString();
  }
  if (payload.notes) {
    taskBody.notes = payload.notes;
  }

  await tasks.tasks.insert({
    tasklist: "@default",
    requestBody: taskBody,
  });
}

// ── Route handlers ─────────────────────────────────────────────

export async function commandsRoutes(app: FastifyInstance): Promise<void> {
  // Stage: calendar
  app.post<{ Body: Partial<CalendarPayload> }>("/commands/stage/calendar", async (request, reply) => {
    const body = request.body;
    if (!body.title || !body.startTime) {
      return reply.code(400).send({ error: "title and startTime are required." });
    }
    if (isNaN(Date.parse(body.startTime))) {
      return reply.code(400).send({ error: "startTime must be a valid ISO 8601 string." });
    }
    const userId = getFridayUserId();
    const { id } = await stageCalendarEvent(userId, {
      title: body.title,
      startTime: body.startTime,
      endTime: body.endTime,
      description: body.description,
      location: body.location,
    });
    return reply.code(201).send({ staged: true, id });
  });

  // Stage: email
  app.post<{ Body: Partial<EmailPayload> }>("/commands/stage/email", async (request, reply) => {
    const body = request.body;
    if (!body.to || !body.subject || !body.body) {
      return reply.code(400).send({ error: "to, subject, and body are required." });
    }
    const userId = getFridayUserId();
    const { id } = await stageEmail(userId, {
      to: body.to,
      subject: body.subject,
      body: body.body,
      cc: body.cc,
    });
    return reply.code(201).send({ staged: true, id });
  });

  // Stage: task
  app.post<{ Body: Partial<TaskPayload> }>("/commands/stage/task", async (request, reply) => {
    const body = request.body;
    if (!body.title) {
      return reply.code(400).send({ error: "title is required." });
    }
    const userId = getFridayUserId();
    const { id } = await stageTask(userId, {
      title: body.title,
      dueDate: body.dueDate,
      notes: body.notes,
    });
    return reply.code(201).send({ staged: true, id });
  });

  // Stage: parse (NL → structured → stage)
  app.post<{ Body: { mode: "gmail" | "calendar" | "task"; content: string; timezone?: string } }>(
    "/commands/stage/parse",
    async (request, reply) => {
      const { mode, content, timezone = "UTC" } = request.body;
      if (!content?.trim()) return reply.code(400).send({ error: "content is required." });
      if (!["gmail", "calendar", "task"].includes(mode))
        return reply.code(400).send({ error: "Invalid mode." });

      const userId = getFridayUserId();

      if (mode === "task") {
        const { id } = await stageTask(userId, { title: content.trim() });
        return reply.code(201).send({ staged: true, id });
      }

      if (mode === "gmail") {
        const fields = await parseWithAI(GMAIL_PROMPT, content, timezone);
        if (!fields.to || !fields.subject || !fields.body) {
          return reply.code(422).send({
            error: "Could not extract to, subject, and body. Try being more specific.",
          });
        }
        const { id } = await stageEmail(userId, {
          to: fields.to,
          subject: fields.subject,
          body: fields.body,
          cc: fields.cc,
        });
        return reply.code(201).send({ staged: true, id });
      }

      if (mode === "calendar") {
        const fields = await parseWithAI(CALENDAR_PROMPT, content, timezone);
        if (!fields.title || !fields.startTime) {
          return reply.code(422).send({
            error: "Could not extract a title and time. Try being more specific.",
          });
        }
        const { id } = await stageCalendarEvent(userId, {
          title: fields.title,
          startTime: fields.startTime,
          endTime: fields.endTime,
          description: fields.description,
          location: fields.location,
        });
        return reply.code(201).send({ staged: true, id });
      }

      return reply.code(400).send({ error: "Unhandled mode." });
    }
  );

  // Execute approved command
  app.post<{ Params: { id: string } }>("/commands/execute/:id", async (request, reply) => {
    const { id } = request.params;
    if (!id) return reply.code(400).send({ error: "Missing command id." });

    const supabase = createServiceClient();
    const userId = getFridayUserId();

    const { data: command, error: fetchError } = await supabase
      .from("pending_commands")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .eq("status", "pending")
      .single();

    if (fetchError || !command) {
      return reply.code(404).send({ error: "Command not found or already actioned." });
    }

    const cmd = command as PendingCommand;
    const { tool_name: toolName, payload } = cmd;

    try {
      if (toolName === "calendar_insert") {
        await executeCalendarInsert(payload as CalendarPayload);
      } else if (toolName === "gmail_send") {
        await executeGmailSend(payload as EmailPayload);
      } else if (toolName === "tasks_insert") {
        await executeTaskInsert(payload as TaskPayload);
      } else {
        return reply.code(400).send({ error: `Unsupported tool: ${String(toolName)}` });
      }

      await supabase
        .from("pending_commands")
        .update({ status: "executed", executed_at: new Date().toISOString() })
        .eq("id", id);

      return reply.send({ executed: true, id });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Execution failed.";
      console.error(`[commands/execute/${id}] error:`, err);

      await supabase
        .from("pending_commands")
        .update({ status: "failed", error_message: message })
        .eq("id", id);

      return reply.code(502).send({ error: message });
    }
  });

  // Deny command
  app.post<{ Params: { id: string } }>("/commands/deny/:id", async (request, reply) => {
    const { id } = request.params;
    if (!id) return reply.code(400).send({ error: "Missing command id." });

    const supabase = createServiceClient();
    const userId = getFridayUserId();

    const { data, error } = await supabase
      .from("pending_commands")
      .update({ status: "denied" })
      .eq("id", id)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select("id, status")
      .single();

    if (error || !data) {
      return reply.code(404).send({ error: "Command not found or already actioned." });
    }

    return reply.send({ denied: true, id });
  });

  // List pending commands
  app.get("/commands/pending", async (_request, reply) => {
    const supabase = createServiceClient();
    const userId = getFridayUserId();

    const { data, error } = await supabase
      .from("pending_commands")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      return reply.code(500).send({ error: "Failed to fetch pending commands." });
    }

    return reply.send({ commands: data ?? [] });
  });
}
