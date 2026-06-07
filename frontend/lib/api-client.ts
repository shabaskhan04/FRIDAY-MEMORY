/**
 * Friday API Client
 *
 * All calls from the Next.js frontend to the DigitalOcean backend
 * go through this module. It reads two env vars:
 *
 *   NEXT_PUBLIC_FRIDAY_API_URL    - e.g. https://api.friday.yourdomain.com
 *   NEXT_PUBLIC_FRIDAY_API_SECRET - shared bearer token
 *
 * Both vars are NEXT_PUBLIC so they're available on the client.
 * The secret is not truly sensitive here because this is a single-user
 * personal app protected by the password gate — treat it like an API key
 * for a private service rather than a per-user credential.
 */

import type {
  IngestRequestBody,
  IngestResponse,
  AskRequestBody,
  AskResponse,
  SearchRequestBody,
  SearchResponse,
  ReflectRequestBody,
  ReflectResponse,
  HealthLog,
  HealthAnalysis,
  HealthLogRequestBody,
  WeeklySummary,
  CalendarPayload,
  EmailPayload,
  TaskPayload,
  StageResponse,
  ExecuteResponse,
  DenyResponse,
  ParseStageRequestBody,
} from "@friday/shared";

export type { WeeklySummary } from "@friday/shared";

const BASE_URL =
  process.env.NEXT_PUBLIC_FRIDAY_API_URL ?? "http://localhost:3001";
const API_SECRET =
  process.env.NEXT_PUBLIC_FRIDAY_API_SECRET ?? "";

// ── Internal fetch wrapper ─────────────────────────────────────

async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${BASE_URL}${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${API_SECRET}`,
    ...(options.headers as Record<string, string>),
  };

  const res = await fetch(url, { ...options, headers });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(
      (body as { error?: string }).error ?? `API error ${res.status}`
    );
  }

  return res.json() as Promise<T>;
}

// ── Ingest ─────────────────────────────────────────────────────

export async function ingestMemory(
  body: IngestRequestBody
): Promise<IngestResponse> {
  return apiFetch<IngestResponse>("/ingest", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Memory / Ask ───────────────────────────────────────────────

export async function askFriday(body: AskRequestBody): Promise<AskResponse> {
  return apiFetch<AskResponse>("/memory/ask", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function searchMemories(
  body: SearchRequestBody
): Promise<SearchResponse> {
  return apiFetch<SearchResponse>("/memory/search", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function triggerReflection(
  body: ReflectRequestBody = {}
): Promise<ReflectResponse> {
  return apiFetch<ReflectResponse>("/memory/reflect", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ── Weekly Summary ─────────────────────────────────────────────

export async function getWeeklySummary(): Promise<WeeklySummary> {
  return apiFetch<WeeklySummary>("/weekly-summary");
}

// ── Health ─────────────────────────────────────────────────────

export async function getHealthLogs(): Promise<{ logs: HealthLog[] }> {
  return apiFetch<{ logs: HealthLog[] }>("/health");
}

export async function logHealth(
  body: HealthLogRequestBody
): Promise<{ log: HealthLog }> {
  return apiFetch<{ log: HealthLog }>("/health", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function analyzeHealth(): Promise<HealthAnalysis> {
  return apiFetch<HealthAnalysis>("/health/analyze");
}

// ── People ─────────────────────────────────────────────────────

export async function getPeople(): Promise<{ people: unknown[] }> {
  return apiFetch<{ people: unknown[] }>("/people");
}

export async function getPersonProfile(name: string): Promise<unknown> {
  return apiFetch<unknown>(`/people/${encodeURIComponent(name)}`);
}

// ── Todos ──────────────────────────────────────────────────────

export async function getTodos(): Promise<{ todos: unknown[] }> {
  return apiFetch<{ todos: unknown[] }>("/todos");
}

export async function patchTodo(id: string, status: "pending" | "done") {
  return apiFetch<{ todo: unknown }>("/todos", {
    method: "PATCH",
    body: JSON.stringify({ id, status }),
  });
}

// ── Commands / Approval workflow ───────────────────────────────

export async function stageCalendar(
  body: CalendarPayload
): Promise<StageResponse> {
  return apiFetch<StageResponse>("/commands/stage/calendar", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function stageEmail(body: EmailPayload): Promise<StageResponse> {
  return apiFetch<StageResponse>("/commands/stage/email", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function stageTask(body: TaskPayload): Promise<StageResponse> {
  return apiFetch<StageResponse>("/commands/stage/task", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function stageParse(
  body: ParseStageRequestBody
): Promise<StageResponse> {
  return apiFetch<StageResponse>("/commands/stage/parse", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getPendingCommands(): Promise<{
  commands: unknown[];
}> {
  return apiFetch<{ commands: unknown[] }>("/commands/pending");
}

export async function executeCommand(id: string): Promise<ExecuteResponse> {
  return apiFetch<ExecuteResponse>(`/commands/execute/${id}`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function denyCommand(id: string): Promise<DenyResponse> {
  return apiFetch<DenyResponse>(`/commands/deny/${id}`, {
    method: "POST",
    body: JSON.stringify({}),
  });
}

export async function executeNLTask(query: string) {
  return apiFetch<{ success: boolean; commandId?: string; tool?: string; message: string }>(
    "/tasks/execute",
    {
      method: "POST",
      body: JSON.stringify({ query }),
    }
  );
}

// ── Google ─────────────────────────────────────────────────────

export async function getGoogleStatus(): Promise<{ connected: boolean }> {
  return apiFetch<{ connected: boolean }>("/google/status");
}

/**
 * Redirect user's browser to the backend Google OAuth flow.
 * Called from a link/button, not fetch.
 */
export function getGoogleConnectUrl(): string {
  return `${BASE_URL}/google/connect`;
}
