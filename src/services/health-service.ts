import { MemoryCache } from '../cache/memory-cache.js';
import { env } from '../config/env.js';
import type { ProviderHealth } from '../types/index.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { Settings } from '../config/settings.js';
import { unsupportedSources } from '../config/providers.js';
import { withTimeout } from '../utils/timeout.js';
import type { ErrorJournal } from '../utils/logger.js';
export class HealthService {
  readonly cache = new MemoryCache<ProviderHealth>(env.CACHE_MAX_ENTRIES);
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly errors: Pick<ErrorJournal, 'record'>,
  ) {}
  async check(settings: Settings) {
    const results = await Promise.allSettled(
      this.registry.all().map(async (provider) => {
        if (!(settings.providers[provider.id] ?? provider.enabled))
          return {
            id: provider.id,
            status: 'disabled',
            latencyMs: 0,
            lastChecked: new Date().toISOString(),
          };
        const cached = this.cache.get(provider.id);
        if (cached) return { id: provider.id, ...cached };
        const start = performance.now();
        let health: ProviderHealth;
        try {
          health = await withTimeout(
            (signal) => provider.healthCheck({ signal }),
            env.HEALTH_TIMEOUT_MS,
          );
          health.error = provider.catalogOnly
            ? 'CATALOG_ONLY_PLAYBACK_UNSUPPORTED'
            : health.error
              ? 'HEALTH_CHECK_FAILED'
              : undefined;
        } catch {
          this.errors.record(provider.id, 'HEALTH_CHECK_FAILED');
          health = {
            status: 'degraded',
            latencyMs: Math.round(performance.now() - start),
            lastChecked: new Date().toISOString(),
            error: 'HEALTH_CHECK_FAILED',
          };
        }
        this.cache.set(provider.id, health, env.HEALTH_TTL_MS);
        return { id: provider.id, ...health };
      }),
    );
    return [
      ...results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : [])),
      ...unsupportedSources.filter(
        (source) => !this.registry.all().some((p) => p.id === source.id),
      ),
    ];
  }
}
