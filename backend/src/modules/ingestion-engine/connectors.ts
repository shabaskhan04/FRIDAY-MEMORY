// ============================================================
// connectors/index.ts — All connector stubs
// ============================================================
import type { ConnectorConfig, IConnector, CreateObservationInput } from '../observation-engine/observation.types';

export abstract class BaseConnector implements IConnector {
  abstract readonly type: string;
  async validate(_config: ConnectorConfig): Promise<boolean> { return true; }
  async ingest(_config: ConnectorConfig, _since?: Date): Promise<CreateObservationInput[]> { return []; }
}

export class GithubConnector extends BaseConnector {
  readonly type = 'GITHUB';
}

export class CalendarConnector extends BaseConnector {
  readonly type = 'GOOGLE_CALENDAR';
}

export class GmailConnector extends BaseConnector {
  readonly type = 'GMAIL';
}

export class GoogleDocsConnector extends BaseConnector {
  readonly type = 'GOOGLE_DOCS';
}

export class MarkdownConnector extends BaseConnector {
  readonly type = 'MARKDOWN';
}

export class LocalFolderConnector extends BaseConnector {
  readonly type = 'LOCAL_FOLDER';
}

export class CsvConnector extends BaseConnector {
  readonly type = 'CSV';
}

export class JsonConnector extends BaseConnector {
  readonly type = 'JSON';
}

export class WhatsappConnector extends BaseConnector {
  readonly type = 'WHATSAPP';
}

export class TelegramConnector extends BaseConnector {
  readonly type = 'TELEGRAM';
}
