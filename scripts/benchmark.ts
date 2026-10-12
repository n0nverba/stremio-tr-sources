import { writeFile, mkdir } from 'node:fs/promises';
import { platform, release, cpus } from 'node:os';
import { ProviderRegistry } from '../src/providers/registry.js';
import { SettingsStore } from '../src/config/settings.js';
import { StreamService } from '../src/services/stream-service.js';
import { MetadataService } from '../src/services/metadata-service.js';
import { VideoValidator } from '../src/services/video-validator.js';
import { DemoProvider } from '../src/providers/demo-provider.js';
import type { MediaProvider } from '../src/providers/base.js';
import type { HttpTransport } from '../src/utils/safe-http.js';
const live = process.argv.includes('--live');
const samples = live ? 10 : 100;
const transport: HttpTransport = async (url) => ({
  status: 200,
  headers: { 'content-type': 'video/mp4' },
  body: new Uint8Array(),
  url,
});
const registry = new ProviderRegistry();
const fixture: MediaProvider = {
  id: 'benchmark-fixture',
  name: 'Synthetic benchmark fixture',
  enabled: true,
  policy: {
    allowedHosts: ['media.example'],
    authorization: {
      kind: 'explicit-permission',
      evidenceUrl: 'https://media.example/license',
      attribution: 'Synthetic benchmark only',
    },
  },
  searchMovie: async () => [
    {
      providerId: 'benchmark-fixture',
      title: 'Big Buck Bunny',
      year: 2008,
      mediaType: 'movie',
      externalId: 'tt1254207',
      pageUrl: 'https://media.example/bbb',
      confidence: 1,
    },
  ],
  searchEpisode: async () => [],
  resolveStreams: async () => [
    {
      providerId: 'benchmark-fixture',
      url: 'https://media.example/video.mp4',
      quality: 'Unknown',
      language: 'unknown',
      format: 'MP4',
      subtitles: [],
      sourceLabel: 'Synthetic',
    },
  ],
  healthCheck: async () => ({
    status: 'healthy',
    latencyMs: 0,
    lastChecked: new Date().toISOString(),
  }),
};
registry.register(live ? new DemoProvider() : fixture);
const service = new StreamService(
  registry,
  new SettingsStore(),
  { record: () => undefined },
  new MetadataService(undefined, false),
  live ? new VideoValidator() : new VideoValidator(transport),
);
const cold: number[] = [],
  warm: number[] = [];
for (let i = 0; i < samples; i++) {
  service.clear();
  let start = performance.now();
  const streams = await service.get('movie', 'tt1254207');
  if (!streams.length)
    throw new Error(
      'Benchmark requires a playable result; cannot measure a failed request as success.',
    );
  cold.push(performance.now() - start);
  start = performance.now();
  await service.get('movie', 'tt1254207');
  warm.push(performance.now() - start);
}
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: values.length,
    meanMs: values.reduce((a, b) => a + b, 0) / values.length,
    p50Ms: sorted[Math.floor(values.length * 0.5)],
    p95Ms:
      sorted[Math.min(values.length - 1, Math.floor(values.length * 0.95))],
    maxMs: Math.max(...values),
  };
};
const report = {
  measuredAt: new Date().toISOString(),
  mode: live ? 'live-authorized-media' : 'synthetic-no-network',
  node: process.version,
  os: `${platform()} ${release()}`,
  cpu: cpus()[0]?.model,
  cold: stats(cold),
  cacheHit: stats(warm),
  memory: process.memoryUsage(),
  note: live
    ? 'Network timings include validation; Stremio GUI playback is a separate manual check.'
    : 'Measures core overhead only; not internet latency or Stremio playback.',
};
await mkdir('reports', { recursive: true });
await writeFile(
  `reports/benchmark-${live ? 'live' : 'synthetic'}.json`,
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
