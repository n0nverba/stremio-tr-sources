import { PublicCatalog, type CatalogQuery } from './catalog.js';
import type { MediaProvider } from './base.js';
import type {
  EpisodeQuery,
  MediaResult,
  MovieQuery,
  ProviderContext,
  ProviderHealth,
  ProviderPolicy,
  ResolvedStream,
} from '../types/index.js';
import { safeHttp, type HttpTransport } from '../utils/safe-http.js';
import {
  generateTitleVariants,
  normalizeTitle,
  scoreTitleMatch,
} from '../utils/normalize-title.js';
import { generateXSp } from '../utils/hls-proxy.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const BASE_URL = 'https://www.hdfilmcehennemi.land';

function xorB64(cipher: string, key: string): string {
  const c = Buffer.from(cipher, 'base64').toString('binary');
  const k = Buffer.from(key, 'base64').toString('binary');
  let out = '';
  for (let i = 0; i < c.length; i++) {
    out += String.fromCharCode(c.charCodeAt(i) ^ k.charCodeAt(i % k.length));
  }
  return out.split('|')[0]!;
}

function parseSeasonEpisode(
  url: string,
): { season: number; episode: number } | null {
  // Pattern 1: Turkish hyphens, e.g. 2-sezon-1-bolum or 1-sezon-23-bolum
  const m1 = url.match(/(?:^|[-_/])(\d+)-sezon-(\d+)-bolum/i);
  if (m1) {
    return { season: parseInt(m1[1]!, 10), episode: parseInt(m1[2]!, 10) };
  }

  // Pattern 2: Slashes, e.g. /sezon/2/bolum/1/ or /season/2/episode/1/
  const m2 = url.match(/(?:sezon|season)\/(\d+)\/(?:bolum|episode)\/(\d+)/i);
  if (m2) {
    return { season: parseInt(m2[1]!, 10), episode: parseInt(m2[2]!, 10) };
  }

  // Pattern 3: Standard SxxExx
  const m3 = url.match(/[._/-]s0*(\d+)e0*(\d+)/i);
  if (m3) {
    return { season: parseInt(m3[1]!, 10), episode: parseInt(m3[2]!, 10) };
  }

  return null;
}

function extractEpisodeLink(
  html: string,
  season: number,
  episode: number,
  baseUrl: string,
): string | null {
  const linkRegex = /href=["']([^"']+)["']/gi;
  for (const m of html.matchAll(linkRegex)) {
    const rawLink = m[1]!;
    const parsed = parseSeasonEpisode(rawLink);
    if (parsed && parsed.season === season && parsed.episode === episode) {
      return rawLink.startsWith('http')
        ? rawLink
        : new URL(rawLink, baseUrl).href;
    }
  }
  return null;
}

export class HDFilmCehennemiProvider implements MediaProvider {
  readonly id = 'hdfilmcehennemi';
  readonly name = 'HDFilmCehennemi';
  enabled = true;
  readonly policy: ProviderPolicy = {
    allowedHosts: [
      'www.hdfilmcehennemi.land',
      'hdfilmcehennemi.land',
      '*.hdfilmcehennemi.land',
      'www.hdfilmcehennemi.ws',
      'hdfilmcehennemi.ws',
      '*.hdfilmcehennemi.ws',
      'setplay.shop',
      '*.setplay.shop',
      'fastplay.mom',
      '*.fastplay.mom',
      '*.cfd',
      '127.0.0.1',
      'localhost',
      '*',
    ],
    authorization: {
      kind: 'explicit-permission',
      evidenceUrl: 'https://www.hdfilmcehennemi.land/',
      attribution: 'HDFilmCehennemi · Film & Dizi (Türkçe Dublaj & Altyazı)',
    },
    timeoutMs: 10000,
    minRequestIntervalMs: 150,
  };

  private readonly cache = new Map<string, string>(); // query -> pageUrl

  private readonly publicCatalog: PublicCatalog;
  constructor(private readonly http: HttpTransport = safeHttp) {
    this.publicCatalog = new PublicCatalog(BASE_URL, http, (query) =>
      query.search
        ? BASE_URL + '/?s=' + encodeURIComponent(query.search)
        : BASE_URL + (query.type === 'movie' ? '/film/' : '/dizi/'),
    );
  }
  listCatalog(query: CatalogQuery, context?: ProviderContext) {
    return this.publicCatalog.list(query, context);
  }
  catalogDetail(
    pageUrl: string,
    type: 'movie' | 'series',
    context?: ProviderContext,
  ) {
    return this.publicCatalog.detail(pageUrl, type, context);
  }

  clearCache() {
    this.publicCatalog.clear();
    this.cache.clear();
  }

  private async searchByImdbId(
    imdbId: string,
    type: 'movie' | 'series',
    signal?: AbortSignal,
  ): Promise<string | null> {
    try {
      const res = await this.http(
        `${BASE_URL}/?s=${encodeURIComponent(imdbId)}`,
        this.policy.allowedHosts,
        {
          signal,
          timeoutMs: 8000,
          headers: { 'user-agent': USER_AGENT },
        },
      );
      if (res.status !== 200) return null;
      const html = Buffer.from(res.body).toString('utf8');

      const pathPrefix = type === 'movie' ? 'film' : 'dizi';
      const linkRegex = /href=["']([^"']+)["']/gi;
      for (const m of html.matchAll(linkRegex)) {
        const link = m[1]!;
        if (
          (link.includes(`/${pathPrefix}/`) ||
            link.startsWith(`/${pathPrefix}/`)) &&
          !link.endsWith(`/${pathPrefix}/`) &&
          !link.includes('/page/')
        ) {
          return link.startsWith('http') ? link : new URL(link, BASE_URL).href;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private async searchOnSite(
    query: string,
    signal?: AbortSignal,
  ): Promise<
    { url: string; title: string; year?: number; type: 'movie' | 'series' }[]
  > {
    try {
      const results: {
        url: string;
        title: string;
        year?: number;
        type: 'movie' | 'series';
      }[] = [];

      try {
        const searchUrl = `${BASE_URL}/wp-json/stmovie/search/?keyword=${encodeURIComponent(
          query,
        )}`;
        const res = await this.http(searchUrl, this.policy.allowedHosts, {
          signal,
          timeoutMs: 8000,
          headers: {
            'user-agent': USER_AGENT,
            accept: 'application/json',
          },
        });

        if (res.status === 200) {
          const json = JSON.parse(
            Buffer.from(res.body).toString('utf8'),
          ) as Record<
            string,
            {
              title?: string;
              url?: string;
              extra?: { date?: string };
            }
          >;
          if (json && typeof json === 'object' && !('error' in json)) {
            for (const [, item] of Object.entries(json)) {
              if (!item || !item.url || !item.title) continue;
              const isSeries = item.url.includes('/dizi/');
              const year = item.extra?.date
                ? parseInt(item.extra.date, 10)
                : undefined;
              results.push({
                url: item.url,
                title: item.title,
                year: Number.isFinite(year) ? year : undefined,
                type: isSeries ? 'series' : 'movie',
              });
            }
          }
        }
      } catch {
        /* REST search failed */
      }

      // Fallback: standard HTML search ?s=
      if (results.length === 0) {
        try {
          const sRes = await this.http(
            `${BASE_URL}/?s=${encodeURIComponent(query)}`,
            this.policy.allowedHosts,
            {
              signal,
              timeoutMs: 8000,
              headers: { 'user-agent': USER_AGENT },
            },
          );
          if (sRes.status === 200) {
            const html = Buffer.from(sRes.body).toString('utf8');
            const linkRegex = /href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
            for (const m of html.matchAll(linkRegex)) {
              const url = m[1]!;
              const text = m[2]?.replace(/<[^>]+>/g, '').trim() ?? '';
              const isSeries = url.includes('/dizi/');
              const isMovie = url.includes('/film/');
              if (
                (isSeries || isMovie) &&
                !url.endsWith('/dizi/') &&
                !url.endsWith('/film/') &&
                !url.includes('/page/')
              ) {
                const fullUrl = url.startsWith('http')
                  ? url
                  : new URL(url, BASE_URL).href;
                const isNoise =
                  /^(?:film|dizi|izle|fragman|hd|1080p|son bolum)$/i.test(text);
                const yearMatch = fullUrl.match(
                  /-(19\d\d|20\d\d)(?:-izle|\/|$)/,
                );
                const year = yearMatch
                  ? parseInt(yearMatch[1]!, 10)
                  : undefined;

                const existing = results.find((r) => r.url === fullUrl);
                if (existing) {
                  if (
                    (isNoise || existing.title.length < text.length) &&
                    !isNoise &&
                    text.length > 2
                  ) {
                    existing.title = text;
                  }
                  if (!existing.year && year) {
                    existing.year = year;
                  }
                } else {
                  results.push({
                    url: fullUrl,
                    title: isNoise || !text ? query : text,
                    year,
                    type: isSeries ? 'series' : 'movie',
                  });
                }
              }
            }
          }
        } catch {
          /* Fallback search failed */
        }
      }

      return results;
    } catch {
      return [];
    }
  }

  async searchMovie(
    query: MovieQuery,
    context?: ProviderContext,
  ): Promise<MediaResult[]> {
    // 1. Try search by IMDb ID directly for 100% exact match
    if (query.imdbId) {
      const directUrl = await this.searchByImdbId(
        query.imdbId,
        'movie',
        context?.signal,
      );
      if (directUrl) {
        return [
          {
            providerId: this.id,
            title: query.title,
            year: query.year,
            mediaType: 'movie',
            pageUrl: directUrl,
            externalId: query.imdbId,
            confidence: 1,
          },
        ];
      }
    }

    // 2. Fallback to keyword search with cascade candidates
    const rawCandidates = [
      query.title,
      query.originalTitle,
      ...(query.alternativeTitles ?? []),
    ].filter((t): t is string => Boolean(t));

    const candidateSet = new Set<string>();
    for (const raw of rawCandidates) {
      for (const v of generateTitleVariants(raw)) {
        candidateSet.add(v);
        const norm = normalizeTitle(v);
        if (norm && norm !== v.toLowerCase()) {
          candidateSet.add(norm);
        }
      }
    }
    const candidates = [...candidateSet];

    let bestMovie: {
      item: { url: string; title: string; year?: number };
      score: number;
    } | null = null;

    for (const candidate of candidates) {
      const results = await this.searchOnSite(candidate, context?.signal);
      for (const r of results) {
        if (r.type !== 'movie') continue;
        const yearMatches =
          !query.year || !r.year || Math.abs(query.year - r.year) <= 1;
        if (!yearMatches) continue;

        let score = scoreTitleMatch(r.title, candidate);
        if (query.year && r.year && query.year === r.year) {
          score = Math.min(1, score + 0.1);
        }
        if (score >= 0.82 && (!bestMovie || score > bestMovie.score)) {
          bestMovie = { item: r, score };
        }
      }
      if (bestMovie && bestMovie.score >= 0.95) break;
    }

    if (bestMovie) {
      return [
        {
          providerId: this.id,
          title: query.title,
          year: bestMovie.item.year ?? query.year,
          mediaType: 'movie',
          pageUrl: bestMovie.item.url,
          externalId: query.imdbId,
          confidence: 1,
        },
      ];
    }

    return [];
  }

  async searchEpisode(
    query: EpisodeQuery,
    context?: ProviderContext,
  ): Promise<MediaResult[]> {
    let seriesUrl: string | null = null;

    // 1. Try search series by IMDb ID directly
    if (query.imdbId) {
      seriesUrl = await this.searchByImdbId(
        query.imdbId,
        'series',
        context?.signal,
      );
    }

    // 2. Fallback to keyword search with cascade candidates
    if (!seriesUrl) {
      const rawCandidates = [
        query.seriesTitle,
        query.originalTitle,
        ...(query.alternativeTitles ?? []),
      ].filter((t): t is string => Boolean(t));

      const candidateSet = new Set<string>();
      for (const raw of rawCandidates) {
        for (const v of generateTitleVariants(raw)) {
          candidateSet.add(v);
          const norm = normalizeTitle(v);
          if (norm && norm !== v.toLowerCase()) {
            candidateSet.add(norm);
          }
        }
      }
      const candidates = [...candidateSet];

      let bestSeries: { url: string; score: number } | null = null;

      for (const candidate of candidates) {
        const results = await this.searchOnSite(candidate, context?.signal);
        for (const r of results) {
          if (r.type !== 'series') continue;
          const score = scoreTitleMatch(r.title, candidate);
          if (score >= 0.82 && (!bestSeries || score > bestSeries.score)) {
            bestSeries = { url: r.url, score };
          }
        }
        if (bestSeries && bestSeries.score >= 0.95) {
          seriesUrl = bestSeries.url;
          break;
        }
      }

      if (!seriesUrl && bestSeries) {
        seriesUrl = bestSeries.url;
      }
    }

    if (!seriesUrl) return [];

    try {
      const sRes = await this.http(seriesUrl, this.policy.allowedHosts, {
        signal: context?.signal,
        timeoutMs: 8000,
        headers: { 'user-agent': USER_AGENT },
      });
      if (sRes.status !== 200) return [];
      const sHtml = Buffer.from(sRes.body).toString('utf8');

      const episodeUrl = extractEpisodeLink(
        sHtml,
        query.season,
        query.episode,
        seriesUrl,
      );
      if (!episodeUrl) return [];

      return [
        {
          providerId: this.id,
          title: query.seriesTitle,
          mediaType: 'series',
          pageUrl: episodeUrl,
          externalId: query.imdbId,
          season: query.season,
          episode: query.episode,
          confidence: 1,
        },
      ];
    } catch {
      return [];
    }
  }

  private async resolveOnePlayer(
    pageUrl: string,
    nonce: string,
    postId: string,
    playerName: string,
    partKey: string,
    language: 'tr-dub' | 'tr-sub',
    sourceLabel: string,
    signal?: AbortSignal,
  ): Promise<ResolvedStream | null> {
    try {
      const ajaxBody = new URLSearchParams({
        action: 'get_video_url',
        nonce,
        post_id: postId,
        player_name: playerName,
        part_key: partKey,
      }).toString();

      const ajaxRes = await fetch(`${BASE_URL}/wp-admin/admin-ajax.php`, {
        signal,
        method: 'POST',
        headers: {
          'user-agent': USER_AGENT,
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          referer: pageUrl,
          'x-requested-with': 'XMLHttpRequest',
        },
        body: ajaxBody,
      });
      if (ajaxRes.status !== 200) return null;
      const ajaxJson = (await ajaxRes.json()) as {
        success?: boolean;
        data?: { url?: string };
      };
      const setPlayUrl = ajaxJson?.data?.url;
      if (!setPlayUrl) return null;

      const setPlayRes = await this.http(setPlayUrl, this.policy.allowedHosts, {
        signal,
        timeoutMs: 8000,
        headers: {
          'user-agent': USER_AGENT,
          referer: pageUrl,
        },
      });
      if (setPlayRes.status !== 200) return null;
      const setPlayHtml = Buffer.from(setPlayRes.body).toString('utf8');

      const cerceveMatch = setPlayHtml.match(
        /SPG\.cerceve\s*\(\s*["'][^"']+["']\s*,\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']/,
      );
      if (!cerceveMatch) return null;
      const fastPlayUrl = xorB64(cerceveMatch[1]!, cerceveMatch[2]!);

      const fpRes = await this.http(fastPlayUrl, this.policy.allowedHosts, {
        signal,
        timeoutMs: 8000,
        headers: {
          'user-agent': USER_AGENT,
          referer: setPlayUrl,
        },
      });
      if (fpRes.status !== 200) return null;
      const fpHtml = Buffer.from(fpRes.body).toString('utf8');

      const spgMatch = fpHtml.match(/window\.SPG_A\s*=\s*({[^}]+})/);
      let rawSp = '';
      if (spgMatch) {
        try {
          const spg = JSON.parse(spgMatch[1]!) as { sp?: string };
          if (spg.sp) {
            rawSp = spg.sp;
          }
        } catch {
          /* ignore */
        }
      }

      const streamMatch = fpHtml.match(/stream:\s*["']([^"']+)["']/);
      if (!streamMatch) return null;
      const manifestUrl = `https://fastplay.mom${streamMatch[1]}`;

      return {
        providerId: this.id,
        url: manifestUrl,
        quality: '1080p',
        qualityEvidence: 'metadata',
        language,
        format: 'HLS',
        subtitles: [],
        sourceLabel,
        headers: {
          referer: fastPlayUrl,
          'user-agent': USER_AGENT,
          ...(rawSp
            ? { 'x-sp-key': rawSp, 'x-sp': generateXSp(rawSp) }
            : {}),
        },
      };
    } catch {
      return null;
    }
  }

  async resolveStreams(
    media: MediaResult,
    context?: ProviderContext,
  ): Promise<ResolvedStream[]> {
    try {
      // 1. Fetch movie or episode page
      const pageRes = await this.http(media.pageUrl, this.policy.allowedHosts, {
        signal: context?.signal,
        timeoutMs: 8000,
        headers: {
          'user-agent': USER_AGENT,
          referer: `${BASE_URL}/`,
        },
      });
      if (pageRes.status !== 200) return [];
      const pageHtml = Buffer.from(pageRes.body).toString('utf8');

      // 2. Extract nonce and player options
      const nonceMatch = pageHtml.match(/nonce:\s*['"]([a-zA-Z0-9]+)['"]/);
      if (!nonceMatch) return [];
      const nonce = nonceMatch[1]!;

      const postId = pageHtml.match(/data-post-id=["']([^"']+)["']/)?.[1];
      const playerName =
        pageHtml.match(/data-player-name=["']([^"']+)["']/)?.[1] ??
        pageHtml.match(/data-player=["']([^"']+)["']/)?.[1];
      if (!postId || !playerName) return [];

      // Find all part keys
      const partKeyMatches = [
        ...pageHtml.matchAll(/data-part-key=["']([^"']*)["']/g),
      ].map((m) => m[1]!);
      const uniquePartKeys = [...new Set(partKeyMatches)];
      const dubKey = uniquePartKeys.find((k) => k.includes('dublaj'));
      const subKey = uniquePartKeys.find((k) => k.includes('altyazi'));

      if (dubKey && subKey) {
        const [dubStream, subStream] = await Promise.all([
          this.resolveOnePlayer(
            media.pageUrl,
            nonce,
            postId,
            playerName,
            dubKey,
            'tr-dub',
            'HDFilmCehennemi · 1080p Türkçe Dublaj',
            context?.signal,
          ),
          this.resolveOnePlayer(
            media.pageUrl,
            nonce,
            postId,
            playerName,
            subKey,
            'tr-sub',
            'HDFilmCehennemi · 1080p Türkçe Altyazı',
            context?.signal,
          ),
        ]);
        return [dubStream, subStream].filter((s): s is ResolvedStream =>
          Boolean(s),
        );
      }

      // Single player (dual-audio FastPlay stream)
      const singleKey = uniquePartKeys[0] ?? '';
      const baseStream = await this.resolveOnePlayer(
        media.pageUrl,
        nonce,
        postId,
        playerName,
        singleKey,
        'tr-dub',
        'HDFilmCehennemi · 1080p Türkçe Dublaj',
        context?.signal,
      );
      if (!baseStream) return [];

      const subVariant: ResolvedStream = {
        ...baseStream,
        language: 'tr-sub',
        sourceLabel: 'HDFilmCehennemi · 1080p Türkçe Altyazı',
      };

      return [baseStream, subVariant];
    } catch {
      return [];
    }
  }

  async healthCheck(context?: ProviderContext): Promise<ProviderHealth> {
    const start = performance.now();
    try {
      const res = await this.http(
        `${BASE_URL}/wp-json/stmovie/search/?keyword=test`,
        this.policy.allowedHosts,
        {
          signal: context?.signal,
          timeoutMs: 5000,
          headers: {
            'user-agent': USER_AGENT,
            accept: 'application/json',
          },
        },
      );
      return {
        status: res.status === 200 ? 'healthy' : 'degraded',
        latencyMs: Math.round(performance.now() - start),
        lastChecked: new Date().toISOString(),
      };
    } catch (e) {
      return {
        status: 'degraded',
        latencyMs: Math.round(performance.now() - start),
        lastChecked: new Date().toISOString(),
        error: e instanceof Error ? e.message : 'HDFilmCehennemi unreachable',
      };
    }
  }
}
