import { describe, expect, it } from 'vitest';
import { DemoProvider, DEMO_URL } from '../src/providers/demo-provider.js';
import { safeHttp } from '../src/utils/safe-http.js';
import { VideoValidator } from '../src/services/video-validator.js';
import { ProviderRegistry } from '../src/providers/registry.js';
import { SettingsStore } from '../src/config/settings.js';
import { StreamService } from '../src/services/stream-service.js';
import { MetadataService } from '../src/services/metadata-service.js';
describe('live authorized Blender media (no network mocks)', () => {
  it('reads and validates a real MP4 file signature', async () => {
    const demo = new DemoProvider();
    const bytes = await safeHttp(DEMO_URL, demo.policy.allowedHosts, {
      range: 'bytes=0-511',
      maxBytes: 512,
      truncate: true,
      timeoutMs: 8000,
    });
    expect(
      [200, 206],
      `Demo HTTP ${bytes.status}; host: ${new URL(DEMO_URL).hostname}; content-type: ${bytes.headers['content-type'] ?? 'unknown'}`,
    ).toContain(bytes.status);
    expect(Buffer.from(bytes.body).subarray(4, 8).toString()).toBe('ftyp');
    const media = await demo.searchMovie({
      imdbId: 'tt1254207',
      title: 'Big Buck Bunny',
      alternativeTitles: [],
    });
    const stream = (await demo.resolveStreams(media[0]!))[0]!;
    expect(
      (
        await new VideoValidator().validate(
          stream,
          demo.policy,
          new AbortController().signal,
        )
      ).format,
    ).toBe('MP4');
  }, 30000);
  it('obtains a real SDK stream for the authorized film', async () => {
    const { createAddon } = await import('../src/addon/handlers.js');
    const demo = new DemoProvider();
    const registry = new ProviderRegistry();
    registry.register(demo);
    const service = new StreamService(
      registry,
      new SettingsStore(),
      { record: () => undefined },
      new MetadataService(safeHttp, false),
    );
    const response = await createAddon(service).get(
      'stream',
      'movie',
      'tt1254207',
      {},
    );
    expect(response).toMatchObject({
      streams: [{ url: DEMO_URL }],
    });
  }, 30000);
});
