import { beforeEach, describe, expect, it, vi } from 'vitest';
import { stream, http, provider, service } from './helpers.js';
import {
  arrangeStreams,
  parseMasterPlaylist,
} from '../src/services/quality-service.js';
import { MemoryCache } from '../src/cache/memory-cache.js';
import { VideoValidator } from '../src/services/video-validator.js';
import { SettingsStore } from '../src/config/settings.js';
beforeEach(() => http.mockClear());
describe('stream processing', () => {
  it('sorts quality high to low and unknown last', () =>
    expect(
      arrangeStreams(
        [
          stream({ quality: '720p', url: 'https://media.example/720.mp4' }),
          stream({ quality: '2160p' }),
          stream({
            quality: 'Unknown',
            url: 'https://media.example/unknown.mp4',
          }),
        ],
        'all',
        'highest',
      ).map((s) => s.quality),
    ).toEqual(['2160p', '720p', 'Unknown']));
  it('applies exclusive dubbing and subtitles filters', () => {
    const streams = [
      stream({ language: 'tr-sub' }),
      stream({ url: 'https://media.example/dub.mp4', language: 'tr-dub' }),
      stream({ url: 'https://media.example/unknown.mp4' }),
    ];
    expect(
      arrangeStreams(streams, 'only-dub', 'highest').map((s) => s.language),
    ).toEqual(['tr-dub']);
    expect(
      arrangeStreams(streams, 'only-sub', 'highest').map((s) => s.language),
    ).toEqual(['tr-sub']);
  });
  it('prioritizes language before quality', () =>
    expect(
      arrangeStreams(
        [
          stream({ quality: '2160p' }),
          stream({
            url: 'https://media.example/dub.mp4',
            language: 'tr-dub',
            quality: '480p',
          }),
        ],
        'prefer-dub',
        'highest',
      )[0]?.language,
    ).toBe('tr-dub'));
  it('uses HLS resolution metadata', () =>
    expect(
      parseMasterPlaylist(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=1920x1080,CODECS="avc1.4d401f,mp4a.40.2"\n1080.m3u8',
      )[0],
    ).toEqual({
      uri: '1080.m3u8',
      quality: '1080p',
      codec: 'avc1.4d401f,mp4a.40.2',
    }));
  it('does not guess quality from a URL', async () => {
    const p = provider();
    const video = await new VideoValidator(http).validate(
      stream({ qualityEvidence: undefined }),
      p.policy,
      new AbortController().signal,
    );
    expect(video.quality).toBe('Unknown');
  });
  it('uses a bounded GET fallback when HEAD is unsupported', async () => {
    const fallback = vi.fn(
      async (
        url: string,
        _hosts: readonly string[],
        options?: {
          method?: string;
        },
      ) => ({
        status: options?.method === 'HEAD' ? 405 : 206,
        headers: { 'content-type': 'video/mp4' },
        url,
        body: new Uint8Array(),
      }),
    );
    expect(
      (
        await new VideoValidator(fallback).validate(
          stream(),
          provider().policy,
          new AbortController().signal,
        )
      ).format,
    ).toBe('MP4');
    expect(fallback.mock.calls[1]?.[2]).toMatchObject({
      range: 'bytes=0-511',
      maxBytes: 512,
    });
  });
  it('rejects a webpage masquerading as video', async () => {
    const page = vi.fn(async (url: string) => ({
      status: 200,
      headers: { 'content-type': 'text/html' },
      url,
      body: Buffer.from('<html>player</html>'),
    }));
    await expect(
      new VideoValidator(page).validate(
        stream(),
        provider().policy,
        new AbortController().signal,
      ),
    ).rejects.toThrow('VIDEO_UNAVAILABLE');
  });
  it('rejects expired links before a network call', async () => {
    const validator = new VideoValidator(http);
    await expect(
      validator.validate(
        stream({ expiresAt: Date.now() - 100 }),
        provider().policy,
        new AbortController().signal,
      ),
    ).rejects.toThrow('EXPIRED');
    expect(http).not.toHaveBeenCalled();
  });
  it('selects and verifies an unencrypted HLS variant', async () => {
    const hls = vi.fn(
      async (
        url: string,
        _hosts: readonly string[],
        options?: {
          method?: string;
        },
      ) => ({
        status: 200,
        headers: { 'content-type': 'application/vnd.apple.mpegurl' },
        url,
        body:
          options?.method === 'HEAD'
            ? Buffer.alloc(0)
            : Buffer.from(
                url.endsWith('master.m3u8')
                  ? '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=1920x1080\n1080.m3u8'
                  : '#EXTM3U\n#EXTINF:10,\nsegment.ts\n#EXT-X-ENDLIST',
              ),
      }),
    );
    const result = await new VideoValidator(hls).validate(
      stream({
        url: 'https://media.example/master.m3u8',
        format: 'HLS',
        qualityEvidence: undefined,
      }),
      provider().policy,
      new AbortController().signal,
    );
    expect(result.url).toBe('https://media.example/master.m3u8');
    expect(result.quality).toBe('1080p');
  });
  it.each([
    '#EXT-X-KEY:METHOD=AES-128,URI="key"',
    '#EXT-X-KEY:METHOD=SAMPLE-AES,URI="key"',
    '#EXT-X-SESSION-KEY:METHOD=AES-128,URI="key"',
  ])('rejects encrypted HLS %s', async (tag) => {
    const hls = async (url: string) => ({
      status: 200,
      headers: { 'content-type': 'application/vnd.apple.mpegurl' },
      url,
      body: Buffer.from(`#EXTM3U\n${tag}\n#EXTINF:10,\na.ts`),
    });
    await expect(
      new VideoValidator(hls).validate(
        stream({ url: 'https://media.example/a.m3u8', format: 'HLS' }),
        provider().policy,
        new AbortController().signal,
      ),
    ).rejects.toThrow('ENCRYPTED');
  });
  it('rejects HLS references to an unconfigured host', async () => {
    const hls = async (url: string) => ({
      status: 200,
      headers: { 'content-type': 'application/vnd.apple.mpegurl' },
      url,
      body: Buffer.from('#EXTM3U\n#EXTINF:10,\nhttp://127.0.0.1/a.ts'),
    });
    await expect(
      new VideoValidator(hls).validate(
        stream({ url: 'https://media.example/a.m3u8', format: 'HLS' }),
        provider().policy,
        new AbortController().signal,
      ),
    ).rejects.toThrow('HOST_NOT_ALLOWED');
  });
  it('retains verified VTT subtitles and drops invalid subtitle URLs', async () => {
    const captions = async (url: string) => ({
      status: 200,
      headers: {
        'content-type': url.endsWith('.vtt') ? 'text/vtt' : 'video/mp4',
      },
      url,
      body: url.endsWith('.vtt')
        ? Buffer.from('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nMerhaba')
        : Buffer.alloc(0),
    });
    const result = await new VideoValidator(captions).validate(
      stream({
        subtitles: [
          { id: 'tr', lang: 'tur', url: 'https://media.example/tr.vtt' },
          { id: 'bad', lang: 'tur', url: 'http://localhost/private' },
        ],
      }),
      provider().policy,
      new AbortController().signal,
    );
    expect(result.subtitles).toEqual([
      { id: 'tr', lang: 'tur', url: 'https://media.example/tr.vtt' },
    ]);
  });
  it('isolates a broken provider', async () => {
    const { streams, errors } = service([
      provider('broken', {
        searchMovie: async () => {
          throw new Error('secret token');
        },
      }),
      provider(),
    ]);
    expect(await streams.get('movie', 'tt0133093')).toHaveLength(1);
    expect(errors.record).toHaveBeenCalledWith('broken');
  });
  it('deduplicates streams across providers', async () => {
    const { streams } = service([provider(), provider('second')]);
    expect(await streams.get('movie', 'tt0133093')).toHaveLength(1);
  });
  it('rejects wrong movies', async () => {
    const p = provider('wrong', {
      searchMovie: async () => [
        {
          providerId: 'wrong',
          title: 'Alien',
          year: 1979,
          mediaType: 'movie',
          externalId: 'tt0078748',
          pageUrl: 'https://media.example/alien',
          confidence: 1,
        },
      ],
    });
    expect(await service([p]).streams.get('movie', 'tt0133093')).toEqual([]);
    expect(p.resolveStreams).not.toHaveBeenCalled();
  });
  it('caches a repeat query without network requests', async () => {
    const p = provider(),
      { streams } = service([p]);
    await streams.get('movie', 'tt0133093');
    const calls = http.mock.calls.length;
    await streams.get('movie', 'tt0133093');
    expect(p.searchMovie).toHaveBeenCalledTimes(1);
    expect(http).toHaveBeenCalledTimes(calls);
  });
  it('coalesces concurrent queries', async () => {
    const p = provider(),
      { streams } = service([p]);
    await Promise.all(
      Array.from({ length: 10 }, () => streams.get('movie', 'tt0133093')),
    );
    expect(p.searchMovie).toHaveBeenCalledTimes(1);
  });
  it('handles invalid IDs and empty results', async () => {
    const p = provider(),
      { streams } = service([p]);
    expect(await streams.get('movie', 'oops')).toEqual([]);
    expect(p.searchMovie).not.toHaveBeenCalled();
    expect(await service([]).streams.get('movie', 'tt0133093')).toEqual([]);
  });
  it('handles series requests without using a movie stream', async () => {
    const p = provider(),
      { streams } = service([p]);
    expect(await streams.get('series', 'tt0903747:1:1')).toHaveLength(1);
    expect(p.searchEpisode).toHaveBeenCalledWith(
      expect.objectContaining({ season: 1, episode: 1 }),
      expect.anything(),
    );
  });
  it('times out a hung provider while preserving another provider', async () => {
    const settings = new SettingsStore();
    vi.spyOn(settings, 'get').mockReturnValue({
      providers: {},
      language: 'all',
      quality: 'highest',
      providerTimeoutMs: 30,
      matchThreshold: 0.88,
    });
    const { streams } = service(
      [
        provider('hung', {
          searchMovie: async () => new Promise(() => undefined),
        }),
        provider(),
      ],
      settings,
    );
    const start = performance.now();
    expect(await streams.get('movie', 'tt0133093')).toHaveLength(1);
    expect(performance.now() - start).toBeLessThan(500);
  });
  it('respects provider disable settings', async () => {
    const settings = new SettingsStore();
    vi.spyOn(settings, 'get').mockReturnValue({
      providers: { good: false },
      language: 'all',
      quality: 'highest',
      providerTimeoutMs: 8000,
      matchThreshold: 0.88,
    });
    expect(
      await service([provider()], settings).streams.get('movie', 'tt0133093'),
    ).toEqual([]);
  });
});
describe('bounded TTL cache', () => {
  it('expires entries and evicts oldest', () => {
    let now = 0;
    const cache = new MemoryCache<number>(2, () => now);
    cache.set('a', 1, 100);
    cache.set('b', 2, 100);
    cache.set('c', 3, 100);
    expect(cache.get('a')).toBeUndefined();
    now = 101;
    expect(cache.get('c')).toBeUndefined();
    expect(cache.stats().size).toBeLessThanOrEqual(2);
  });
  it('protects cached values from caller mutation', () => {
    const cache = new MemoryCache<{
      count: number;
    }>();
    cache.set('a', { count: 1 }, 1000);
    cache.get('a')!.count = 99;
    expect(cache.get('a')!.count).toBe(1);
  });
});
