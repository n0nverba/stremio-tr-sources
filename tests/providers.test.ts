import { describe, expect, it, vi } from 'vitest';
import {
  AuthorizedHttpProvider,
  providerConfigSchema,
} from '../src/providers/authorized-http.js';
import { DemoProvider } from '../src/providers/demo-provider.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { HealthService } from '../src/services/health-service.js';
import { MetadataService } from '../src/services/metadata-service.js';
import { provider, stream, movie, http } from './helpers.js';
import type { HttpTransport } from '../src/utils/safe-http.js';
describe('authorized providers', () => {
  const config = providerConfigSchema.parse({
    id: 'authorized',
    name: 'Authorized JSON catalog',
    enabled: true,
    catalogUrl: 'https://media.example/catalog.json',
    policy: provider().policy,
  });
  const query = {
    imdbId: 'tt0133093',
    title: 'The Matrix',
    year: 1999,
    alternativeTitles: [],
  };
  it('searches a permitted JSON catalog and resolves streams', async () => {
    const catalog = {
      items: [
        { ...movie, streams: [stream()] },
        {
          ...movie,
          mediaType: 'series',
          externalId: 'tt0903747',
          title: 'Breaking Bad',
          season: 1,
          episode: 1,
          streams: [stream()],
        },
      ],
    };
    const transport = vi.fn<HttpTransport>(async (url) => ({
      status: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify(catalog)),
      url,
    }));
    const p = new AuthorizedHttpProvider(config, transport);
    const found = await p.searchMovie(query);
    expect(found).toHaveLength(1);
    expect(found[0]?.providerId).toBe('authorized');
    expect((await p.resolveStreams(found[0]!))[0]?.providerId).toBe(
      'authorized',
    );
    expect(
      await p.searchEpisode({
        imdbId: 'tt0903747',
        seriesTitle: 'Breaking Bad',
        season: 1,
        episode: 2,
      }),
    ).toEqual([]);
    expect((await p.healthCheck()).status).toBe('healthy');
  });
  it('requires explicit license evidence and configured hosts', () => {
    expect(() =>
      providerConfigSchema.parse({ ...config, policy: { allowedHosts: [] } }),
    ).toThrow();
    expect(
      () =>
        new AuthorizedHttpProvider({
          ...config,
          catalogUrl: 'https://evil.example/catalog.json',
        }),
    ).toThrow('HOST_NOT_ALLOWED');
  });
  it('rejects malformed catalog data', async () => {
    const p = new AuthorizedHttpProvider(config, async (url) => ({
      status: 200,
      headers: {},
      body: Buffer.from('{"items":[{"title":42}]}'),
      url,
    }));
    await expect(p.searchMovie(query)).rejects.toThrow();
  });
  it('does not substitute another item during resolution', async () => {
    const p = new AuthorizedHttpProvider(config, async (url) => ({
      status: 200,
      headers: {},
      body: Buffer.from(
        JSON.stringify({
          items: [{ ...movie, title: 'Different title', streams: [stream()] }],
        }),
      ),
      url,
    }));
    expect(await p.resolveStreams(movie)).toEqual([]);
  });
  it('demo exposes only its real IMDb film, never a series episode', async () => {
    const demo = new DemoProvider(http);
    expect(
      await demo.searchMovie({ ...query, imdbId: 'tt1254207' }),
    ).toHaveLength(1);
    expect(await demo.searchMovie(query)).toEqual([]);
    expect(
      await demo.searchEpisode({
        imdbId: 'tt0903747',
        seriesTitle: 'Breaking Bad',
        season: 1,
        episode: 1,
      }),
    ).toEqual([]);
  });
  it('registry rejects duplicates and reserved unsupported source IDs', () => {
    const r = new ProviderRegistry();
    r.register(provider());
    expect(() => r.register(provider())).toThrow();
    expect(() => r.register(provider('dizipal'))).toThrow();
  });
  it('demo resolution never substitutes its film for another item', async () => {
    const demo = new DemoProvider(http);
    expect(await demo.resolveStreams(movie)).toEqual([]);
    const [found] = await demo.searchMovie({ ...query, imdbId: 'tt1254207' });
    expect(await demo.resolveStreams(found!)).toHaveLength(1);
    expect(
      await demo.resolveStreams({ ...found!, mediaType: 'series' }),
    ).toEqual([]);
  });
  it('health service isolates failure and caches results', async () => {
    const r = new ProviderRegistry(),
      good = provider();
    r.register(good);
    r.register(
      provider('bad', {
        healthCheck: async () => {
          throw new Error('sensitive');
        },
      }),
    );
    const record = vi.fn();
    const health = new HealthService(r, { record });
    const settings = {
      providers: {},
      language: 'all' as const,
      quality: 'highest' as const,
      providerTimeoutMs: 8000,
      matchThreshold: 0.88,
    };
    const result = await health.check(settings);
    expect(result.find((p) => p.id === 'bad')?.status).toBe('degraded');
    expect(result.find((p) => p.id === 'dizipal')?.status).toBe('unsupported');
    await health.check(settings);
    expect(good.healthCheck).toHaveBeenCalledTimes(1);
  });
  it('metadata identifies the demo movie and caches metadata', async () => {
    const metadata = new MetadataService(http, false),
      id = { type: 'movie' as const, imdbId: 'tt1254207' };
    expect((await metadata.get(id, new AbortController().signal)).title).toBe(
      'Big Buck Bunny',
    );
    await metadata.get(id, new AbortController().signal);
    expect(metadata.cache.stats().hits).toBe(1);
  });
});
