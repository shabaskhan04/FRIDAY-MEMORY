// ingestion.schemas.ts
import { z } from 'zod';

export const IngestionSourceTypeSchema = z.enum([
  'GITHUB', 'GOOGLE_CALENDAR', 'GMAIL', 'GOOGLE_DOCS',
  'MARKDOWN', 'LOCAL_FOLDER', 'CSV', 'JSON', 'WHATSAPP', 'TELEGRAM',
]);

export const CreateSourceSchema = z.object({
  source_type: IngestionSourceTypeSchema,
  name: z.string().min(1).max(200),
  config: z.record(z.unknown()).default({}),
  enabled: z.boolean().default(true),
});

export const SyncSchema = z.object({
  source_id: z.string().min(1),
});
