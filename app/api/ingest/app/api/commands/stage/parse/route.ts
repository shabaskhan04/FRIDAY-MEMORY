import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { createClient } from "@/lib/supabase";

export const runtime = "nodejs";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const FRIDAY_USER_ID = process.env.FRIDAY_USER_ID ?? "default-user";

interface ParseRequestBody {
  mode: "gmail" | "calendar" | "task";
  content: string;
}

// ── Groq prompts ───────────────────────────────────────────────

const GMAIL_PROMPT = `Extract email fields from the user's natural language input.
Return ONLY valid JSON, no markdown, no explanation.
Schema: { "to": "email", "subject": "subject line", "body": "body text", "cc": "optional" }`;

const CALENDAR_PROMPT = `Extract calendar event fields from the user's natural language input.
Return ONLY valid JSON, no markdown, no explanation.
Convert relative times (tomorrow, next Monday, 3pm) to ISO 8601. Assume Asia/Kolkata timezone.
Schema: { "title": "event title", "startTime": "ISO 8601", "endTime": "ISO 8601 optional", "description": "optional", "location": "optional" }`;

async function parseWithGroq(systemPrompt: string, content: string): Promise<Record<string, string>> {
  const now = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "full",
    timeStyle: "short",
  });

  const completion = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 400,
    temperature: 0.1,
    messages: [
      { role: "system", content: `${systemPrompt}\n\nCurrent date/time: ${now}` },
      { role: "user", content },
    ],
  });

  const raw = completion.choices[0]?.message?.content ?? "{}";
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned) as Record<string, string>;
}

// ── Stager ────────────────────────────────────────────────────

async function stageCommand(
  toolName: "calendar_insert" | "gmail_send" | "tasks_insert",
  payload: Record<string, unknown>
): Promise<{ id: string }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("pending_commands")
    .insert({ user_id: FRIDAY_USER_ID, tool_name: toolName, payload, status: "pending" })
    .select("id")
    .single();

  if (error || !data) throw new Error(`Failed to stage: ${error?.message ?? "unknown"}`);
  return { id: (data as { id: string }).id };
}

// ── Route ─────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: ParseRequestBody;
  try {
    body = (await req.json()) as ParseRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { mode, content } = body;
  if (!content?.trim()) return NextResponse.json({ error: "content is required." }, { status: 400 });

  try {
    if (mode === "task") {
      const { id } = await stageCommand("tasks_insert", { title: content.trim(), dueDate: null, notes: null });
      return NextResponse.json({ staged: true, id }, { status: 201 });
    }

    if (mode === "gmail") {
      const fields = await parseWithGroq(GMAIL_PROMPT, content);
      if (!fields.to || !fields.subject || !fields.body) {
        return NextResponse.json(
          { error: "Couldn't extract to, subject, and body. Try: 'Email john@acme.com about X, say Y'" },
          { status: 422 }
        );
      }
      const { id } = await stageCommand("gmail_send", {
        to: fields.to, subject: fields.subject, body: fields.body, cc: fields.cc ?? null,
      });
      return NextResponse.json({ staged: true, id }, { status: 201 });
    }

    if (mode === "calendar") {
      const fields = await parseWithGroq(CALENDAR_PROMPT, content);
      if (!fields.title || !fields.startTime) {
        return NextResponse.json(
          { error: "Couldn't extract title and time. Try: 'Team standup tomorrow at 10am for 30 mins'" },
          { status: 422 }
        );
      }
      const { id } = await stageCommand("calendar_insert", {
        title: fields.title, startTime: fields.startTime,
        endTime: fields.endTime ?? null, description: fields.description ?? null,
        location: fields.location ?? null,
      });
      return NextResponse.json({ staged: true, id }, { status: 201 });
    }

    return NextResponse.json({ error: "Invalid mode." }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Parse and stage failed.";
    console.error("[stage/parse]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
