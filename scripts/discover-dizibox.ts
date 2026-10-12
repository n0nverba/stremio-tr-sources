import { readFile, writeFile } from 'node:fs/promises';
import { parseId } from '../src/utils/parse-id.js';
import { MetadataService } from '../src/services/metadata-service.js';
import { DiziboxScraper } from '../src/scrapers/dizibox.js';
import { withTimeout } from '../src/utils/timeout.js';

const [type, rawId] = process.argv.slice(2);
const id = parseId(type, rawId);
if (!id)
  throw new Error('Usage: npm run dizibox:discover -- series tt0903747:1:1');
const scraper = new DiziboxScraper(
  JSON.parse(await readFile('reports/dizibox-catalog.json', 'utf8')),
);
let result;
try {
  result = await withTimeout(async (signal) => {
    const metadata = await new MetadataService(undefined, true).get(id, signal);
    return scraper.lookup(
      id.type === 'movie'
        ? metadata
        : {
            imdbId: id.imdbId,
            seriesTitle: metadata.title,
            originalTitle: metadata.originalTitle,
            alternativeTitles: metadata.alternativeTitles,
            year: metadata.year,
            season: id.season!,
            episode: id.episode!,
          },
      signal,
    );
  }, 12000);
} catch (error) {
  const rawCode =
    typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : '';
  const code = [
    'EACCES',
    'ENOTFOUND',
    'ETIMEDOUT',
    'ECONNRESET',
    'ECONNREFUSED',
  ].includes(rawCode)
    ? rawCode
    : 'PUBLIC_REQUEST_FAILED';
  result = {
    status: 'request-failed',
    playbackStatus: 'unverified',
    code,
    error:
      'Public page request failed or timed out. No access-control bypass attempted.',
  };
  process.exitCode = 1;
}
const report = { checkedAt: new Date().toISOString(), requested: id, result };
await writeFile(
  'reports/dizibox-discovery.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(JSON.stringify(report, null, 2));
