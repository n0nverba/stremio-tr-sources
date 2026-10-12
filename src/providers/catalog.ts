import { MemoryCache } from '../cache/memory-cache.js';
import type { MediaType, ProviderContext } from '../types/index.js';
import type { HttpTransport } from '../utils/safe-http.js';
import { normalizeTitle } from '../utils/normalize-title.js';
import {
  inspectPublicPage,
  sameSeriesEpisodes,
} from '../utils/inspect-public-page.js';

export interface CatalogQuery {
  type: MediaType;
  skip: number;
  limit: number;
  search?: string;
}
export interface CatalogEntry {
  title: string;
  pageUrl: string;
  mediaType: MediaType;
  year?: number;
  externalId?: string;
  poster?: string;
  description?: string;
  episodes?: {
    season: number;
    episode: number;
    pageUrl: string;
    title?: string;
  }[];
}
export function catalogId(providerId: string, entry: CatalogEntry) {
  return (
    'tr:' + providerId + ':' + Buffer.from(entry.pageUrl).toString('base64url')
  );
}
export function decodeCatalogId(id: unknown) {
  if (typeof id !== 'string' || id.length > 2048) return null;
  const m =
    /^tr:([a-z0-9-]{1,60}):([A-Za-z0-9_-]+)(?::(0|[1-9]\d{0,2}):([1-9]\d{0,3}))?$/.exec(
      id,
    );
  if (!m) return null;
  try {
    const pageUrl = Buffer.from(m[2]!, 'base64url').toString('utf8');
    if (Buffer.from(pageUrl).toString('base64url') !== m[2]) return null;
    const url = new URL(pageUrl);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    return {
      providerId: m[1]!,
      pageUrl,
      season: m[3] === undefined ? undefined : Number(m[3]),
      episode: m[4] === undefined ? undefined : Number(m[4]),
    };
  } catch {
    return null;
  }
}
export function sliceCatalog(items: CatalogEntry[], query: CatalogQuery) {
  const term = normalizeTitle(query.search ?? '');
  return items
    .filter(
      (i) =>
        i.mediaType === query.type &&
        (!term || normalizeTitle(i.title).includes(term)),
    )
    .slice(query.skip, query.skip + query.limit);
}
function clean(text: string) {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n: string) =>
      String.fromCodePoint(Math.min(Number(n), 0x10ffff)),
    )
    .replace(/\s+/g, ' ')
    .trim();
}
function attr(html: string, name: string) {
  return html.match(
    new RegExp('\\b' + name + '\\s*=\\s*(["\'])' + '(.*?)\\1', 'i'),
  )?.[2];
}
function imageUrl(value: string | undefined, base: string) {
  if (!value) return undefined;
  try {
    const u = new URL(value, base);
    return u.protocol === 'https:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}
export function parseCatalogCards(
  html: string,
  baseUrl: string,
  type: MediaType,
): CatalogEntry[] {
  const base = new URL(baseUrl);
  const found = new Map<string, CatalogEntry>();
  for (const m of html.matchAll(
    /<a\b([^>]*\bhref\s*=\s*(["'])(.*?)\2[^>]*)>([\s\S]*?)<\/a>/gi,
  )) {
    try {
      const url = new URL(clean(m[3]!), base);
      const pattern =
        type === 'movie'
          ? /^\/(?:film|movie|movies)\/[^/]+\/?$/
          : /^\/(?:dizi|diziler|series)\/[^/]+\/?$/;
      if (
        url.origin !== base.origin ||
        !pattern.test(url.pathname) ||
        url.search ||
        url.hash
      )
        continue;
      const inner = m[4]!;
      const img = inner.match(/<img\b[^>]*>/i)?.[0] ?? '';
      const name = clean(attr(img, 'alt') ?? attr(m[1]!, 'title') ?? inner);
      if (!name) continue;
      const title = name
        .replace(/\s+(?:izle|türkçe (?:dublaj|altyazı)).*$/i, '')
        .trim();
      const entry: CatalogEntry = {
        title,
        pageUrl: url.href,
        mediaType: type,
        poster: imageUrl(attr(img, 'data-src') ?? attr(img, 'src'), baseUrl),
      };
      const year = clean(inner).match(/\b(19\d{2}|20\d{2})\b/)?.[1];
      if (year) entry.year = Number(year);
      const previous = found.get(url.href);
      if (!previous || (!previous.poster && entry.poster))
        found.set(url.href, entry);
    } catch {
      /* Ignore unrelated or malformed links. */
    }
  }
  return [...found.values()];
}

/** Reads public listing pages lazily and retains page boundaries for exact skip pagination. */
export class PublicCatalog {
  private readonly pages = new MemoryCache<{
    items: CatalogEntry[];
    next?: string;
  }>(500);
  private readonly details = new MemoryCache<CatalogEntry>(500);
  constructor(
    private readonly baseUrl: string,
    private readonly http: HttpTransport,
    private readonly listingUrl: (query: CatalogQuery) => string,
  ) {}
  private contentUrl(pageUrl: string, type: MediaType) {
    const u = new URL(pageUrl);
    const base = new URL(this.baseUrl);
    if (
      u.origin !== base.origin ||
      u.search ||
      u.hash ||
      u.username ||
      u.password ||
      !(
        type === 'movie'
          ? /^\/(?:film|movie|movies)\/[^/]+\/?$/
          : /^\/(?:dizi|diziler|series)\/[^/]+\/?$/
      ).test(u.pathname)
    )
      throw new Error('INVALID_CATALOG_PAGE');
    return u.href;
  }
  private async read(url: string, context?: ProviderContext) {
    const response = await this.http(url, [new URL(this.baseUrl).hostname], {
      signal: context?.signal,
      timeoutMs: 8000,
      maxBytes: 4194304,
      minIntervalMs: 150,
      headers: {
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    const html = Buffer.from(response.body).toString('utf8');
    if (
      response.status !== 200 ||
      inspectPublicPage(html, response.url, response.status).challengeDetected
    )
      throw new Error('CATALOG_UNAVAILABLE');
    return { html, url: response.url };
  }
  async list(
    query: CatalogQuery,
    context?: ProviderContext,
  ): Promise<CatalogEntry[]> {
    let url: string | undefined = this.listingUrl(query);
    const visited = new Set<string>();
    const items = new Map<string, CatalogEntry>();
    while (url && !visited.has(url) && items.size < query.skip + query.limit) {
      context?.signal.throwIfAborted();
      visited.add(url);
      const pageKey = query.type + ':' + url;
      let page = this.pages.get(pageKey);
      if (!page) {
        const response = await this.read(url, context);
        const cards = parseCatalogCards(
          response.html,
          response.url,
          query.type,
        );
        let next: string | undefined;
        for (const m of response.html.matchAll(
          /<a\b([^>]*\bhref\s*=\s*(["'])(.*?)\2[^>]*)>([\s\S]*?)<\/a>/gi,
        )) {
          if (
            !/\brel=["']next["']|next|sonraki|»/i.test(
              m[1]! + ' ' + clean(m[4]!),
            )
          )
            continue;
          try {
            const u = new URL(clean(m[3]!), response.url);
            if (
              u.origin === new URL(this.baseUrl).origin &&
              !u.hash &&
              !visited.has(u.href)
            ) {
              next = u.href;
              break;
            }
          } catch {
            /* Invalid pagination link. */
          }
        }
        page = { items: cards, next };
        this.pages.set(pageKey, page, 300000);
      }
      for (const item of page.items) items.set(item.pageUrl, item);
      url = page.next;
    }
    return [...items.values()].slice(query.skip, query.skip + query.limit);
  }
  async detail(
    pageUrl: string,
    type: MediaType,
    context?: ProviderContext,
  ): Promise<CatalogEntry> {
    const checked = this.contentUrl(pageUrl, type);
    const cached = this.details.get(checked);
    if (cached) return cached;
    const { html, url } = await this.read(checked, context);
    const page = inspectPublicPage(html, url, 200, 10000);
    const tags = [...html.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
    const meta = (key: string) =>
      tags.find((t) => attr(t, 'property') === key || attr(t, 'name') === key);
    const title = clean(
      attr(meta('og:title') ?? '', 'content') ??
        html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ??
        page.title,
    )
      .replace(/\s+(?:izle|\|).*$/i, '')
      .trim();
    const entry: CatalogEntry = {
      title,
      pageUrl: checked,
      mediaType: type,
      description: clean(
        attr(meta('og:description') ?? meta('description') ?? '', 'content') ??
          '',
      ),
      poster: imageUrl(attr(meta('og:image') ?? '', 'content'), url),
      externalId: page.imdbIds.length === 1 ? page.imdbIds[0] : undefined,
      episodes:
        type === 'series'
          ? sameSeriesEpisodes(checked, page.episodeLinks).map((e) => ({
              season: e.season,
              episode: e.episode,
              pageUrl: e.url,
              title: clean(e.text),
            }))
          : undefined,
    };
    // Some sites link season pages separately; load those to expose every listed episode.
    if (type === 'series') {
      const seasonUrls = new Set<string>();
      for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
        try {
          const u = new URL(m[1]!, url);
          const p = new URL(checked);
          if (
            u.origin === p.origin &&
            !u.search &&
            !u.hash &&
            ((u.pathname.startsWith(
              p.pathname.replace(/\/$/, '') + '/sezon/',
            ) &&
              /\/sezon\/\d+\/?$/.test(u.pathname)) ||
              (p.pathname.includes('/diziler/') &&
                u.pathname.startsWith(
                  '/dizi/' + p.pathname.split('/').filter(Boolean).at(-1) + '/',
                ) &&
                /\d+-sezon/.test(u.pathname)))
          )
            seasonUrls.add(u.href);
        } catch {
          /* Invalid season URL. */
        }
      }
      for (const seasonUrl of seasonUrls) {
        const season = await this.read(seasonUrl, context);
        const links = sameSeriesEpisodes(
          checked,
          inspectPublicPage(season.html, season.url, 200, 10000).episodeLinks,
        );
        entry.episodes!.push(
          ...links.map((e) => ({
            season: e.season,
            episode: e.episode,
            pageUrl: e.url,
            title: clean(e.text),
          })),
        );
      }
      entry.episodes = [
        ...new Map(
          entry.episodes!.map((e) => [e.season + ':' + e.episode, e]),
        ).values(),
      ].sort((a, b) => a.season - b.season || a.episode - b.episode);
    }
    this.details.set(checked, entry, 300000);
    return entry;
  }
  clear() {
    this.pages.clear();
    this.details.clear();
  }
}
