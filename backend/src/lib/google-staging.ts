import { createServiceClient, getFridayUserId } from "./supabase";
import type { CalendarPayload, EmailPayload, TaskPayload } from "@friday/shared";

export type { CalendarPayload, EmailPayload, TaskPayload };

async function stageCommand(
  toolName: "calendar_insert" | "gmail_send" | "tasks_insert",
  payload: Record<string, unknown>
): Promise<{ id: string }> {
  const supabase = createServiceClient();
  const userId = getFridayUserId();

  const { data, error } = await supabase
    .from("pending_commands")
    .insert({ user_id: userId, tool_name: toolName, payload, status: "pending" })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(`Failed to stage command (${toolName}): ${error?.message ?? "unknown error"}`);
  }

  return { id: data.id as string };
}

export async function stageCalendarEvent(
  _userId: string,
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
