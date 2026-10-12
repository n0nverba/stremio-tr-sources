import { Agent, request } from 'undici';
import { resolvePublicHost, validateUrl } from './validate-url.js';
import { withTimeout } from './timeout.js';
export interface HttpResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Uint8Array;
  url: string;
}
export type HttpTransport = (
  url: string,
  hosts: readonly string[],
  options?: HttpOptions,
) => Promise<HttpResult>;
export interface HttpOptions {
  method?: 'GET' | 'HEAD';
  signal?: AbortSignal;
  maxBytes?: number;
  range?: string;
  timeoutMs?: number;
  minIntervalMs?: number;
  truncate?: boolean;
  headers?: Record<string, string>;
}
const slots = new Map<string, number>();
export const safeHttp: HttpTransport = async (raw, hosts, options = {}) =>
  withTimeout(
    async (signal) => {
      let url = validateUrl(raw, hosts);
      for (let redirect = 0; redirect <= 3; redirect++) {
        const now = Date.now(),
          interval = options.minIntervalMs ?? 150;
        const previous = slots.get(url.hostname) ?? 0;
        const delay = Math.max(0, previous - now);
        if (slots.size > 1000) slots.clear();
        slots.set(url.hostname, now + delay + interval);
        if (delay)
          await new Promise<void>((resolve, reject) => {
            const abort = () => {
              clearTimeout(timer);
              reject(new Error('OPERATION_TIMEOUT'));
            };
            const timer = setTimeout(() => {
              signal.removeEventListener('abort', abort);
              resolve();
            }, delay);
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
          });
        // Pin a verified address for this connection; do not resolve the hostname again.
        const address = await resolvePublicHost(url);
        signal.throwIfAborted();
        const dispatcher = new Agent({
          connect: {
            autoSelectFamily: false,
            lookup: (_hostname, _opts, callback) =>
              callback(null, address.address, address.family),
          },
        });
        try {
          const response = await request(url, {
            dispatcher,
            method: options.method ?? 'GET',
            signal,
            headersTimeout: options.timeoutMs ?? 8000,
            bodyTimeout: options.timeoutMs ?? 8000,
            headers: {
              ...(options.headers ?? {}),
              ...(options.range ? { range: options.range } : {}),
            },
          });
          response.body.on('error', () => {});
          if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
            response.body.destroy();
            const location = response.headers.location;
            if (redirect === 3 || typeof location !== 'string')
              throw new Error('INVALID_REDIRECT');
            url = validateUrl(new URL(location, url).href, hosts);
            continue;
          }
          const limit = options.maxBytes ?? 1048576;
          const chunks: Uint8Array[] = [];
          let size = 0;
          for await (const part of response.body) {
            const chunk = new Uint8Array(part as Buffer);
            if (size + chunk.length > limit) {
              if (!options.truncate) {
                response.body.destroy();
                throw new Error('RESPONSE_TOO_LARGE');
              }
              chunks.push(chunk.subarray(0, limit - size));
              size = limit;
              response.body.destroy();
              break;
            }
            chunks.push(chunk);
            size += chunk.length;
          }
          return {
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks, size),
            url: url.href,
          };
        } finally {
          await dispatcher.destroy();
        }
      }
      throw new Error('INVALID_REDIRECT');
    },
    options.timeoutMs ?? 8000,
    options.signal,
  );
