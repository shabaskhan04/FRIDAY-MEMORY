/**
 * POST /api/tasks/execute
 *
 * Unified AI-powered task agent. Receives a natural-language query,
 * calls Groq to classify the intent and extract structured parameters,
 * then stages the action in `pending_commands` for user approval.
 *
 * Returns:
 *   201 { success: true, commandId: string, tool: string, message: string }
 *   422 { error: string }   — LLM could not extract required fields
 *   500 { error: string }   — Groq / staging failure
 */

import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { stageCalendarEvent, stageEmail, stageTask } from "@/lib/action-staging";
import { getFridayUserId } from "@/lib/supabase-server";

export const runtime = "nodejs";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Types ──────────────────────────────────────────────────────

interface TasksExecuteBody {
  query?: string;
}

type ToolName = "calendar_insert" | "gmail_send" | "tasks_insert";

interface LlmCalendarPayload {
  title: string;
  startTime: string;
  endTime?: string;
  description?: string;
  location?: string;
}

interface LlmGmailPayload {
  to: string;
  subject: string;
  body: string;
  cc?: string;
}

interface LlmTaskPayload {
  title: string;
  dueDate?: string;
  notes?: string;
}

type LlmPayload = LlmCalendarPayload | LlmGmailPayload | LlmTaskPayload;

interface LlmResponse {
  tool: ToolName;
  payload: LlmPayload;
}

// ── System prompt ──────────────────────────────────────────────

function buildSystemPrompt(nowIST: string): string {
  return `You are an intent classifier for FRIDAY, a personal AI assistant.

Your job: given the user's natural-language request, output ONLY a valid JSON object — no prose, no markdown fences — that describes the action to perform.

Current date/time (Asia/Kolkata): ${nowIST}
When the user says "tomorrow", "next week", "3pm", etc., resolve to an absolute ISO 8601 datetime. Default timezone: Asia/Kolkata (+05:30).

Output schema — pick exactly one tool:

For scheduling / meetings / reminders on specific dates/times:
{
  "tool": "calendar_insert",
  "payload": {
    "title": "string (required)",
    "startTime": "ISO 8601 string (required)",
    "endTime": "ISO 8601 string (optional, default startTime + 1 hour)",
    "description": "string (optional)",
    "location": "string (optional)"
  }
}

For sending emails / messages to people:
{
  "tool": "gmail_send",
  "payload": {
    "to": "email address (required)",
    "subject": "string (required)",
    "body": "string (required)",
    "cc": "email address (optional)"
  }
}

For adding todos / tasks / reminders without a specific time:
{
  "tool": "tasks_insert",
  "payload": {
    "title": "string (required)",
    "dueDate": "ISO 8601 date string (optional, e.g. 2025-12-31)",
    "notes": "string (optional)"
  }
}

Rules:
- Output ONLY the JSON object. No explanation, no markdown.
- If an email address is not explicitly provided for gmail_send, set "to" to an empty string.
- For tasks without a time, always prefer "tasks_insert" over "calendar_insert".
- For calendar events, always include a startTime even if you have to infer it.`;
}

// ── Helper ─────────────────────────────────────────────────────

function nowInIST(): string {
  return new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "full",
    timeStyle: "short",
  });
}

// ── Route handler ──────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: TasksExecuteBody;
  try {
    body = (await req.json()) as TasksExecuteBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const query = body.query?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ error: "query is required." }, { status: 400 });
  }

  const userId = getFridayUserId();

  // ── 1. Call Groq ─────────────────────────────────────────────
  let llmResult: LlmResponse;
  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      max_tokens: 400,
      temperature: 0.1,
      messages: [
        { role: "system", content: buildSystemPrompt(nowInIST()) },
        { role: "user", content: query },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? "{}";
    // Strip any accidental markdown fences the model might add
    const cleaned = raw.replace(/```json|```/g, "").trim();
    llmResult = JSON.parse(cleaned) as LlmResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "LLM classification failed.";
    console.error("[tasks/execute] groq error:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const { tool, payload } = llmResult;

  if (!tool || !payload) {
    return NextResponse.json(
      { error: "Could not classify intent from your input. Try being more specific." },
      { status: 422 }
    );
  }

  // ── 2. Validate + stage ───────────────────────────────────────
  try {
    if (tool === "calendar_insert") {
      const p = payload as LlmCalendarPayload;
      if (!p.title || !p.startTime) {
        return NextResponse.json(
          { error: "Could not extract event title and start time. Try: 'Schedule team sync tomorrow at 3pm'." },
          { status: 422 }
        );
      }
      const { id } = await stageCalendarEvent(userId, {
        title:       p.title,
        startTime:   p.startTime,
        endTime:     p.endTime,
        description: p.description,
        location:    p.location,
      });
      return NextResponse.json(
        { success: true, commandId: id, tool, message: "Action staged for approval" },
        { status: 201 }
      );
    }

    if (tool === "gmail_send") {
      const p = payload as LlmGmailPayload;
      if (!p.to || !p.subject || !p.body) {
        return NextResponse.json(
          { error: "Could not extract recipient, subject, or body. Try: 'Email raj@example.com about the project update'." },
          { status: 422 }
        );
      }
      const { id } = await stageEmail(userId, {
        to:      p.to,
        subject: p.subject,
        body:    p.body,
        cc:      p.cc,
      });
      return NextResponse.json(
        { success: true, commandId: id, tool, message: "Action staged for approval" },
        { status: 201 }
      );
    }

    if (tool === "tasks_insert") {
      const p = payload as LlmTaskPayload;
      if (!p.title) {
        return NextResponse.json(
          { error: "Could not extract a task title from your input." },
          { status: 422 }
        );
      }
      const { id } = await stageTask(userId, {
        title:   p.title,
        dueDate: p.dueDate,
        notes:   p.notes,
      });
      return NextResponse.json(
        { success: true, commandId: id, tool, message: "Action staged for approval" },
        { status: 201 }
      );
    }

    return NextResponse.json(
      { error: `Unknown tool "${tool as string}" returned by LLM.` },
      { status: 422 }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Staging failed.";
    console.error("[tasks/execute] staging error:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
