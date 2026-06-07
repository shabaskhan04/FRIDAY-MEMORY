// ============================================================
// connector.registry.ts
// ============================================================
import type { IConnector } from '../observation-engine/observation.types';
import {
  GithubConnector, CalendarConnector, GmailConnector, GoogleDocsConnector,
  MarkdownConnector, LocalFolderConnector, CsvConnector, JsonConnector,
  WhatsappConnector, TelegramConnector,
} from './connectors';

export class ConnectorRegistry {
  private readonly map = new Map<string, IConnector>();

  register(connector: IConnector): void {
    this.map.set(connector.type, connector);
  }

  get(type: string): IConnector | null {
    return this.map.get(type) ?? null;
  }

  list(): string[] {
    return [...this.map.keys()];
  }

  static createDefault(): ConnectorRegistry {
    const r = new ConnectorRegistry();
    [
      new GithubConnector(), new CalendarConnector(), new GmailConnector(),
      new GoogleDocsConnector(), new MarkdownConnector(), new LocalFolderConnector(),
      new CsvConnector(), new JsonConnector(), new WhatsappConnector(), new TelegramConnector(),
    ].forEach(c => r.register(c));
    return r;
  }
}
