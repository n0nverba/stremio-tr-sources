import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { z } from 'zod';
import { inspectPublicPage } from '../src/utils/inspect-public-page.js';

// Index already-observed public HTML. This never accesses player sessions or
// assumes that a catalog entry is a permitted, playable stream.
const probe = z
  .object({
    checkedAt: z.string(),
    sources: z.array(
      z.object({
        id: z.string(),
        baseUrl: z.string().url(),
        status: z.number(),
        snapshot: z.string().optional(),
      }),
    ),
  })
  .parse(JSON.parse(await readFile('reports/source-probe.json', 'utf8')));
const source = probe.sources.find((item) => item.id === 'dizibox');
if (!source?.snapshot || source.status !== 200)
  throw new Error('DIZIBOX_PUBLIC_SNAPSHOT_REQUIRED');
const root = resolve('.cache/source-pages');
const snapshot = resolve(source.snapshot);
if (!snapshot.startsWith(root + sep)) throw new Error('INVALID_SNAPSHOT_PATH');
if (new URL(source.baseUrl).origin !== 'https://www.dizibox.live')
  throw new Error('UNEXPECTED_SOURCE_ORIGIN');
const html = await readFile(snapshot, 'utf8');
const inspection = inspectPublicPage(
  html,
  source.baseUrl,
  source.status,
  10000,
);
if (inspection.challengeDetected) throw new Error('PUBLIC_PAGE_BLOCKED');
const items = inspection.catalogLinks.map(({ text, url }) => ({
  title: text,
  pageUrl: url,
  mediaType: /\/(?:film|movie)\//i.test(new URL(url).pathname)
    ? 'movie'
    : 'series',
  playbackStatus: 'unverified',
}));
await mkdir('reports', { recursive: true });
await writeFile(
  'reports/dizibox-catalog.json',
  JSON.stringify(
    {
      indexedAt: new Date().toISOString(),
      sourceObservedAt: probe.checkedAt,
      baseUrl: source.baseUrl,
      mode: 'saved-public-html',
      complete: false,
      pagesIndexed: 1,
      count: items.length,
      note: 'Public homepage inventory only. Full-site coverage, IMDb matching and playback are unverified.',
      items,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify(
    {
      items: items.length,
      complete: false,
      report: 'reports/dizibox-catalog.json',
    },
    null,
    2,
  ),
);
