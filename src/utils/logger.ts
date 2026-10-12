import pino from 'pino';
import { env } from '../config/env.js';
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: ['url', 'token', 'headers', 'cookie', 'authorization', 'req.headers'],
});
export class ErrorJournal {
  private readonly entries: {
    providerId: string;
    code: string;
    time: string;
  }[] = [];
  record(providerId: string, code = 'PROVIDER_UNAVAILABLE') {
    this.entries.unshift({ providerId, code, time: new Date().toISOString() });
    this.entries.length = Math.min(50, this.entries.length);
    logger.warn({ providerId, code }, 'Provider operation failed');
  }
  list() {
    return structuredClone(this.entries);
  }
}
