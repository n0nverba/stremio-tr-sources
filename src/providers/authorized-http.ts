import {
  sliceCatalog,
  type CatalogQuery,
  type CatalogEntry,
} from './catalog.js';
import { z } from 'zod';
import type { MediaProvider } from './base.js';
import type {
  EpisodeQuery,
  MediaResult,
  MovieQuery,
  ProviderContext,
  ProviderHealth,
  ProviderPolicy,
  ResolvedStream,
} from '../types/index.js';
import { safeHttp, type HttpTransport } from '../utils/safe-http.js';
import { validateUrl } from '../utils/validate-url.js';
import { effectiveExpiry } from '../utils/validate-url.js';
import { MemoryCache } from '../cache/memory-cache.js';
export const providerConfigSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,60}$/),
    name: z.string().min(1).max(150),
    enabled: z.boolean().default(false),
    catalogUrl: z.string().url(),
    policy: z.object({
      allowedHosts: z
        .array(z.string().regex(/^[a-z0-9.-]+$/))
        .min(1)
        .max(20),
      authorization: z.object({
        kind: z.enum(['open-license', 'public-domain', 'explicit-permission']),
        evidenceUrl: z.string().url(),
        attribution: z.string().min(1).max(500),
      }),
      timeoutMs: z.number().int().min(100).max(30000).optional(),
      minRequestIntervalMs: z.number().int().min(100).max(60000).default(250),
    }),
  })
  .strict();
export type AuthorizedHttpConfig = z.infer<typeof providerConfigSchema>;
const streamSchema = z.object({
  url: z.string().url(),
  quality: z
    .enum(['2160p', '1080p', '720p', '480p', 'Unknown'])
    .default('Unknown'),
  qualityEvidence: z.enum(['metadata', 'playlist']).optional(),
  language: z
    .enum(['tr-dub', 'tr-sub', 'original', 'multi', 'unknown'])
    .default('unknown'),
  codec: z.string().max(100).optional(),
  format: z.enum(['MP4', 'HLS', 'WEBM', 'MOV']),
  subtitles: z
    .array(
      z.object({
        id: z.string().max(100),
        url: z.string().url(),
        lang: z.string().max(20),
      }),
    )
    .max(20)
    .default([]),
  expiresAt: z.number().positive().optional(),
});
const itemSchema = z.object({
  title: z.string().min(1).max(300),
  year: z.number().int().min(1800).max(2200).optional(),
  mediaType: z.enum(['movie', 'series']),
  pageUrl: z.string().url(),
  externalId: z
    .string()
    .regex(/^tt\d{7,10}$/)
    .optional(),
  season: z.number().int().min(0).max(999).optional(),
  episode: z.number().int().min(1).max(9999).optional(),
  streams: z.array(streamSchema).max(20),
});
export const catalogSchema = z.object({ items: z.array(itemSchema).max(1000) });
type CatalogItem = z.infer<typeof itemSchema>;
export class AuthorizedHttpProvider implements MediaProvider {
  private readonly catalogCache = new MemoryCache<CatalogItem[]>(1);
  readonly id: string;
  readonly name: string;
  enabled: boolean;
  readonly policy: ProviderPolicy;
  constructor(
    private readonly config: AuthorizedHttpConfig,
    private readonly http: HttpTransport = safeHttp,
  ) {
    const parsed = providerConfigSchema.parse(config);
    this.id = parsed.id;
    this.name = parsed.name;
    this.enabled = parsed.enabled;
    this.policy = parsed.policy;
    validateUrl(parsed.catalogUrl, parsed.policy.allowedHosts);
  }
  private async catalog(context?: ProviderContext): Promise<CatalogItem[]> {
    const cached = this.catalogCache.get('catalog');
    if (cached) return cached;
    const result = await this.http(
      this.config.catalogUrl,
      this.policy.allowedHosts,
      {
        signal: context?.signal,
        maxBytes: 1048576,
        timeoutMs: this.policy.timeoutMs,
        minIntervalMs: this.policy.minRequestIntervalMs,
      },
    );
    if (result.status !== 200) throw new Error('CATALOG_UNAVAILABLE');
    const items = catalogSchema.parse(
      JSON.parse(Buffer.from(result.body).toString('utf8')),
    ).items;
    const ttl = Math.min(
      30000,
      ...items.flatMap((item) =>
        item.streams.map((stream) => {
          const expiry = effectiveExpiry(stream.url, stream.expiresAt);
          return expiry ? Math.max(0, expiry - Date.now() - 30000) : 30000;
        }),
      ),
    );
    this.catalogCache.set('catalog', items, ttl);
    return items;
  }
  async listCatalog(query: CatalogQuery, context?: ProviderContext) {
    const items = await this.catalog(context);
    const unique = new Map<string, CatalogEntry>();
    for (const item of items) {
      const key =
        item.mediaType +
        ':' +
        (item.mediaType === 'movie'
          ? item.pageUrl
          : (item.externalId ?? item.title + ':' + (item.year ?? '')));
      if (!unique.has(key)) unique.set(key, { ...item, episodes: [] });
      if (
        item.mediaType === 'series' &&
        item.season !== undefined &&
        item.episode !== undefined
      )
        unique.get(key)!.episodes!.push({
          season: item.season,
          episode: item.episode,
          pageUrl: item.pageUrl,
        });
    }
    return sliceCatalog([...unique.values()], query);
  }
  async catalogDetail(
    pageUrl: string,
    type: 'movie' | 'series',
    context?: ProviderContext,
  ) {
    return (
      (await this.listCatalog({ type, skip: 0, limit: 1000 }, context)).find(
        (i) => i.pageUrl === pageUrl,
      ) ?? null
    );
  }
  clearCache() {
    this.catalogCache.clear();
  }
  private result(item: CatalogItem): MediaResult {
    return {
      providerId: this.id,
      title: item.title,
      year: item.year,
      mediaType: item.mediaType,
      pageUrl: item.pageUrl,
      externalId: item.externalId,
      season: item.season,
      episode: item.episode,
      confidence: 0,
    };
  }
  async searchMovie(
    _query: MovieQuery,
    context?: ProviderContext,
  ): Promise<MediaResult[]> {
    return (await this.catalog(context))
      .filter((i) => i.mediaType === 'movie')
      .map((i) => this.result(i));
  }
  async searchEpisode(
    query: EpisodeQuery,
    context?: ProviderContext,
  ): Promise<MediaResult[]> {
    return (await this.catalog(context))
      .filter(
        (i) =>
          i.mediaType === 'series' &&
          i.season === query.season &&
          i.episode === query.episode,
      )
      .map((i) => this.result(i));
  }
  async resolveStreams(
    media: MediaResult,
    context?: ProviderContext,
  ): Promise<ResolvedStream[]> {
    const item = (await this.catalog(context)).find(
      (i) =>
        i.pageUrl === media.pageUrl &&
        i.externalId === media.externalId &&
        i.title === media.title &&
        i.year === media.year &&
        i.mediaType === media.mediaType &&
        i.season === media.season &&
        i.episode === media.episode,
    );
    return (item?.streams ?? []).map((s) => ({
      ...s,
      providerId: this.id,
      sourceLabel: this.policy.authorization.attribution,
    }));
  }
  async healthCheck(context?: ProviderContext): Promise<ProviderHealth> {
    const start = performance.now();
    await this.catalog(context);
    return {
      status: 'healthy',
      latencyMs: Math.round(performance.now() - start),
      lastChecked: new Date().toISOString(),
    };
  }
}
