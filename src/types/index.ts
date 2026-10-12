export type MediaType = 'movie' | 'series';
export type Quality = '2160p' | '1080p' | '720p' | '480p' | 'Unknown';
export type Language = 'tr-dub' | 'tr-sub' | 'original' | 'multi' | 'unknown';
export type LanguagePreference =
  'all' | 'prefer-dub' | 'prefer-sub' | 'only-dub' | 'only-sub';
export interface MovieQuery {
  imdbId: string;
  title: string;
  originalTitle?: string;
  year?: number;
  alternativeTitles: string[];
}
export interface EpisodeQuery {
  imdbId: string;
  seriesTitle: string;
  season: number;
  episode: number;
  episodeTitle?: string;
  originalTitle?: string;
  alternativeTitles?: string[];
  year?: number;
}
export interface MediaResult {
  providerId: string;
  title: string;
  year?: number;
  mediaType: MediaType;
  pageUrl: string;
  externalId?: string;
  confidence: number;
  season?: number;
  episode?: number;
}
export interface ResolvedStream {
  providerId: string;
  url: string;
  quality: Quality;
  qualityEvidence?: 'metadata' | 'playlist';
  language: Language;
  codec?: string;
  format: 'MP4' | 'HLS' | 'WEBM' | 'MOV';
  subtitles: {
    id: string;
    url: string;
    lang: string;
  }[];
  sourceLabel: string;
  expiresAt?: number;
  headers?: Record<string, string>;
  behaviorHints?: Record<string, unknown>;
}
export interface ProviderHealth {
  status: 'healthy' | 'degraded' | 'disabled' | 'unsupported';
  latencyMs: number;
  lastChecked: string;
  error?: string;
}
export interface ProviderContext {
  signal: AbortSignal;
}
export interface ProviderPolicy {
  allowedHosts: string[];
  authorization: {
    kind:
      'open-license' | 'public-domain' | 'explicit-permission' | 'catalog-only';
    evidenceUrl: string;
    attribution: string;
  };
  timeoutMs?: number;
  minRequestIntervalMs?: number;
  allowClearKey?: boolean;
}
export interface ParsedId {
  type: MediaType;
  imdbId: string;
  season?: number;
  episode?: number;
}
