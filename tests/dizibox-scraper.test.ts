import { describe, expect, it, vi } from 'vitest';
import { DiziboxScraper } from '../src/scrapers/dizibox.js';
import type { HttpTransport } from '../src/utils/safe-http.js';

const base = 'https://www.dizibox.live';
const inventory = {
  items: [
    {
      title: 'Breaking Bad',
      pageUrl: `${base}/diziler/breaking-bad/`,
      mediaType: 'series',
    },
  ],
};
const query = {
  imdbId: 'tt0903747',
  seriesTitle: 'Breaking Bad',
  season: 1,
  episode: 2,
};
const signal = () => new AbortController().signal;
const detail = `<title>Breaking Bad izle | DiziBOX</title><a href="https://www.imdb.com/title/tt0903747/">IMDb</a>
<a href="/breaking-bad-1-sezon-1-bolum-izle/">1</a>
<a href="/breaking-bad-1-sezon-2-bolum-izle/">2</a>
<a href="/other-1-sezon-2-bolum-izle/">Wrong series</a>`;
function transport(html = detail, status = 200) {
  return vi.fn<HttpTransport>(async (url) => ({
    status,
    url,
    headers: { 'content-type': 'text/html' },
    body: Buffer.from(
      url.includes('/diziler/')
        ? html
        : '<title>Episode</title><iframe src="https://www.dizibox.live/player?v=secret"></iframe>',
    ),
  }));
}
describe('Dizibox public scraper', () => {
  it('fetches only the selected series and exact episode, caches, and never claims playback', async () => {
    const http = transport();
    const scraper = new DiziboxScraper(inventory, http);
    const result = await scraper.lookup(query, signal());
    expect(result).toMatchObject({
      status: 'page-discovered',
      imdbVerified: true,
      playbackStatus: 'unverified',
      pageUrl: `${base}/breaking-bad-1-sezon-2-bolum-izle/`,
      mediaReferences: [],
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(http.mock.calls.map(([url]) => url)).toEqual([
      `${base}/diziler/breaking-bad/`,
      `${base}/breaking-bad-1-sezon-2-bolum-izle/`,
    ]);
    await scraper.lookup(query, signal());
    expect(http).toHaveBeenCalledTimes(2);
  });
  it('rejects a namesake with the wrong IMDb before following an episode', async () => {
    const http = transport(detail.replace('tt0903747', 'tt0133093'));
    const scraper = new DiziboxScraper(inventory, http);
    expect((await scraper.lookup(query, signal())).status).toBe(
      'identity-unverified',
    );
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('reports blocked HTML without following players or solving challenges', async () => {
    const http = transport('<title>Just a moment...</title>', 403);
    expect(
      await new DiziboxScraper(inventory, http).lookup(query, signal()),
    ).toMatchObject({
      status: 'blocked',
      httpStatus: 403,
      playbackStatus: 'unverified',
    });
    expect(http).toHaveBeenCalledTimes(1);
  });
  it('avoids network calls for ambiguity, missing metadata and unconfigured hosts', async () => {
    const http = transport();
    const ambiguous = {
      items: [
        ...inventory.items,
        {
          ...inventory.items[0],
          pageUrl: `${base}/diziler/breaking-bad-remake/`,
        },
      ],
    };
    expect(
      (await new DiziboxScraper(ambiguous, http).lookup(query, signal()))
        .status,
    ).toBe('ambiguous');
    expect(
      (
        await new DiziboxScraper(inventory, http).lookup(
          { ...query, seriesTitle: '' },
          signal(),
        )
      ).status,
    ).toBe('metadata-required');
    const malicious = {
      items: [
        {
          ...inventory.items[0],
          pageUrl: 'http://169.254.169.254/diziler/breaking-bad/',
        },
      ],
    };
    expect(
      (await new DiziboxScraper(malicious, http).lookup(query, signal()))
        .status,
    ).toBe('not-found');
    expect(http).not.toHaveBeenCalled();
  });
  it('does not replace a missing episode with another episode', async () => {
    const http = transport();
    expect(
      (
        await new DiziboxScraper(inventory, http).lookup(
          { ...query, episode: 3 },
          signal(),
        )
      ).status,
    ).toBe('episode-not-found');
    expect(http).toHaveBeenCalledTimes(1);
  });
});
