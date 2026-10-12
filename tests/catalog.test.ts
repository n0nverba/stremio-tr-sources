import { DizipalCatalogProvider } from '../src/providers/dizipal-catalog-provider.js';
import { describe, expect, it, vi } from 'vitest';
import { CatalogService } from '../src/services/catalog-service.js';
import {
  catalogId,
  decodeCatalogId,
  PublicCatalog,
  parseCatalogCards,
  sliceCatalog,
  type CatalogEntry,
} from '../src/providers/catalog.js';
import { DiziboxProvider } from '../src/providers/dizibox-provider.js';
import { HDFilmCehennemiProvider } from '../src/providers/hdfilmcehennemi-provider.js';
import { DiziLifeProvider } from '../src/providers/dizilife-provider.js';
import { AuthorizedHttpProvider } from '../src/providers/authorized-http.js';
import { createAddon } from '../src/addon/handlers.js';
import { createManifest } from '../src/addon/manifest.js';
import { StreamService } from '../src/services/stream-service.js';
import { VideoValidator } from '../src/services/video-validator.js';
import { provider, service, http } from './helpers.js';
import type { HttpTransport } from '../src/utils/safe-http.js';
const entries = (prefix: string, count = 75): CatalogEntry[] =>
  Array.from({ length: count }, (_, i) => ({
    title: prefix + i,
    pageUrl: 'https://media.example/film/' + prefix + i,
    mediaType: 'movie',
  }));
const response = (url: string, html: string) => ({
  url,
  status: 200,
  headers: {},
  body: Buffer.from(html),
});
const card = (slug: string) =>
  '<a href="/film/' +
  slug +
  '"><img alt="' +
  slug +
  '" data-src="/poster.jpg"><span>2024</span></a>';
describe('provider catalogs', () => {
  it('keeps movie and series search caches separate on the same endpoint', async () => {
    const source = new PublicCatalog(
      'https://media.example',
      async (url) =>
        response(
          url,
          card('movie') + '<a href="/dizi/series"><img alt="Series"></a>',
        ),
      () => 'https://media.example/?s=example',
    );
    expect(
      (await source.list({ type: 'movie', skip: 0, limit: 50 })).map(
        (e) => e.title,
      ),
    ).toEqual(['movie']);
    expect(
      (await source.list({ type: 'series', skip: 0, limit: 50 })).map(
        (e) => e.title,
      ),
    ).toEqual(['Series']);
  });
  it('includes Dizipal title cards while keeping unsupported playback empty', async () => {
    const source = new DizipalCatalogProvider(async (url) =>
      response(url, '<a href="/series/reacher"><img alt="Reacher"></a>'),
    );
    const core = service([source]);
    const catalogs = new CatalogService(
      core.registry,
      core.settings,
      core.errors,
    );
    expect(await catalogs.get('series', 'tr-all', {})).toMatchObject([
      { name: 'Reacher' },
    ]);
    expect(await core.streams.get('series', 'tt0903747:1:1')).toEqual([]);
    expect(source.catalogOnly).toBe(true);
  });
  it('round-trips stable IDs across restarts and rejects malformed IDs', () => {
    const id = catalogId('good', entries('a')[0]!);
    expect(decodeCatalogId(id + ':2:3')).toMatchObject({
      providerId: 'good',
      pageUrl: entries('a')[0]!.pageUrl,
      season: 2,
      episode: 3,
    });
    expect(decodeCatalogId('tr:good:!!!')).toBeNull();
    expect(
      decodeCatalogId(
        catalogId('good', {
          ...entries('a')[0]!,
          pageUrl: 'http://localhost/',
        }),
      ),
    ).toBeNull();
  });
  it('interleaves all providers, paginates without overlap, isolates failure', async () => {
    const core = service([
      provider('a', {
        listCatalog: async (q) => sliceCatalog(entries('a'), q),
      }),
      provider('b', {
        listCatalog: async (q) => sliceCatalog(entries('b'), q),
      }),
      provider('bad', {
        listCatalog: async () => {
          throw new Error('offline');
        },
      }),
    ]);
    const catalogs = new CatalogService(
      core.registry,
      core.settings,
      core.errors,
    );
    const first = await catalogs.get('movie', 'tr-all', {});
    const second = await catalogs.get('movie', 'tr-all', { skip: '50' });
    expect(first).toHaveLength(50);
    expect(second).toHaveLength(50);
    expect(first.slice(0, 4).map((m) => m.name)).toEqual([
      'a0',
      'b0',
      'a1',
      'b1',
    ]);
    expect(second[0]!.name).toBe('a25');
    expect(new Set([...first, ...second].map((m) => m.id)).size).toBe(100);
    expect(core.errors.record).toHaveBeenCalledWith('bad', 'CATALOG_FAILED');
    expect(
      await catalogs.get('movie', 'tr-provider-a', { search: 'a74' }),
    ).toMatchObject([{ name: 'a74' }]);
    expect(await catalogs.get('movie', 'tr-all', { skip: '-1' })).toEqual([]);
  });
  it('excludes disabled sources from listing, metadata and streams', async () => {
    const core = service([
      provider('off', {
        enabled: false,
        listCatalog: async () => entries('off'),
        catalogDetail: async () => entries('off')[0]!,
      }),
    ]);
    const catalogs = new CatalogService(
      core.registry,
      core.settings,
      core.errors,
    );
    expect(await catalogs.get('movie', 'tr-all', {})).toEqual([]);
    expect(
      await catalogs.meta('movie', catalogId('off', entries('off')[0]!)),
    ).toBeNull();
  });
  it('uses real episode coordinates and passes the exact selected page through validation', async () => {
    const entry: CatalogEntry = {
      title: 'Example Series',
      mediaType: 'series',
      pageUrl: 'https://media.example/dizi/example',
      episodes: [
        {
          season: 2,
          episode: 3,
          pageUrl: 'https://media.example/dizi/example/sezon/2/bolum/3',
        },
      ],
    };
    const p = provider('good', {
      catalogDetail: async () => entry,
      listCatalog: async () => [entry],
    });
    const core = service([p]);
    const catalogs = new CatalogService(
      core.registry,
      core.settings,
      core.errors,
    );
    const streams = new StreamService(
      core.registry,
      core.settings,
      core.errors,
      undefined,
      new VideoValidator(http),
      catalogs,
    );
    const addon = createAddon(streams, catalogs, core.registry);
    const id = catalogId('good', entry);
    expect((await addon.get('meta', 'series', id)).meta?.videos).toMatchObject([
      { id: id + ':2:3', season: 2, episode: 3 },
    ]);
    expect(
      (await addon.get('stream', 'series', id + ':2:3')).streams,
    ).toHaveLength(1);
    expect(p.resolveStreams).toHaveBeenCalledWith(
      expect.objectContaining({
        pageUrl: entry.episodes![0]!.pageUrl,
        season: 2,
        episode: 3,
      }),
      expect.anything(),
    );
    expect((await addon.get('stream', 'series', id + ':2:4')).streams).toEqual(
      [],
    );
    expect(createManifest(core.registry).catalogs).toContainEqual(
      expect.objectContaining({ id: 'tr-provider-good', type: 'series' }),
    );
  });
  it('parses poster-only cards, relative URLs and excludes foreign or episode pages', () => {
    expect(
      parseCatalogCards(
        card('test') +
          '<a href="https://evil.example/film/x">Wrong</a><a href="/dizi/x/sezon/1/bolum/1">Episode</a>',
        'https://media.example/film/',
        'movie',
      ),
    ).toEqual([
      {
        title: 'test',
        pageUrl: 'https://media.example/film/test',
        mediaType: 'movie',
        year: 2024,
        poster: 'https://media.example/poster.jpg',
      },
    ]);
  });
  it('follows next pages and retains exact offsets without truncating upstream catalogs', async () => {
    const transport = vi.fn<HttpTransport>(async (url) =>
      response(
        url,
        url.endsWith('/page/2')
          ? card('c') + card('d')
          : card('a') +
              card('b') +
              '<a rel="next" href="/film/page/2">Sonraki</a>',
      ),
    );
    const source = new PublicCatalog(
      'https://media.example',
      transport,
      () => 'https://media.example/film/',
    );
    expect(
      (await source.list({ type: 'movie', skip: 1, limit: 2 })).map(
        (i) => i.title,
      ),
    ).toEqual(['b', 'c']);
    expect(
      (await source.list({ type: 'movie', skip: 3, limit: 2 })).map(
        (i) => i.title,
      ),
    ).toEqual(['d']);
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it('reads series metadata and actual episodes, rejects arbitrary detail URLs before fetching', async () => {
    const transport = vi.fn<HttpTransport>(async (url) =>
      response(
        url,
        '<h1>Example</h1><meta property="og:image" content="/poster.jpg"><a href="/dizi/example/sezon/2/bolum/3">Third</a><a href="/dizi/other/sezon/1/bolum/1">Wrong</a>',
      ),
    );
    const source = new PublicCatalog(
      'https://media.example',
      transport,
      () => 'https://media.example/',
    );
    expect(
      await source.detail('https://media.example/dizi/example', 'series'),
    ).toMatchObject({
      title: 'Example',
      episodes: [
        {
          season: 2,
          episode: 3,
          pageUrl: 'https://media.example/dizi/example/sezon/2/bolum/3',
        },
      ],
    });
    await expect(
      source.detail('https://evil.example/film/x', 'movie'),
    ).rejects.toThrow('INVALID_CATALOG_PAGE');
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('lists every locally indexed DiziBOX title and searches beyond the first page', async () => {
    const source = new DiziboxProvider();
    const first = await source.listCatalog({
      type: 'series',
      skip: 0,
      limit: 50,
    });
    const later = await source.listCatalog({
      type: 'series',
      skip: 4700,
      limit: 50,
    });
    expect(first).toHaveLength(50);
    expect(later).toHaveLength(50);
    expect(
      await source.listCatalog({
        type: 'series',
        skip: 0,
        limit: 50,
        search: 'Breaking Bad',
      }),
    ).toMatchObject([{ title: 'Breaking Bad' }]);
    expect(
      await source.listCatalog({ type: 'movie', skip: 0, limit: 50 }),
    ).toEqual([]);
  });
  it('exposes film and series listings for both public providers', async () => {
    const transport = vi.fn<HttpTransport>(async (url) =>
      response(
        url,
        card('example') +
          '<a href="/dizi/example"><img alt="Example series" src="/p.jpg"></a>',
      ),
    );
    for (const source of [
      new HDFilmCehennemiProvider(transport),
      new DiziLifeProvider(transport),
    ]) {
      expect(
        await source.listCatalog({ type: 'movie', skip: 0, limit: 50 }),
      ).toHaveLength(1);
      expect(
        await source.listCatalog({ type: 'series', skip: 0, limit: 50 }),
      ).toHaveLength(1);
    }
  });
  it('groups JSON series episodes into one card and keeps episode playback identity', async () => {
    const items = [1, 2].map((episode) => ({
      title: 'Example',
      mediaType: 'series',
      pageUrl: 'https://media.example/episode/' + episode,
      externalId: 'tt0903747',
      season: 1,
      episode,
      streams: [],
    }));
    const source = new AuthorizedHttpProvider(
      {
        id: 'json',
        name: 'JSON',
        enabled: true,
        catalogUrl: 'https://media.example/catalog.json',
        policy: {
          allowedHosts: ['media.example'],
          minRequestIntervalMs: 150,
          authorization: {
            kind: 'explicit-permission',
            evidenceUrl: 'https://media.example/license',
            attribution: 'Fixture',
          },
        },
      },
      async (url) => response(url, JSON.stringify({ items })),
    );
    const list = await source.listCatalog({
      type: 'series',
      skip: 0,
      limit: 50,
    });
    expect(list).toHaveLength(1);
    expect(list[0]!.episodes).toHaveLength(2);
    expect(
      await source.catalogDetail(list[0]!.pageUrl, 'series'),
    ).toMatchObject({ externalId: 'tt0903747' });
  });
});
