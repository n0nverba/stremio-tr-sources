import { afterEach, describe, expect, it } from 'vitest';
import { DiziboxProvider } from '../src/providers/dizibox-provider.js';
import { DiziLifeProvider } from '../src/providers/dizilife-provider.js';
import { HDFilmCehennemiProvider } from '../src/providers/hdfilmcehennemi-provider.js';
import { FilmMakinesiProvider } from '../src/providers/filmmakinesi-provider.js';
import { createApp, createRuntime } from '../src/server.js';
import { service, provider } from './helpers.js';
import type { Server } from 'node:http';

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
});

async function startServer() {
  const { createServer } = await import('node:net');
  const reservation = createServer();
  await new Promise<void>((resolve) =>
    reservation.listen(0, '127.0.0.1', resolve),
  );
  const port = (
    reservation.address() as {
      port: number;
    }
  ).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const core = service([provider()]);
  const app = createApp(
    createRuntime(core.registry, core.settings, core.streams),
    port,
  );
  const server = app.listen(port, '127.0.0.1');
  servers.push(server);
  await new Promise<void>((resolve) => server.on('listening', resolve));
  return `http://127.0.0.1:${port}`;
}

describe('TR Providers', () => {
  it('DiziboxProvider initializes with policy and searches catalog', async () => {
    const dizibox = new DiziboxProvider(async (url) => ({
      url,
      status: 200,
      headers: {},
      body: Buffer.from(
        '<a href="/breaking-bad-1-sezon-2-bolum-izle/">Breaking Bad 1x2</a>',
      ),
    }));
    expect(dizibox.id).toBe('dizibox');
    expect(dizibox.policy.allowedHosts).toContain('www.dizibox.live');
    expect(dizibox.policy.allowedHosts).toContain('*.molystream.org');

    // Test catalog lookup for Breaking Bad
    const episodes = await dizibox.searchEpisode({
      imdbId: 'tt0903747',
      seriesTitle: 'Breaking Bad',
      season: 1,
      episode: 2,
    });
    expect(episodes.length).toBeGreaterThan(0);
    expect(episodes[0]!.providerId).toBe('dizibox');
    expect(episodes[0]!.title).toContain('Breaking Bad');
    expect(episodes[0]!.season).toBe(1);
    expect(episodes[0]!.episode).toBe(2);
  });

  it('DiziLifeProvider initializes with policy', () => {
    const dizilife = new DiziLifeProvider();
    expect(dizilife.id).toBe('dizilife');
    expect(dizilife.policy.allowedHosts).toContain('dizi77.life');
  });

  it('HDFilmCehennemiProvider initializes with policy', () => {
    const hdfilm = new HDFilmCehennemiProvider();
    expect(hdfilm.id).toBe('hdfilmcehennemi');
    expect(hdfilm.policy.allowedHosts).toContain('www.hdfilmcehennemi.ws');
  });

  it('FilmMakinesiProvider initializes with policy and searches movies', async () => {
    const filmmakinesi = new FilmMakinesiProvider(async (url) => ({
      url,
      status: 200,
      headers: {},
      body: Buffer.from(
        '<div class="posters-4-col"><a href="https://filmmakinesi.co/inception-hd-izle/" title="Inception" class="poster">Inception</a></div>',
      ),
    }));
    expect(filmmakinesi.id).toBe('filmmakinesi');
    expect(filmmakinesi.policy.allowedHosts).toContain('filmmakinesi.to');
    expect(filmmakinesi.policy.allowedHosts).toContain('filmmakinesi.co');

    const movies = await filmmakinesi.searchMovie({
      imdbId: 'tt1375666',
      title: 'Inception',
      year: 2010,
      alternativeTitles: [],
    });
    expect(movies.length).toBe(1);
    expect(movies[0]!.providerId).toBe('filmmakinesi');
    expect(movies[0]!.pageUrl).toBe('https://filmmakinesi.co/inception-hd-izle/');
  });

  it('DiziboxProvider searches movies on ddizibox', async () => {
    const dizibox = new DiziboxProvider(async (url) => ({
      url,
      status: 200,
      headers: {},
      body: Buffer.from(
        '<a href="https://ddizibox.com/film/eden"><h3>Eden</h3></a>',
      ),
    }));
    const movies = await dizibox.searchMovie({
      imdbId: 'tt1234567',
      title: 'Eden',
      year: 2024,
      alternativeTitles: [],
    });
    expect(movies.length).toBe(1);
    expect(movies[0]!.providerId).toBe('dizibox');
    expect(movies[0]!.pageUrl).toBe('https://ddizibox.com/film/eden');
  });

  it('HLS proxy validates url and responds with error on missing parameters', async () => {
    const base = await startServer();

    // Rejection on missing url
    const noUrlRes = await fetch(`${base}/proxy/hls`);
    expect(noUrlRes.status).toBe(400);

    const noSegmentUrlRes = await fetch(`${base}/proxy/segment`);
    expect(noSegmentUrlRes.status).toBe(400);

    // Error on unreachable upstream url
    const unreachableRes = await fetch(
      `${base}/proxy/hls?url=http://127.0.0.1:9999/nonexistent.m3u8`,
    );
    expect(unreachableRes.status).toBe(500);
  });

  it('HLS proxy prioritizes Turkish dialogue subtitles and original audio when audio=orig', async () => {
    const { createServer } = await import('node:http');
    const mockM3u8 = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Türkçe",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="tur",URI="tur~audio.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",DEFAULT=NO,AUTOSELECT=YES,LANGUAGE="eng",URI="eng~audio.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Türkçe",DEFAULT=NO,AUTOSELECT=YES,LANGUAGE="tur",URI="sub~tur.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Türkçe (Zorunlu)",DEFAULT=NO,AUTOSELECT=YES,FORCED=YES,LANGUAGE="tur",URI="sub~tur-forced.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",DEFAULT=YES,AUTOSELECT=YES,LANGUAGE="eng",URI="sub~eng.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1000000,RESOLUTION=1920x1080,AUDIO="audio",SUBTITLES="subs"
video.m3u8`;

    const upstream = createServer((_req, res) => {
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.end(mockM3u8);
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    servers.push(upstream);
    const upstreamPort = (upstream.address() as { port: number }).port;
    const upstreamUrl = `http://127.0.0.1:${upstreamPort}/master.m3u8`;

    const base = await startServer();
    const proxyRes = await fetch(
      `${base}/proxy/hls?url=${encodeURIComponent(upstreamUrl)}&audio=orig`,
    );
    expect(proxyRes.status).toBe(200);
    const text = await proxyRes.text();

    const lines = text.split('\n');

    // Verify Turkish audio is disabled, English audio is default
    const audioTr = lines.find((l) => l.includes('NAME="Türkçe"') && l.includes('TYPE=AUDIO'));
    expect(audioTr).toContain('DEFAULT=NO');
    expect(audioTr).toContain('AUTOSELECT=NO');

    const audioEng = lines.find((l) => l.includes('NAME="English"') && l.includes('TYPE=AUDIO'));
    expect(audioEng).toContain('DEFAULT=YES');
    expect(audioEng).toContain('AUTOSELECT=YES');

    // Verify Turkish dialogue subtitle is active default, forced is stripped/disabled, English subtitle is disabled
    const subTr = lines.find((l) => l.includes('NAME="Türkçe"') && l.includes('TYPE=SUBTITLES'));
    expect(subTr).toContain('DEFAULT=YES');
    expect(subTr).toContain('AUTOSELECT=YES');
    expect(subTr).toContain('FORCED=NO');

    const subForced = lines.find((l) => l.includes('Türkçe (Zorunlu)'));
    expect(subForced).toContain('DEFAULT=NO');
    expect(subForced).toContain('AUTOSELECT=NO');
    expect(subForced).not.toContain('FORCED=YES');

    const subEng = lines.find((l) => l.includes('NAME="English"') && l.includes('TYPE=SUBTITLES'));
    expect(subEng).toContain('DEFAULT=NO');
    expect(subEng).toContain('AUTOSELECT=NO');
  });
});
