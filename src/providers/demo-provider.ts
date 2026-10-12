import { sliceCatalog, type CatalogQuery } from './catalog.js';
import type { MediaProvider } from './base.js';
import type {
  EpisodeQuery,
  MediaResult,
  MovieQuery,
  ProviderContext,
  ProviderHealth,
  ResolvedStream,
} from '../types/index.js';
import { safeHttp, type HttpTransport } from '../utils/safe-http.js';
export const DEMO_URL = 'https://media.w3.org/2010/05/bunny/movie.mp4';
export class DemoProvider implements MediaProvider {
  readonly id = 'blender-demo';
  readonly name = 'Blender Foundation · Big Buck Bunny';
  enabled = true;
  readonly policy = {
    allowedHosts: ['media.w3.org'],
    authorization: {
      kind: 'open-license' as const,
      evidenceUrl: 'https://peach.blender.org/about/',
      attribution:
        'Big Buck Bunny © 2008 Blender Foundation · CC BY 3.0 · https://peach.blender.org',
    },
    minRequestIntervalMs: 200,
  };
  constructor(private readonly http: HttpTransport = safeHttp) {}
  async listCatalog(query: CatalogQuery) {
    return sliceCatalog(
      [
        {
          title: 'Big Buck Bunny',
          year: 2008,
          mediaType: 'movie',
          pageUrl: 'https://peach.blender.org/',
          externalId: 'tt1254207',
        },
      ],
      query,
    );
  }
  async catalogDetail(pageUrl: string, type: 'movie' | 'series') {
    return (
      (await this.listCatalog({ type, skip: 0, limit: 50 })).find(
        (i) => i.pageUrl === pageUrl,
      ) ?? null
    );
  }
  async searchMovie(query: MovieQuery): Promise<MediaResult[]> {
    return query.imdbId === 'tt1254207'
      ? [
          {
            providerId: this.id,
            title: 'Big Buck Bunny',
            year: 2008,
            mediaType: 'movie',
            pageUrl: 'https://peach.blender.org/',
            externalId: 'tt1254207',
            confidence: 1,
          },
        ]
      : [];
  }
  async searchEpisode(_query: EpisodeQuery): Promise<MediaResult[]> {
    return [];
  }
  async resolveStreams(media: MediaResult): Promise<ResolvedStream[]> {
    if (
      media.providerId !== this.id ||
      media.mediaType !== 'movie' ||
      media.externalId !== 'tt1254207'
    )
      return [];
    return [
      {
        providerId: this.id,
        url: DEMO_URL,
        quality: 'Unknown',
        language: 'unknown',
        format: 'MP4',
        subtitles: [],
        sourceLabel: this.policy.authorization.attribution,
      },
    ];
  }
  async healthCheck(context?: ProviderContext): Promise<ProviderHealth> {
    const start = performance.now();
    const response = await this.http(DEMO_URL, this.policy.allowedHosts, {
      method: 'HEAD',
      signal: context?.signal,
      maxBytes: 0,
    });
    return {
      status: response.status === 200 ? 'healthy' : 'degraded',
      latencyMs: Math.round(performance.now() - start),
      lastChecked: new Date().toISOString(),
      ...(response.status === 200 ? {} : { error: 'DEMO_UNAVAILABLE' }),
    };
  }
}
