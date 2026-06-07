// ============================================================
// observation.schemas.ts
// ============================================================
import { z } from 'zod';

export const ObservationSourceSchema = z.enum([
  'MANUAL',
  'GIT_COMMIT', 'GIT_PR', 'GIT_BRANCH',
  'EMAIL_SENT', 'EMAIL_RECEIVED',
  'CALENDAR_EVENT',
  'TASK_CREATED', 'TASK_COMPLETED',
  'FILE_CREATED', 'FILE_MODIFIED', 'FILE_DELETED',
  'HEALTH_UPDATE',
  'APP_USAGE', 'WEBSITE_VISIT', 'DEVICE_ACTIVITY',
  'DOCUMENT_CREATED', 'DOCUMENT_UPDATED',
  'RESEARCH_SESSION', 'YOUTUBE_WATCH', 'BOOK_READING', 'COURSE_PROGRESS',
  'FINANCIAL_TRANSACTION', 'REVENUE_EVENT', 'EXPENSE_EVENT',
  'PROJECT_MILESTONE',
  'SOCIAL_INTERACTION', 'PHONE_CALL', 'MESSAGE_SENT', 'MESSAGE_RECEIVED',
  'CUSTOM',
]);

export const ObservationCategorySchema = z.enum([
  'WORK', 'HEALTH', 'LEARNING', 'SOCIAL',
  'FINANCE', 'PROJECT', 'PERSONAL', 'SYSTEM',
]);

export const CreateObservationSchema = z.object({
  user_id:          z.string().min(1),
  source:           ObservationSourceSchema,
  event_type:       z.string().min(1).max(100),
  title:            z.string().min(1).max(500),
  description:      z.string().max(5000).optional(),
  occurred_at:      z.string().datetime().optional(),
  importance_score: z.number().min(0).max(1).default(0.5),
  confidence_score: z.number().min(0).max(1).default(1.0),
  categories:       z.array(ObservationCategorySchema).default([]),
  metadata:         z.record(z.unknown()).default({}),
  related_entities: z.array(z.string()).default([]),
});
