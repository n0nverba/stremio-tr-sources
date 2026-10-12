import type { MediaProvider } from './base.js';
import { PublicCatalog, type CatalogQuery } from './catalog.js';
import type {
  MovieQuery,
  EpisodeQuery,
  MediaResult,
  ProviderContext,
  ProviderPolicy,
  ResolvedStream,
  ProviderHealth,
} from '../types/index.js';
import { safeHttp, type HttpTransport } from '../utils/safe-http.js';
const BASE_URL = 'https://dizipal1588.com';
/** Public title catalog; playback remains unsupported. */
export class DizipalCatalogProvider implements MediaProvider {
  readonly id = 'dizipal';
  readonly name = 'Dizipal';
  enabled = true;
  readonly catalogOnly = true;
  readonly policy: ProviderPolicy = {
    allowedHosts: ['dizipal1588.com'],
    timeoutMs: 10000,
    minRequestIntervalMs: 250,
    authorization: {
      kind: 'catalog-only',
      evidenceUrl: BASE_URL,
      attribution: 'Dizipal · İçerik kataloğu',
    },
  };
  private readonly catalog: PublicCatalog;
  constructor(http: HttpTransport = safeHttp) {
    this.catalog = new PublicCatalog(
      BASE_URL,
      http,
      (q) =>
        BASE_URL +
        (q.search
          ? '/arama?q=' + encodeURIComponent(q.search)
          : q.type === 'movie'
            ? '/hd-film-izle'
            : '/yabanci-dizi-izle'),
    );
  }
  listCatalog(query: CatalogQuery, context?: ProviderContext) {
    return this.catalog.list(query, context);
  }
  catalogDetail(
    pageUrl: string,
    type: 'movie' | 'series',
    context?: ProviderContext,
  ) {
    return this.catalog.detail(pageUrl, type, context);
  }
  async searchMovie(_query: MovieQuery): Promise<MediaResult[]> {
    return [];
  }
  async searchEpisode(_query: EpisodeQuery): Promise<MediaResult[]> {
    return [];
  }
  async resolveStreams(_media: MediaResult): Promise<ResolvedStream[]> {
    return [];
  }
  async healthCheck(): Promise<ProviderHealth> {
    return {
      status: 'unsupported',
      latencyMs: 0,
      lastChecked: new Date().toISOString(),
      error: 'CATALOG_ONLY_PLAYBACK_UNSUPPORTED',
    };
  }
  clearCache() {
    this.catalog.clear();
  }
}
