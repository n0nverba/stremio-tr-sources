import { vi } from 'vitest';
import type { MediaProvider } from '../src/providers/base.js';
import type { MediaResult, ResolvedStream } from '../src/types/index.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { SettingsStore } from '../src/config/settings.js';
import { StreamService } from '../src/services/stream-service.js';
import { MetadataService } from '../src/services/metadata-service.js';
import { VideoValidator } from '../src/services/video-validator.js';
import type { HttpTransport } from '../src/utils/safe-http.js';
export const movie: MediaResult = {
  providerId: 'good',
  title: 'The Matrix',
  year: 1999,
  mediaType: 'movie',
  pageUrl: 'https://media.example/matrix',
  externalId: 'tt0133093',
  confidence: 0,
};
export function stream(
  overrides: Partial<ResolvedStream> = {},
): ResolvedStream {
  return {
    providerId: 'good',
    url: 'https://media.example/video.mp4',
    quality: '1080p',
    qualityEvidence: 'metadata',
    language: 'unknown',
    format: 'MP4',
    subtitles: [],
    sourceLabel: 'Authorized fixture',
    ...overrides,
  };
}
export const http = vi.fn<HttpTransport>(async (url) => ({
  status: 200,
  headers: { 'content-type': 'video/mp4' },
  body: new Uint8Array(),
  url,
}));
export function provider(
  id = 'good',
  overrides: Partial<MediaProvider> = {},
): MediaProvider {
  return {
    id,
    name: id,
    enabled: true,
    policy: {
      allowedHosts: ['media.example'],
      authorization: {
        kind: 'explicit-permission',
        evidenceUrl: 'https://media.example/license',
        attribution: 'Test fixture only',
      },
    },
    searchMovie: vi.fn(async () => [{ ...movie, providerId: id }]),
    searchEpisode: vi.fn(async (q) => [
      {
        ...movie,
        providerId: id,
        mediaType: 'series' as const,
        title: q.seriesTitle,
        externalId: q.imdbId,
        season: q.season,
        episode: q.episode,
      },
    ]),
    resolveStreams: vi.fn(async () => [stream({ providerId: id })]),
    healthCheck: vi.fn(async () => ({
      status: 'healthy' as const,
      latencyMs: 1,
      lastChecked: new Date().toISOString(),
    })),
    ...overrides,
  };
}
export function service(
  providers: MediaProvider[],
  settings = new SettingsStore(),
) {
  const registry = new ProviderRegistry();
  providers.forEach((p) => registry.register(p));
  const errors = { record: vi.fn() };
  return {
    streams: new StreamService(
      registry,
      settings,
      errors,
      new MetadataService(http, false),
      new VideoValidator(http),
    ),
    registry,
    errors,
    settings,
  };
}
