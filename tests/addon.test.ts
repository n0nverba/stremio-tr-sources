import { afterEach, describe, expect, it } from 'vitest';
import { createAddon } from '../src/addon/handlers.js';
import { manifest } from '../src/addon/manifest.js';
import { mapStream } from '../src/addon/stream-mapper.js';
import { createApp, createRuntime } from '../src/server.js';
import { service, provider, stream } from './helpers.js';
import type { Server } from 'node:http';
import { request } from 'node:http';
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0))
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
});
async function start() {
  // Reserve an ephemeral loopback port, then create the app with its real Host allowlist.
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
describe('official Stremio SDK', () => {
  it('declares catalogs, metadata and streams', () => {
    expect(manifest).toMatchObject({
      id: 'com.stremiotr.sources',
      version: '1.1.0',
      catalogs: [
        { type: 'movie', id: 'tr-all' },
        { type: 'series', id: 'tr-all' },
      ],
      resources: [
        'catalog',
        {
          name: 'meta',
          types: ['movie', 'series'],
          idPrefixes: ['tr:'],
        },
        {
          name: 'stream',
          types: ['movie', 'series'],
          idPrefixes: ['tt', 'tr:'],
        },
      ],
      types: ['movie', 'series'],
      idPrefixes: ['tt', 'tr:'],
    });
  });
  it('uses documented stream fields', () =>
    expect(mapStream(stream())).toMatchObject({
      name: '🇹🇷 TR Stream\n1080p',
      title: expect.stringContaining('Bilinmeyen Dil'),
      url: 'https://media.example/video.mp4',
    }));
  it('SDK handler returns protocol JSON', async () => {
    const addon = createAddon(service([provider()]).streams);
    const result = await addon.get('stream', 'movie', 'tt0133093', {});
    expect(result).toMatchObject({
      streams: [{ url: 'https://media.example/video.mp4' }],
      cacheMaxAge: 0,
    });
  });
  it('SDK returns empty streams for invalid IDs or no results', async () => {
    const addon = createAddon(service([]).streams);
    expect(await addon.get('stream', 'movie', 'tt0133093', {})).toMatchObject({
      streams: [],
    });
    expect(
      await addon.get('stream', 'series', 'tt0903747:bad', {}),
    ).toMatchObject({ streams: [] });
  });
  it('serves SDK manifest, movie and episode endpoints with CORS', async () => {
    const base = await start();
    const response = await fetch(`${base}/manifest.json`);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toMatchObject(manifest);
    for (const path of ['movie/tt0133093', 'series/tt0903747:1:1'])
      expect(
        await (await fetch(`${base}/stream/${path}.json`)).json(),
      ).toMatchObject({
        streams: [{ url: 'https://media.example/video.mp4' }],
      });
  });
  it('protects admin from DNS rebinding, foreign origins and CSRF', async () => {
    const base = await start();
    expect(
      await new Promise<number | undefined>((resolve, reject) => {
        // Node Fetch may replace Host; send the actual rebinding header on the wire.
        request(
          `${base}/admin/api/state`,
          {
            headers: { Host: 'evil.example' },
          },
          (response) => {
            response.resume();
            response.on('end', () => resolve(response.statusCode));
          },
        )
          .on('error', reject)
          .end();
      }),
    ).toBe(403);
    expect(
      (
        await fetch(`${base}/admin/api/state`, {
          headers: { Origin: 'https://evil.example' },
        })
      ).status,
    ).toBe(403);
    expect(
      (await fetch(`${base}/admin/api/cache/clear`, { method: 'POST' })).status,
    ).toBe(403);
    const state = (await (await fetch(`${base}/admin/api/state`)).json()) as {
      csrf: string;
    };
    expect(
      (
        await fetch(`${base}/admin/api/cache/clear`, {
          method: 'POST',
          headers: { 'x-csrf-token': state.csrf },
        })
      ).status,
    ).toBe(200);
  });
});
