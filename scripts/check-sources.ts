import { mkdir, writeFile } from 'node:fs/promises';
import { safeHttp } from '../src/utils/safe-http.js';
import {
  publicMediaReferences,
  publicPageSnapshot,
  auditPlayerHtml,
} from '../src/utils/public-media.js';
import { join } from 'node:path';
import {
  inspectPublicPage,
  sameSeriesEpisodes,
} from '../src/utils/inspect-public-page.js';

const sources = [
  ['hdfilmcehennemi', 'https://www.hdfilmcehennemi.nl/'],
  ['dizibox', 'https://www.dizibox.live/'],
  ['dizipal', 'https://dizipal1588.com/'],
  ['dizilife', 'https://dizi76.life/'],
] as const;

await mkdir('reports', { recursive: true });
const snapshotDirectory = `.cache/source-pages/${Date.now()}`;
await mkdir(snapshotDirectory, { recursive: true });
async function snapshot(id: string, name: string, html: string) {
  const path = join(snapshotDirectory, `${id}-${name}.html`);
  await writeFile(path, publicPageSnapshot(html));
  return path;
}
// Public catalog/detail/episode pages: no cookies, credentials, CAPTCHA or tokens.
const reports = await Promise.allSettled(
  sources
    .filter(
      ([id]) =>
        !process.argv.includes('--selected') ||
        ['dizibox', 'dizilife'].includes(id),
    )
    .map(async ([id, baseUrl]) => {
      const started = performance.now();
      try {
        const response = await safeHttp(baseUrl, [new URL(baseUrl).hostname], {
          maxBytes: 2097152,
          timeoutMs: 8000,
          truncate: true,
        });
        const html = Buffer.from(response.body).toString('utf8');
        const inspection = inspectPublicPage(html, baseUrl, response.status);
        const homepageSnapshot =
          response.status === 200
            ? await snapshot(id, 'home', html)
            : undefined;
        const { challengeDetected } = inspection;
        const detailPages = [];
        if (response.status === 200 && !challengeDetected) {
          for (const [detailIndex, link] of inspection.catalogLinks
            .slice(0, 2)
            .entries()) {
            try {
              const detail = await safeHttp(
                link.url,
                [new URL(baseUrl).hostname],
                {
                  maxBytes: 2097152,
                  timeoutMs: 8000,
                  truncate: true,
                  minIntervalMs: 1000,
                },
              );
              const detailInspection = inspectPublicPage(
                Buffer.from(detail.body).toString('utf8'),
                link.url,
                detail.status,
              );
              const detailSnapshot =
                detail.status === 200
                  ? await snapshot(
                      id,
                      `detail-${detailIndex}`,
                      Buffer.from(detail.body).toString('utf8'),
                    )
                  : undefined;
              const episodePages = [];
              if (
                detail.status === 200 &&
                !detailInspection.challengeDetected
              ) {
                for (const episode of sameSeriesEpisodes(
                  link.url,
                  detailInspection.episodeLinks,
                ).slice(0, 1)) {
                  try {
                    const page = await safeHttp(
                      episode.url,
                      [new URL(baseUrl).hostname],
                      {
                        maxBytes: 2097152,
                        timeoutMs: 8000,
                        truncate: true,
                        minIntervalMs: 1000,
                      },
                    );
                    const result = inspectPublicPage(
                      Buffer.from(page.body).toString('utf8'),
                      episode.url,
                      page.status,
                    );
                    const episodeHtml = Buffer.from(page.body).toString('utf8');
                    const episodeSnapshot =
                      page.status === 200
                        ? await snapshot(
                            id,
                            `episode-${detailIndex}`,
                            episodeHtml,
                          )
                        : undefined;
                    // Fixed, observed host; never automatically expand the allowlist.
                    const inspectionHosts =
                      id === 'dizilife'
                        ? [new URL(baseUrl).hostname, 'dcdlc9f2bddfff97.xyz']
                        : [new URL(baseUrl).hostname];
                    const references = publicMediaReferences(
                      episodeHtml,
                      episode.url,
                      inspectionHosts,
                    );
                    const embedPages = [];
                    if (page.status === 200 && !result.challengeDetected) {
                      for (const embed of references.embeds.slice(0, 1)) {
                        try {
                          const document = await safeHttp(
                            embed,
                            inspectionHosts,
                            {
                              maxBytes: 1048576,
                              timeoutMs: 8000,
                              truncate: true,
                              minIntervalMs: 1000,
                            },
                          );
                          const embedHtml = Buffer.from(document.body).toString(
                            'utf8',
                          );
                          const embedInspection = inspectPublicPage(
                            embedHtml,
                            embed,
                            document.status,
                          );
                          embedPages.push({
                            status: document.status,
                            host: new URL(embed).hostname,
                            title: embedInspection.title,
                            challengeDetected:
                              embedInspection.challengeDetected,
                            snapshot:
                              document.status === 200
                                ? await snapshot(
                                    id,
                                    `embed-${detailIndex}`,
                                    embedHtml,
                                  )
                                : undefined,
                            mediaFormats: embedInspection.mediaFormats,
                            playerHosts: embedInspection.playerHosts,
                            videoElementCount:
                              embedInspection.videoElementCount,
                            scriptAudit: auditPlayerHtml(embedHtml, embed),
                          });
                        } catch {
                          embedPages.push({ error: 'EMBED_REQUEST_FAILED' });
                        }
                      }
                    }
                    episodePages.push({
                      url: episode.url,
                      season: episode.season,
                      episode: episode.episode,
                      status: page.status,
                      title: result.title,
                      challengeDetected: result.challengeDetected,
                      videoElementCount: result.videoElementCount,
                      iframeCount: result.iframeCount,
                      playerHosts: result.playerHosts,
                      mediaFormats: result.mediaFormats,
                      snapshot: episodeSnapshot,
                      embedPages,
                      scriptAudit: auditPlayerHtml(episodeHtml, episode.url),
                    });
                  } catch {
                    episodePages.push({
                      url: episode.url,
                      error: 'EPISODE_REQUEST_FAILED',
                    });
                  }
                }
              }
              detailPages.push({
                url: link.url,
                status: detail.status,
                ...detailInspection,
                snapshot: detailSnapshot,
                episodePages,
              });
            } catch {
              detailPages.push({
                url: link.url,
                error: 'DETAIL_REQUEST_FAILED',
              });
            }
          }
        }
        return {
          id,
          baseUrl,
          status: response.status,
          contentType: response.headers['content-type'] ?? null,
          bytesRead: response.body.length,
          latencyMs: Math.round(performance.now() - started),
          ...inspection,
          detailPages,
          snapshot: homepageSnapshot,
          publicPageReadable:
            response.status === 200 &&
            !challengeDetected &&
            /text\/html/i.test(String(response.headers['content-type'])),
          // These counts describe the homepage, not playable films or permission.
          note: 'Public HTML inspection only; media playback and third-party permission are unverified.',
        };
      } catch (error) {
        const code = (error as { code?: string }).code;
        return {
          id,
          baseUrl,
          error: code && /^[A-Z0-9_]+$/.test(code) ? code : 'REQUEST_FAILED',
          latencyMs: Math.round(performance.now() - started),
        };
      }
    }),
);
const report = {
  checkedAt: new Date().toISOString(),
  snapshotDirectory,
  sources: reports.map((entry) =>
    entry.status === 'fulfilled' ? entry.value : { error: 'PROBE_FAILED' },
  ),
};
await writeFile(
  'reports/source-probe.json',
  JSON.stringify(report, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      checkedAt: report.checkedAt,
      sources: report.sources.map((source) => ({
        id: 'id' in source ? source.id : undefined,
        status: 'status' in source ? source.status : undefined,
        error: 'error' in source ? source.error : undefined,
        title: 'title' in source ? source.title : undefined,
        challengeDetected:
          'challengeDetected' in source ? source.challengeDetected : undefined,
        catalogLinks: 'catalogLinks' in source ? source.catalogLinks.length : 0,
        detailPages: 'detailPages' in source ? source.detailPages.length : 0,
      })),
    },
    null,
    2,
  ),
);
console.log(
  'Rapor: reports/source-probe.json. Bu kontrol oynatım entegrasyonu değildir.',
);
