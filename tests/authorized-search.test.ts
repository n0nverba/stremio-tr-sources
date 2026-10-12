import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AuthorizedSearchProvider,
  searchProviderConfigSchema,
} from '../src/providers/authorized-search.js';
import { movie, provider, stream, service } from './helpers.js';
import type { HttpTransport } from '../src/utils/safe-http.js';
import { createAddon } from '../src/addon/handlers.js';

const config = searchProviderConfigSchema.parse({
  adapter: 'search-api',
  id: 'search',
  name: 'Authorized search fixture',
  enabled: true,
  searchUrl: 'https://media.example/search?season=99',
  policy: provider().policy,
});
const query = {
  imdbId: 'tt0133093',
  title: 'The Matrix',
  year: 1999,
  alternativeTitles: [],
};
function setup() {
  const http = vi.fn<HttpTransport>(async (raw) => {
    const url = new URL(raw);
    const series = url.searchParams.get('type') === 'series';
    return {
      status: 200,
      url: raw,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(
        JSON.stringify({
          items: [
            {
              ...movie,
              providerId: 'search',
              externalId: url.searchParams.get('imdbId'),
              mediaType: series ? 'series' : 'movie',
              ...(series
                ? {
                    season: Number(url.searchParams.get('season')),
                    episode: Number(url.searchParams.get('episode')),
                  }
                : {}),
              streams: [stream()],
            },
          ],
        }),
      ),
    };
  });
  return { p: new AuthorizedSearchProvider(config, http), http };
}
describe('content-specific authorized search', () => {
  afterEach(() => vi.useRealTimers());
  it('refreshes the targeted response after media cache expiry without losing the match', async () => {
    vi.useFakeTimers();
    const { p, http } = setup();
    const [found] = await p.searchMovie(query);
    vi.advanceTimersByTime(31000);
    expect(await p.resolveStreams(found!)).toHaveLength(1);
    expect(http).toHaveBeenCalledTimes(2);
    expect(new URL(http.mock.calls[1]![0]).searchParams.get('imdbId')).toBe(
      query.imdbId,
    );
  });
  it('requests only the selected movie and reuses its response for resolution', async () => {
    const { p, http } = setup();
    const [found] = await p.searchMovie(query);
    const url = new URL(http.mock.calls[0]![0]);
    expect(url.searchParams.get('imdbId')).toBe(query.imdbId);
    expect(url.searchParams.get('type')).toBe('movie');
    expect(url.searchParams.has('season')).toBe(false);
    expect((await p.resolveStreams(found!))[0]?.providerId).toBe('search');
    await p.searchMovie(query);
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('keeps different episodes separate and includes their exact coordinates', async () => {
    const { p, http } = setup();
    const q = {
      imdbId: 'tt0903747',
      seriesTitle: 'Breaking Bad',
      season: 1,
      episode: 1,
    };
    const [first] = await p.searchEpisode(q);
    const [second] = await p.searchEpisode({ ...q, episode: 2 });
    expect(first?.episode).toBe(1);
    expect(second?.episode).toBe(2);
    expect(http).toHaveBeenCalledTimes(2);
    expect(new URL(http.mock.calls[1]![0]).searchParams.get('episode')).toBe(
      '2',
    );
    expect(await p.resolveStreams({ ...second!, episode: 3 })).toEqual([]);
    p.clearCache();
    expect(await p.resolveStreams(first!)).toEqual([]);
  });
  it('rejects unconfigured search hosts and missing authorization', () => {
    expect(
      () =>
        new AuthorizedSearchProvider({
          ...config,
          searchUrl: 'https://evil.example/search',
        }),
    ).toThrow('HOST_NOT_ALLOWED');
    expect(() =>
      searchProviderConfigSchema.parse({ ...config, policy: {} }),
    ).toThrow();
  });
  it('SDK selection triggers one targeted provider query and then serves cache', async () => {
    const { p, http } = setup();
    const addon = createAddon(service([p]).streams);
    const first = await addon.get('stream', 'movie', query.imdbId, {});
    expect(first).toMatchObject({
      streams: [{ url: 'https://media.example/video.mp4' }],
    });
    await addon.get('stream', 'movie', query.imdbId, {});
    expect(http).toHaveBeenCalledTimes(1);
  });
});
