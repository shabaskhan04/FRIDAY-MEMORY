import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createServiceClient, getFridayUserId } from "@/lib/supabase-server";
import { getOAuth2Client } from "@/lib/google-token";

// ── Payload types ─────────────────────────────────────────────

interface CalendarPayload {
  title: string;
  startTime: string;
  endTime?: string | null;
  description?: string | null;
  location?: string | null;
}

interface EmailPayload {
  to: string;
  subject: string;
  body: string;
  cc?: string | null;
}

interface TaskPayload {
  title: string;
  dueDate?: string | null;
  notes?: string | null;
}

// ── Helpers ───────────────────────────────────────────────────

/** Encodes a raw email string to base64url as required by the Gmail API. */
function buildRawEmail(payload: EmailPayload): string {
  const lines = [
    `To: ${payload.to}`,
    payload.cc ? `Cc: ${payload.cc}` : null,
    `Subject: ${payload.subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    payload.body,
  ]
    .filter((l) => l !== null)
    .join("\r\n");

  return Buffer.from(lines).toString("base64url");
}

/** Adds one hour to an ISO string if endTime is not provided. */
function deriveEndTime(startTime: string): string {
  const d = new Date(startTime);
  d.setHours(d.getHours() + 1);
  return d.toISOString();
}

// ── Dispatcher ────────────────────────────────────────────────

async function executeCalendar(payload: CalendarPayload): Promise<void> {
  const auth = await getOAuth2Client();
  const calendar = google.calendar({ version: "v3", auth });

  await calendar.events.insert({
    calendarId: "primary",
    requestBody: {
      summary: payload.title,
      description: payload.description ?? undefined,
      location: payload.location ?? undefined,
      start: {
        dateTime: payload.startTime,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Asia/Kolkata",
      },
      end: {
        dateTime: payload.endTime ?? deriveEndTime(payload.startTime),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Asia/Kolkata",
      },
    },
  });
}

async function executeEmail(payload: EmailPayload): Promise<void> {
  const auth = await getOAuth2Client();
  const gmail = google.gmail({ version: "v1", auth });

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: buildRawEmail(payload) },
  });
}

async function executeTask(payload: TaskPayload): Promise<void> {
  const auth = await getOAuth2Client();
  const tasks = google.tasks({ version: "v1", auth });

  await tasks.tasks.insert({
    tasklist: "@default",
    requestBody: {
      title: payload.title,
      notes: payload.notes ?? undefined,
      // Google Tasks API expects RFC 3339 for due date
      due: payload.dueDate ? new Date(payload.dueDate).toISOString() : undefined,
    },
  });
}

// ── Route handler ─────────────────────────────────────────────

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Missing command id." }, { status: 400 });
  }

  const supabase = createServiceClient();
  const userId = getFridayUserId();

  // 1. Fetch the command and verify ownership + status
  const { data: cmd, error: fetchErr } = await supabase
    .from("pending_commands")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .single();

  if (fetchErr || !cmd) {
    return NextResponse.json({ error: "Command not found." }, { status: 404 });
  }

  if (!["pending", "approved"].includes(cmd.status as string)) {
    return NextResponse.json(
      { error: `Cannot execute a command with status '${cmd.status}'.` },
      { status: 409 }
    );
  }

  // 2. Mark as approved (intermediate state) so concurrent requests don't double-execute
  await supabase
    .from("pending_commands")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", id);

  // 3. Dispatch to the correct Google API
  try {
    const toolName = cmd.tool_name as string;
    const payload = cmd.payload as Record<string, unknown>;

    switch (toolName) {
      case "calendar_insert":
        await executeCalendar(payload as unknown as CalendarPayload);
        break;
      case "gmail_send":
        await executeEmail(payload as unknown as EmailPayload);
        break;
      case "tasks_insert":
        await executeTask(payload as unknown as TaskPayload);
        break;
      default:
        throw new Error(`Unknown tool_name: ${toolName}`);
    }

    // 4. Mark as executed
    await supabase
      .from("pending_commands")
      .update({ status: "executed", executed_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({ executed: true, id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown execution error";
    console.error(`[execute/${id}]`, msg);

    // Mark as failed with error detail
    await supabase
      .from("pending_commands")
      .update({ status: "failed", error_message: msg })
      .eq("id", id);

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
