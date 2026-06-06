import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import {
  stageEmail,
  stageCalendarEvent,
  stageTask,
} from "@/lib/google-staging";
import { getFridayUserId } from "@/lib/supabase-server";

export const runtime = "nodejs";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

interface ParseRequestBody {
  mode: "gmail" | "calendar" | "task";
  content: string;
}

// ── Groq extraction prompts ────────────────────────────────────

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
Assume timezone Asia/Kolkata if not specified. If endTime is not mentioned, omit it.
Schema:
{
  "title": "event title",
  "startTime": "ISO 8601 datetime string",
  "endTime": "ISO 8601 datetime string (optional)",
  "description": "optional description",
  "location": "optional location"
}`;

async function parseWithGroq(
  systemPrompt: string,
  content: string
): Promise<Record<string, string>> {
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

  // Strip any accidental markdown fences
  const cleaned = raw.replace(/```json|```/g, "").trim();

  return JSON.parse(cleaned) as Record<string, string>;
}

// ── Route handler ──────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: ParseRequestBody;
  try {
    body = (await req.json()) as ParseRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { mode, content } = body;

  if (!content?.trim()) {
    return NextResponse.json({ error: "content is required." }, { status: 400 });
  }
  if (!["gmail", "calendar", "task"].includes(mode)) {
    return NextResponse.json({ error: "Invalid mode." }, { status: 400 });
  }

  const userId = getFridayUserId();

  try {
    if (mode === "task") {
      // Tasks need only a title — no parsing required
      const { id } = await stageTask(userId, { title: content.trim() });
      return NextResponse.json({ staged: true, id }, { status: 201 });
    }

    if (mode === "gmail") {
      const fields = await parseWithGroq(GMAIL_PROMPT, content);

      if (!fields.to || !fields.subject || !fields.body) {
        return NextResponse.json(
          { error: "Could not extract to, subject, and body from your input. Try being more specific." },
          { status: 422 }
        );
      }

      const { id } = await stageEmail(userId, {
        to:      fields.to,
        subject: fields.subject,
        body:    fields.body,
        cc:      fields.cc,
      });
      return NextResponse.json({ staged: true, id }, { status: 201 });
    }

    if (mode === "calendar") {
      const fields = await parseWithGroq(CALENDAR_PROMPT, content);

      if (!fields.title || !fields.startTime) {
        return NextResponse.json(
          { error: "Could not extract a title and time from your input. Try being more specific." },
          { status: 422 }
        );
      }

      const { id } = await stageCalendarEvent(userId, {
        title:       fields.title,
        startTime:   fields.startTime,
        endTime:     fields.endTime,
        description: fields.description,
        location:    fields.location,
      });
      return NextResponse.json({ staged: true, id }, { status: 201 });
    }

    return NextResponse.json({ error: "Unhandled mode." }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Parse and stage failed.";
    console.error("[stage/parse]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
