// ============================================================
// Google Workspace action / command types
// ============================================================

export type CommandStatus = "pending" | "approved" | "executed" | "denied" | "failed";
export type ToolName = "calendar_insert" | "gmail_send" | "tasks_insert";

export interface CalendarPayload {
  title: string;
  startTime: string; // ISO 8601
  endTime?: string;
  description?: string;
  location?: string;
}

export interface EmailPayload {
  to: string;
  subject: string;
  body: string;
  cc?: string;
}

export interface TaskPayload {
  title: string;
  dueDate?: string;
  notes?: string;
}

export type ActionPayload = CalendarPayload | EmailPayload | TaskPayload;

export interface PendingCommand {
  id: string;
  user_id: string;
  tool_name: ToolName;
  payload: ActionPayload;
  status: CommandStatus;
  created_at: string;
  approved_at?: string;
  executed_at?: string;
  error_message?: string;
}

export interface StageResponse {
  staged: boolean;
  id: string;
}

export interface ExecuteResponse {
  executed: boolean;
  id: string;
}

export interface DenyResponse {
  denied: boolean;
  id: string;
}

export interface ParseStageRequestBody {
  mode: "gmail" | "calendar" | "task";
  content: string;
}

export interface WeeklySummary {
  mood_summary: string;
  what_to_do: string[];
  what_to_avoid: string[];
  what_to_improve: string[];
  key_people: string[];
  pending_focus: string[];
  week_start: string;
  week_end: string;
  entry_count: number;
  people_count?: number;
  pending_todos?: number;
}
