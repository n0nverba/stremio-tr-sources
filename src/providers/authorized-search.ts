import type { CatalogQuery } from './catalog.js';
import type { MediaProvider } from './base.js';
import { z } from 'zod';
import {
  AuthorizedHttpProvider,
  providerConfigSchema,
} from './authorized-http.js';
import type {
  EpisodeQuery,
  MediaResult,
  MovieQuery,
  ProviderContext,
  ProviderPolicy,
} from '../types/index.js';
import { safeHttp, type HttpTransport } from '../utils/safe-http.js';
import { env } from '../config/env.js';

export const searchProviderConfigSchema = providerConfigSchema
  .omit({ catalogUrl: true })
  .extend({
    catalogUrl: providerConfigSchema.shape.catalogUrl.optional(),
    adapter: z.literal('search-api'),
    searchUrl: providerConfigSchema.shape.catalogUrl,
  })
  .strict();

export type SearchConfig = z.infer<typeof searchProviderConfigSchema>;
type Origin = { provider: AuthorizedHttpProvider; expires: number };

/** Authorized JSON search API: one content-specific GET, never a site-wide crawl. */
export class AuthorizedSearchProvider implements MediaProvider {
  readonly id: string;
  readonly name: string;
  enabled: boolean;
  readonly policy: ProviderPolicy;
  private readonly config: SearchConfig;
  private readonly origins = new Map<string, Origin>();
  private readonly searches = new Map<string, Origin>();

  constructor(
    config: SearchConfig,
    private readonly http: HttpTransport = safeHttp,
  ) {
    this.config = searchProviderConfigSchema.parse(config);
    const checked = this.create(this.config.searchUrl);
    this.id = checked.id;
    this.name = checked.name;
    this.enabled = checked.enabled;
    this.policy = checked.policy;
  }
  private create(url: string) {
    return new AuthorizedHttpProvider(
      {
        id: this.config.id,
        name: this.config.name,
        enabled: this.config.enabled,
        policy: this.config.policy,
        catalogUrl: url,
      },
      this.http,
    );
  }
  private mediaKey(media: MediaResult) {
    return JSON.stringify([
      media.providerId,
      media.mediaType,
      media.externalId,
      media.pageUrl,
      media.title,
      media.year,
      media.season,
      media.episode,
    ]);
  }
  private prune(map: Map<string, Origin>, max: number) {
    for (const [key, entry] of map)
      if (entry.expires <= Date.now()) map.delete(key);
    while (map.size > max) map.delete(map.keys().next().value!);
  }
  private async search(
    query: MovieQuery | EpisodeQuery,
    context?: ProviderContext,
  ) {
    const episode = 'seriesTitle' in query;
    const url = new URL(this.config.searchUrl);
    // Provider configuration may contain fixed parameters; request fields always override them.
    for (const field of [
      'type',
      'imdbId',
      'title',
      'year',
      'season',
      'episode',
    ])
      url.searchParams.delete(field);
    url.searchParams.set('type', episode ? 'series' : 'movie');
    url.searchParams.set('imdbId', query.imdbId);
    const title = episode ? query.seriesTitle : query.title;
    if (title) url.searchParams.set('title', title);
    if (query.year) url.searchParams.set('year', String(query.year));
    if (episode) {
      url.searchParams.set('season', String(query.season));
      url.searchParams.set('episode', String(query.episode));
    }
    this.prune(this.searches, 100);
    let origin = this.searches.get(url.href);
    if (!origin) {
      origin = { provider: this.create(url.href), expires: Date.now() + 30000 };
      this.searches.set(url.href, origin);
      this.prune(this.searches, 100);
    }
    const found = episode
      ? await origin.provider.searchEpisode(query, context)
      : await origin.provider.searchMovie(query, context);
    for (const media of found)
      this.origins.set(this.mediaKey(media), {
        provider: origin.provider,
        // Core search results can outlive the short media-response cache.
        expires: Date.now() + env.SEARCH_TTL_MS,
      });
    this.prune(this.origins, 1000);
    return found;
  }
  async listCatalog(query: CatalogQuery, context?: ProviderContext) {
    if (!this.config.catalogUrl) return [];
    return this.create(this.config.catalogUrl).listCatalog(query, context);
  }
  async catalogDetail(
    pageUrl: string,
    type: 'movie' | 'series',
    context?: ProviderContext,
  ) {
    if (!this.config.catalogUrl) return null;
    const origin = this.create(this.config.catalogUrl);
    const entry = await origin.catalogDetail(pageUrl, type, context);
    if (entry) {
      const media = { ...entry, providerId: this.id, confidence: 0 };
      this.origins.set(this.mediaKey(media), {
        provider: origin,
        expires: Date.now() + env.SEARCH_TTL_MS,
      });
    }
    return entry;
  }
  searchMovie(query: MovieQuery, context?: ProviderContext) {
    return this.search(query, context);
  }
  searchEpisode(query: EpisodeQuery, context?: ProviderContext) {
    return this.search(query, context);
  }
  async resolveStreams(media: MediaResult, context?: ProviderContext) {
    if (this.config.catalogUrl) {
      const streams = await this.create(this.config.catalogUrl).resolveStreams(
        media,
        context,
      );
      if (streams.length) return streams;
    }
    const origin = this.origins.get(this.mediaKey(media));
    if (!origin || origin.expires <= Date.now()) return [];
    return origin.provider.resolveStreams(media, context);
  }
  async healthCheck(context?: ProviderContext) {
    const started = performance.now();
    const response = await this.http(
      this.config.searchUrl,
      this.policy.allowedHosts,
      {
        method: 'HEAD',
        maxBytes: 0,
        signal: context?.signal,
        timeoutMs: this.policy.timeoutMs,
        minIntervalMs: this.policy.minRequestIntervalMs,
      },
    );
    return {
      status:
        response.status >= 200 && response.status < 300
          ? ('healthy' as const)
          : ('degraded' as const),
      latencyMs: Math.round(performance.now() - started),
      lastChecked: new Date().toISOString(),
      ...(response.status >= 200 && response.status < 300
        ? {}
        : { error: 'SEARCH_API_UNAVAILABLE' }),
    };
  }
  clearCache() {
    this.searches.clear();
    this.origins.clear();
  }
}
