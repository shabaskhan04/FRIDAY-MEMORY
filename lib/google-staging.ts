/**
 * google-staging.ts
 *
 * Server-side utility functions called by FRIDAY's AI logic
 * (e.g. from /api/ingest or /api/memory/ask).
 *
 * These functions ONLY insert into pending_commands — they never
 * call Google APIs directly. The user must approve via the frontend
 * modal before anything hits Google.
 */

import { createServiceClient, getFridayUserId } from "@/lib/supabase-server";

// ── Types ─────────────────────────────────────────────────────

export interface CalendarPayload {
  title: string;
  startTime: string;          // ISO 8601
  endTime?: string;           // ISO 8601, defaults to startTime + 1 hour if omitted
  description?: string;
  location?: string;
}

export interface EmailPayload {
  to: string;                 // comma-separated for multiple recipients
  subject: string;
  body: string;               // plain text
  cc?: string;
}

export interface TaskPayload {
  title: string;
  dueDate?: string;           // ISO 8601 date string, e.g. "2025-12-31"
  notes?: string;
}

// ── Internal helper ───────────────────────────────────────────

async function stageCommand(
  toolName: "calendar_insert" | "gmail_send" | "tasks_insert",
  payload: Record<string, unknown>
): Promise<{ id: string }> {
  const supabase = createServiceClient();
  const userId = getFridayUserId();

  const { data, error } = await supabase
    .from("pending_commands")
    .insert({
      user_id: userId,
      tool_name: toolName,
      payload,
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to stage command (${toolName}): ${error?.message ?? "unknown error"}`);
  }

  return { id: data.id as string };
}

// ── Public API ────────────────────────────────────────────────

/**
 * Stages a Google Calendar event for the user's approval.
 *
 * @example
 *   await stageCalendarEvent(userId, {
 *     title: "Team standup",
 *     startTime: "2025-12-10T09:00:00+05:30",
 *     endTime:   "2025-12-10T09:30:00+05:30",
 *   });
 */
export async function stageCalendarEvent(
  _userId: string, // kept for API symmetry; internally uses FRIDAY_USER_ID
  params: CalendarPayload
): Promise<{ id: string }> {
  return stageCommand("calendar_insert", {
    title: params.title,
    startTime: params.startTime,
    endTime: params.endTime ?? null,
    description: params.description ?? null,
    location: params.location ?? null,
  });
}

/**
 * Stages a Gmail message (draft → send on approval).
 *
 * @example
 *   await stageEmail(userId, {
 *     to: "client@example.com",
 *     subject: "Project update",
 *     body: "Hi, here's a quick update on the project...",
 *   });
 */
export async function stageEmail(
  _userId: string,
  params: EmailPayload
): Promise<{ id: string }> {
  return stageCommand("gmail_send", {
    to: params.to,
    subject: params.subject,
    body: params.body,
    cc: params.cc ?? null,
  });
}

/**
 * Stages a Google Tasks item for the user's approval.
 *
 * @example
 *   await stageTask(userId, {
 *     title: "Buy groceries",
 *     dueDate: "2025-12-08",
 *     notes: "Milk, eggs, bread",
 *   });
 */
export async function stageTask(
  _userId: string,
  params: TaskPayload
): Promise<{ id: string }> {
  return stageCommand("tasks_insert", {
    title: params.title,
    dueDate: params.dueDate ?? null,
    notes: params.notes ?? null,
  });
}
