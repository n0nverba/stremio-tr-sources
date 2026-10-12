import type { CatalogService } from './catalog-service.js';
import { MemoryCache } from '../cache/memory-cache.js';
import { env } from '../config/env.js';
import type { SettingsStore } from '../config/settings.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type {
  EpisodeQuery,
  MediaResult,
  ParsedId,
  ResolvedStream,
} from '../types/index.js';
import { parseId } from '../utils/parse-id.js';
import { withTimeout } from '../utils/timeout.js';
import type { ErrorJournal } from '../utils/logger.js';
import { MetadataService } from './metadata-service.js';
import { selectMatches } from './matching-service.js';
import { arrangeStreams } from './quality-service.js';
import { VideoValidator } from './video-validator.js';
export class StreamService {
  readonly cache = new MemoryCache<ResolvedStream[]>(env.CACHE_MAX_ENTRIES);
  readonly searchCache = new MemoryCache<MediaResult[]>(env.CACHE_MAX_ENTRIES);
  private readonly pending = new Map<string, Promise<ResolvedStream[]>>();
  private generation = 0;
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly settings: SettingsStore,
    private readonly errors: Pick<ErrorJournal, 'record'>,
    readonly metadata = new MetadataService(),
    private readonly validator = new VideoValidator(),
    private readonly catalogs?: CatalogService,
  ) {}
  clear() {
    this.generation++;
    this.cache.clear();
    this.searchCache.clear();
    this.metadata.cache.clear();
    this.registry.all().forEach((provider) => provider.clearCache?.());
  }
  async get(type: unknown, rawId: unknown): Promise<ResolvedStream[]> {
    if (
      typeof rawId === 'string' &&
      rawId.startsWith('tr:') &&
      typeof type === 'string'
    )
      return this.getCatalogStreams(type, rawId);
    const id = parseId(type, rawId);
    if (!id) return [];
    const preferences = this.settings.get();
    const key = JSON.stringify([
      id,
      preferences,
      this.registry.all().map((p) => [p.id, p.enabled, p.policy]),
      this.generation,
    ]);
    const cached = this.cache.get(key);
    if (
      cached &&
      cached.every((s) => !s.expiresAt || s.expiresAt > Date.now() + 30000)
    )
      return cached;
    const inflight = this.pending.get(key);
    if (inflight) return structuredClone(await inflight);
    if (this.pending.size >= 100) return [];
    const generation = this.generation;
    const work = this.search(id, preferences)
      .then((streams) => {
        const expiryTtl = Math.min(
          env.STREAM_TTL_MS,
          ...streams.map((s) =>
            s.expiresAt ? s.expiresAt - Date.now() - 30000 : env.STREAM_TTL_MS,
          ),
        );
        if (generation === this.generation)
          this.cache.set(
            key,
            streams,
            streams.length ? expiryTtl : env.NEGATIVE_TTL_MS,
          );
        return streams;
      })
      .catch(() => {
        this.errors.record('core', 'REQUEST_BUDGET_EXCEEDED');
        return [];
      })
      .finally(() => {
        this.pending.delete(key);
      });
    this.pending.set(key, work);
    return structuredClone(await work);
  }
  private async getCatalogStreams(
    type: string,
    id: string,
  ): Promise<ResolvedStream[]> {
    const started = performance.now();
    const found = await this.catalogs?.media(type, id);
    if (!found) return [];
    const { provider, media } = found;
    const preferences = this.settings.get();
    try {
      const streams = await withTimeout(
        async (signal) => {
          const candidates = (
            await provider.resolveStreams(media, { signal })
          ).slice(0, 30);
          const valid = await Promise.allSettled(
            candidates.map((stream) => {
              if (stream.providerId !== provider.id)
                throw new Error('PROVIDER_ID_MISMATCH');
              return this.validator.validate(stream, provider.policy, signal);
            }),
          );
          return valid.flatMap((r) =>
            r.status === 'fulfilled' ? [r.value] : [],
          );
        },
        Math.min(
          provider.policy.timeoutMs ?? preferences.providerTimeoutMs,
          Math.max(1, env.GLOBAL_BUDGET_MS - (performance.now() - started)),
        ),
      );
      return arrangeStreams(streams, preferences.language, preferences.quality);
    } catch {
      this.errors.record(provider.id, 'CATALOG_STREAM_FAILED');
      return [];
    }
  }
  private async search(
    id: ParsedId,
    preferences: ReturnType<SettingsStore['get']>,
  ): Promise<ResolvedStream[]> {
    // Global budget includes metadata. Keep fulfilled providers if others exceed the budget.
    const start = performance.now();
    const metadata = await withTimeout(
      (signal) => this.metadata.get(id, signal),
      Math.min(5000, env.GLOBAL_BUDGET_MS),
    );
    const remaining = Math.max(
      1,
      env.GLOBAL_BUDGET_MS - (performance.now() - start),
    );
    const query =
      id.type === 'movie'
        ? metadata
        : ({
            imdbId: id.imdbId,
            seriesTitle: metadata.title,
            originalTitle: metadata.originalTitle,
            alternativeTitles: metadata.alternativeTitles,
            year: metadata.year,
            season: id.season!,
            episode: id.episode!,
          } satisfies EpisodeQuery);
    const results = await Promise.allSettled(
      this.registry
        .active(preferences)
        .filter((p) => !p.catalogOnly)
        .map((provider) =>
          withTimeout(
            async (signal) => {
              const searchKey = JSON.stringify([
                id,
                provider.id,
                provider.policy,
                preferences.matchThreshold,
                this.generation,
              ]);
              let found = this.searchCache.get(searchKey);
              if (!found) {
                found =
                  id.type === 'movie'
                    ? await provider.searchMovie(metadata, { signal })
                    : await provider.searchEpisode(query as EpisodeQuery, {
                        signal,
                      });
                signal.throwIfAborted();
                this.searchCache.set(
                  searchKey,
                  found,
                  found.length ? env.SEARCH_TTL_MS : env.NEGATIVE_TTL_MS,
                );
              }
              const matches = selectMatches(
                query,
                found.slice(0, 1000),
                preferences.matchThreshold,
                env.AMBIGUITY_MARGIN,
              );
              const resolved = await Promise.allSettled(
                matches
                  .slice(0, 5)
                  .map((media) => provider.resolveStreams(media, { signal })),
              );
              const candidates = resolved
                .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
                .slice(0, 30);
              if (resolved.some((r) => r.status === 'rejected'))
                this.errors.record(provider.id, 'RESOLVE_FAILED');
              const valid = await Promise.allSettled(
                candidates.map(async (stream) => {
                  if (stream.providerId !== provider.id)
                    throw new Error('PROVIDER_ID_MISMATCH');
                  return this.validator.validate(
                    stream,
                    provider.policy,
                    signal,
                  );
                }),
              );
              signal.throwIfAborted();
              if (valid.some((r) => r.status === 'rejected'))
                this.errors.record(provider.id, 'STREAM_VALIDATION_FAILED');
              return valid.flatMap((r) =>
                r.status === 'fulfilled' ? [r.value] : [],
              );
            },
            Math.min(
              provider.policy.timeoutMs ?? preferences.providerTimeoutMs,
              remaining,
            ),
          ).catch(() => {
            this.errors.record(provider.id);
            return [];
          }),
        ),
    );
    return arrangeStreams(
      results.flatMap((r) => (r.status === 'fulfilled' ? r.value : [])),
      preferences.language,
      preferences.quality,
    );
  }
}
