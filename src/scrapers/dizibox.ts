import { z } from 'zod';
import { MemoryCache } from '../cache/memory-cache.js';
import type { MovieQuery, EpisodeQuery } from '../types/index.js';
import { normalizeTitle } from '../utils/normalize-title.js';
import {
  inspectPublicPage,
  sameSeriesEpisodes,
} from '../utils/inspect-public-page.js';
import {
  auditPlayerHtml,
  publicMediaReferences,
} from '../utils/public-media.js';
import { safeHttp, type HttpTransport } from '../utils/safe-http.js';
import { validateUrl } from '../utils/validate-url.js';

const hosts = ['www.dizibox.live'];
export const diziboxInventorySchema = z.object({
  items: z
    .array(
      z.object({
        title: z.string().min(1).max(300),
        pageUrl: z.string().url(),
        mediaType: z.enum(['movie', 'series']),
      }),
    )
    .max(10000),
});
type Entry = z.infer<typeof diziboxInventorySchema>['items'][number];
export type Discovery = {
  status:
    | 'not-found'
    | 'metadata-required'
    | 'ambiguous'
    | 'blocked'
    | 'identity-unverified'
    | 'wrong-content'
    | 'episode-not-found'
    | 'page-discovered';
  playbackStatus: 'unverified';
  pageUrl?: string;
  httpStatus?: number;
  imdbVerified?: boolean;
  mediaReferences?: ReturnType<typeof publicMediaReferences>['media'];
  playerAudit?: ReturnType<typeof auditPlayerHtml>;
};

/** Public page discovery only. Never registers an unauthorized playback provider. */
export class DiziboxScraper {
  private readonly cache = new MemoryCache<Discovery>(100);
  private readonly entries: Entry[];
  constructor(
    inventory: unknown,
    private readonly http: HttpTransport = safeHttp,
  ) {
    this.entries = diziboxInventorySchema
      .parse(inventory)
      .items.filter((entry) => {
        try {
          const url = validateUrl(entry.pageUrl, hosts);
          return url.protocol === 'https:' && !url.search && !url.hash;
        } catch {
          return false;
        }
      });
  }
  clearCache() {
    this.cache.clear();
  }
  async lookup(
    query: MovieQuery | EpisodeQuery,
    signal: AbortSignal,
  ): Promise<Discovery> {
    const episode = 'seriesTitle' in query;
    const key = JSON.stringify(query);
    const cached = this.cache.get(key);
    if (cached) return cached;
    const finish = (value: Omit<Discovery, 'playbackStatus'>): Discovery => {
      signal.throwIfAborted();
      const result: Discovery = { ...value, playbackStatus: 'unverified' };
      this.cache.set(
        key,
        result,
        result.status === 'page-discovered' ? 1800000 : 120000,
      );
      return result;
    };
    const titles = [
      episode ? query.seriesTitle : query.title,
      query.originalTitle,
      ...(query.alternativeTitles ?? []),
    ]
      .filter((title): title is string => Boolean(title))
      .map(normalizeTitle)
      .filter(Boolean);
    if (!titles.length) return finish({ status: 'metadata-required' });
    const matches = [
      ...new Map(
        this.entries
          .filter(
            (item) =>
              item.mediaType === (episode ? 'series' : 'movie') &&
              titles.includes(normalizeTitle(item.title)),
          )
          .map((item) => [item.pageUrl, item]),
      ).values(),
    ];
    if (!matches.length) return finish({ status: 'not-found' });
    if (matches.length !== 1) return finish({ status: 'ambiguous' });
    const selected = matches[0]!;
    const get = (url: string) =>
      this.http(url, hosts, {
        signal,
        timeoutMs: 8000,
        maxBytes: 2097152,
        minIntervalMs: 1000,
      });
    const detail = await get(selected.pageUrl);
    const html = Buffer.from(detail.body).toString('utf8');
    const page = inspectPublicPage(html, detail.url, detail.status, 10000);
    if (detail.status !== 200 || page.challengeDetected)
      return finish({
        status: 'blocked',
        pageUrl: selected.pageUrl,
        httpStatus: detail.status,
      });
    const observedTitle = normalizeTitle(
      page.title.replace(/\s+izle\s*\|.*$/i, ''),
    );
    if (observedTitle !== normalizeTitle(selected.title))
      return finish({ status: 'wrong-content', pageUrl: selected.pageUrl });
    // A title alone cannot distinguish remakes or unrelated namesakes.
    if (page.imdbIds.length !== 1 || page.imdbIds[0] !== query.imdbId)
      return finish({
        status: 'identity-unverified',
        pageUrl: selected.pageUrl,
        imdbVerified: false,
      });
    let contentHtml = html;
    let contentUrl = detail.url;
    if (episode) {
      const links = [
        ...new Map(
          sameSeriesEpisodes(selected.pageUrl, page.episodeLinks)
            .filter(
              (link) =>
                link.season === query.season && link.episode === query.episode,
            )
            .map((link) => [link.url, link]),
        ).values(),
      ];
      if (links.length !== 1)
        return finish({
          status: links.length ? 'ambiguous' : 'episode-not-found',
          imdbVerified: true,
        });
      const response = await get(links[0]!.url);
      contentHtml = Buffer.from(response.body).toString('utf8');
      contentUrl = response.url;
      const content = inspectPublicPage(
        contentHtml,
        contentUrl,
        response.status,
      );
      if (response.status !== 200 || content.challengeDetected)
        return finish({
          status: 'blocked',
          pageUrl: links[0]!.url,
          httpStatus: response.status,
        });
      if (new URL(response.url).pathname !== new URL(links[0]!.url).pathname)
        return finish({ status: 'wrong-content', pageUrl: links[0]!.url });
    }
    return finish({
      status: 'page-discovered',
      pageUrl: contentUrl,
      imdbVerified: true,
      mediaReferences: publicMediaReferences(contentHtml, contentUrl, hosts)
        .media,
      playerAudit: auditPlayerHtml(contentHtml, contentUrl),
    });
  }
}
