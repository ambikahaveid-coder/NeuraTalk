export type TranslationLogLevel = 'info' | 'warn' | 'error';

export interface TranslationLogEntry {
  timestamp: number;
  level: TranslationLogLevel;
  event: string;
  callId?: string;
  languagePair?: string;
  latencyMs?: number;
  confidence?: number;
  provider?: string;
  reason?: string;
  metadata?: Record<string, unknown>;
}

const MAX_ENTRIES = 250;

class TranslationLogger {
  private entries: TranslationLogEntry[] = [];

  private push(entry: TranslationLogEntry): void {
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }

    const payload = `[translation:${entry.level}] ${entry.event} call=${entry.callId || 'unknown'} pair=${entry.languagePair || 'n/a'} latency=${entry.latencyMs ?? 'n/a'} confidence=${entry.confidence ?? 'n/a'} provider=${entry.provider || 'n/a'} reason=${entry.reason || 'n/a'}`;
    if (entry.level === 'error') {
      console.error(payload, entry.metadata || {});
    } else if (entry.level === 'warn') {
      console.warn(payload, entry.metadata || {});
    } else {
      console.info(payload, entry.metadata || {});
    }
  }

  info(event: string, partial: Omit<TranslationLogEntry, 'timestamp' | 'level' | 'event'> = {}): void {
    this.push({ timestamp: Date.now(), level: 'info', event, ...partial });
  }

  warn(event: string, partial: Omit<TranslationLogEntry, 'timestamp' | 'level' | 'event'> = {}): void {
    this.push({ timestamp: Date.now(), level: 'warn', event, ...partial });
  }

  error(event: string, partial: Omit<TranslationLogEntry, 'timestamp' | 'level' | 'event'> = {}): void {
    this.push({ timestamp: Date.now(), level: 'error', event, ...partial });
  }

  recent(): TranslationLogEntry[] {
    return [...this.entries];
  }
}

export const translationLogger = new TranslationLogger();
