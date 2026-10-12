import { describe, expect, it } from 'vitest';
import {
  inspectPublicPage,
  sameSeriesEpisodes,
} from '../src/utils/inspect-public-page.js';

describe('public page diagnostics', () => {
  it('indexes catalogs larger than the diagnostic preview without overflowing episodes', () => {
    const html =
      Array.from(
        { length: 200 },
        (_, i) => `<a href="/diziler/title-${i}/">Title ${i}</a>`,
      ).join('') + '<a href="/dizi/show/sezon/1/bolum/1">Episode</a>';
    const result = inspectPublicPage(html, 'https://example.com/', 200, 10000);
    expect(result.catalogLinks).toHaveLength(200);
    expect(result.episodeLinks).toHaveLength(1);
    expect(
      inspectPublicPage(html, 'https://example.com/', 200, 1).catalogLinks,
    ).toHaveLength(1);
  });
  it('does not select another series from navigation or recommended episodes', () => {
    const links = [
      { url: 'https://example.com/diziler/other-show-1-sezon-1-bolum/' },
      { url: 'https://example.com/our-show-1-sezon-2-bolum/' },
      { url: 'https://evil.example/our-show-1-sezon-2-bolum/' },
    ];
    expect(
      sameSeriesEpisodes('https://example.com/diziler/our-show/', links),
    ).toEqual([links[1]]);
    const nested = [
      { url: 'https://example.com/dizi/our-show/sezon/1/bolum/1' },
      { url: 'https://example.com/dizi/other-show/sezon/1/bolum/1' },
    ];
    expect(
      sameSeriesEpisodes('https://example.com/dizi/our-show', nested),
    ).toEqual([nested[0]]);
  });
  it('finds episodes beyond a large navigation menu with exact coordinates', () => {
    const menu = Array.from(
      { length: 200 },
      (_, i) => `<a href="/diziler/title-${i}/">Title ${i}</a>`,
    ).join('');
    const result = inspectPublicPage(
      menu +
        '<a href="/show-2-sezon-3-bolum/">Episode</a><a href="/dizi/show/sezon/1/bolum/4">Episode</a>',
      'https://example.com/',
      200,
    );
    expect(result.catalogLinks).toHaveLength(150);
    expect(
      result.episodeLinks.map(({ season, episode }) => [season, episode]),
    ).toEqual([
      [2, 3],
      [1, 4],
    ]);
  });
  it('reports media hosts without copying protected query tokens', () => {
    const result = inspectPublicPage(
      '<iframe src="https://player.example/embed?token=secret"></iframe><video src="https://media.example/video.mp4"></video>',
      'https://example.com/',
      200,
    );
    expect(result.playerHosts).toEqual(['player.example', 'media.example']);
    expect(result.mediaFormats).toEqual(['mp4']);
    expect(JSON.stringify(result)).not.toContain('secret');
  });
  it('does not mistake a security widget on a catalog for a blocking challenge', () => {
    expect(
      inspectPublicPage(
        '<title>Dizibox</title><script src="cf-chl-script"></script><a href="/diziler/breaking-bad/">Breaking Bad</a>',
        'https://example.com/',
        200,
      ),
    ).toMatchObject({
      challengeDetected: false,
      securityWidgetPresent: true,
      catalogLinks: [{ text: 'Breaking Bad' }],
    });
  });
  it('recognizes an actual challenge response', () => {
    expect(
      inspectPublicPage(
        '<title>Just a moment...</title><script>cf-chl-x</script>',
        'https://example.com/',
        403,
      ).challengeDetected,
    ).toBe(true);
  });
  it('collects public same-origin catalog links without following scripts or query tokens', () => {
    const result = inspectPublicPage(
      '<script><a href="/dizi/fake">Fake</a></script><a href="https://evil.test/dizi/x">X</a><a href="/dizi/a?token=secret">A</a><a href="/dizi/b">B</a><a href="/dizi/b">B</a>',
      'https://example.com/',
      200,
    );
    expect(result.catalogLinks).toEqual([
      { text: 'B', url: 'https://example.com/dizi/b' },
    ]);
  });
});
