/**
 * lib/action-staging.ts
 *
 * Public facade for staging Google Workspace actions into `pending_commands`.
 * Re-exports from lib/google-staging.ts so callers depend on this stable name
 * rather than the internal implementation file.
 *
 * Usage (server-side only):
 *   import { stageCalendarEvent, stageEmail, stageTask } from "@/lib/action-staging";
 */

export type {
  CalendarPayload,
  EmailPayload,
  TaskPayload,
} from "@/lib/google-staging";

export {
  stageCalendarEvent,
  stageEmail,
  stageTask,
} from "@/lib/google-staging";
