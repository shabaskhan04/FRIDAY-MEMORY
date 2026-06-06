import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";

export const runtime = "nodejs";

const FRIDAY_USER_ID = process.env.FRIDAY_USER_ID ?? "default-user";

// ── Helpers ───────────────────────────────────────────────────

function buildRawEmail(to: string, subject: string, body: string, cc?: string): string {
  const lines = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ].filter((l) => l !== null).join("\r\n");
  return Buffer.from(lines).toString("base64url");
}

async function getValidAccessToken(supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data, error } = await supabase
    .from("google_tokens")
    .select("access_token, refresh_token, expiry_date")
    .eq("user_id", FRIDAY_USER_ID)
    .single();

  if (error || !data) throw new Error("Google not connected. Connect via Settings → Google Workspace.");

  const row = data as { access_token: string; refresh_token: string; expiry_date: number };

  // Refresh if within 5 minutes of expiry
  if (row.expiry_date - Date.now() < 5 * 60 * 1000) {
    const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID ?? "",
        client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
        refresh_token: row.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    const refreshed = (await refreshRes.json()) as { access_token?: string; expires_in?: number };
    if (refreshed.access_token) {
      const newExpiry = Date.now() + (refreshed.expires_in ?? 3600) * 1000;
      await supabase.from("google_tokens").update({
        access_token: refreshed.access_token,
        expiry_date: newExpiry,
        updated_at: new Date().toISOString(),
      }).eq("user_id", FRIDAY_USER_ID);
      return refreshed.access_token;
    }
  }

  return row.access_token;
}

// ── Google API calls ──────────────────────────────────────────

async function sendGmail(payload: Record<string, string>, token: string): Promise<void> {
  const raw = buildRawEmail(payload.to, payload.subject, payload.body, payload.cc ?? undefined);
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status} ${await res.text()}`);
}

async function insertCalendarEvent(payload: Record<string, string>, token: string): Promise<void> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Asia/Kolkata";
  const endTime = payload.endTime ?? (() => {
    const d = new Date(payload.startTime); d.setHours(d.getHours() + 1); return d.toISOString();
  })();

  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary: payload.title,
      description: payload.description ?? undefined,
      location: payload.location ?? undefined,
      start: { dateTime: payload.startTime, timeZone: tz },
      end:   { dateTime: endTime,           timeZone: tz },
    }),
  });
  if (!res.ok) throw new Error(`Calendar API error: ${res.status} ${await res.text()}`);
}

async function insertTask(payload: Record<string, string>, token: string): Promise<void> {
  const res = await fetch("https://tasks.googleapis.com/tasks/v1/lists/@default/tasks", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      title: payload.title,
      notes: payload.notes ?? undefined,
      due: payload.dueDate ? new Date(payload.dueDate).toISOString() : undefined,
    }),
  });
  if (!res.ok) throw new Error(`Tasks API error: ${res.status} ${await res.text()}`);
}

// ── Route ─────────────────────────────────────────────────────

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing command id." }, { status: 400 });

  const supabase = createClient();

  const { data: cmd, error: fetchErr } = await supabase
    .from("pending_commands")
    .select("*")
    .eq("id", id)
    .eq("user_id", FRIDAY_USER_ID)
    .single();

  if (fetchErr || !cmd) return NextResponse.json({ error: "Command not found." }, { status: 404 });
  if (!["pending", "approved"].includes((cmd as { status: string }).status)) {
    return NextResponse.json({ error: `Cannot execute with status '${(cmd as { status: string }).status}'.` }, { status: 409 });
  }

  await supabase.from("pending_commands")
    .update({ status: "approved", approved_at: new Date().toISOString() })
    .eq("id", id);

  try {
    const token = await getValidAccessToken(supabase);
    const toolName = (cmd as { tool_name: string }).tool_name;
    const payload = (cmd as { payload: Record<string, string> }).payload;

    switch (toolName) {
      case "gmail_send":      await sendGmail(payload, token); break;
      case "calendar_insert": await insertCalendarEvent(payload, token); break;
      case "tasks_insert":    await insertTask(payload, token); break;
      default: throw new Error(`Unknown tool: ${toolName}`);
    }

    await supabase.from("pending_commands")
      .update({ status: "executed", executed_at: new Date().toISOString() })
      .eq("id", id);

    return NextResponse.json({ executed: true, id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Execution failed.";
    await supabase.from("pending_commands")
      .update({ status: "failed", error_message: msg })
      .eq("id", id);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
