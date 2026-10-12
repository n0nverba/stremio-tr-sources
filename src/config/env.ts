import { z } from 'zod';
// Unit tests use an explicit environment, never a developer's local .env file.
if (process.env.NODE_ENV !== 'test') await import('dotenv/config');
const duration = (fallback: number) =>
  z.coerce.number().int().min(1).max(86400000).default(fallback);
const schema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().min(1024).max(65535).default(7000),
  HOST: z.literal('127.0.0.1').default('127.0.0.1'),
  PROVIDER_TIMEOUT_MS: duration(8000),
  GLOBAL_BUDGET_MS: duration(12000),
  HEALTH_TIMEOUT_MS: duration(5000),
  METADATA_TTL_MS: duration(86400000),
  SEARCH_TTL_MS: duration(1800000),
  STREAM_TTL_MS: duration(300000),
  NEGATIVE_TTL_MS: duration(120000),
  HEALTH_TTL_MS: duration(300000),
  CACHE_MAX_ENTRIES: z.coerce.number().int().min(10).max(10000).default(500),
  MATCH_THRESHOLD: z.coerce.number().min(0.8).max(1).default(0.88),
  AMBIGUITY_MARGIN: z.coerce.number().min(0).max(0.3).default(0.06),
  REMOTE_METADATA: z.enum(['true', 'false']).default('true'),
  PROVIDERS_FILE: z.string().default('data/providers.json'),
});
export function parseEnv(input: Record<string, unknown>) {
  return schema.parse(input);
}
export const env = parseEnv(process.env);
