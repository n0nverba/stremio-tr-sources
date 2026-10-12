import type { CatalogEntry, CatalogQuery } from './catalog.js';
import type {
  EpisodeQuery,
  MediaResult,
  MovieQuery,
  ProviderContext,
  ProviderHealth,
  ProviderPolicy,
  ResolvedStream,
} from '../types/index.js';
export interface MediaProvider {
  id: string;
  name: string;
  enabled: boolean;
  catalogOnly?: boolean;
  policy: ProviderPolicy;
  searchMovie(
    query: MovieQuery,
    context?: ProviderContext,
  ): Promise<MediaResult[]>;
  searchEpisode(
    query: EpisodeQuery,
    context?: ProviderContext,
  ): Promise<MediaResult[]>;
  resolveStreams(
    media: MediaResult,
    context?: ProviderContext,
  ): Promise<ResolvedStream[]>;
  healthCheck(context?: ProviderContext): Promise<ProviderHealth>;
  listCatalog?(
    query: CatalogQuery,
    context?: ProviderContext,
  ): Promise<CatalogEntry[]>;
  catalogDetail?(
    pageUrl: string,
    type: 'movie' | 'series',
    context?: ProviderContext,
  ): Promise<CatalogEntry | null>;
  clearCache?(): void;
}
