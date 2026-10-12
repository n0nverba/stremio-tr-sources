import {
  PublicCatalog,
  sliceCatalog,
  type CatalogQuery,
  type CatalogEntry as PublicCatalogEntry,
} from './catalog.js';
import { readFile } from 'node:fs/promises';
import crypto from 'node:crypto';
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
  cleanMediaTitle,
  normalizeTitle,
  scoreTitleMatch,
  similarity,
} from '../utils/normalize-title.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const BASE_URL = 'https://ddizibox.com';

function evpBytesToKey(
  password: Buffer,
  salt: Buffer,
  keyLen = 32,
  ivLen = 16,
) {
  let d = Buffer.alloc(0);
  let total = Buffer.alloc(0);
  while (total.length < keyLen + ivLen) {
    const hash = crypto.createHash('md5');
    if (d.length > 0) hash.update(d);
    hash.update(password);
    hash.update(salt);
    d = hash.digest();
    total = Buffer.concat([total, d]);
  }
  return {
    key: total.subarray(0, keyLen),
    iv: total.subarray(keyLen, keyLen + ivLen),
  };
}

function decryptAes(ciphertextB64: string, passphrase: string): string | null {
  try {
    const data = Buffer.from(ciphertextB64, 'base64');
    if (data.subarray(0, 8).toString('utf8') !== 'Salted__') return null;
    const salt = data.subarray(8, 16);
    const ciphertext = data.subarray(16);
    const { key, iv } = evpBytesToKey(Buffer.from(passphrase, 'utf8'), salt);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

interface CatalogEntry {
  title: string;
  pageUrl: string;
  mediaType: string;
}

export class DiziboxProvider implements MediaProvider {
  readonly id = 'dizibox';
  readonly name = 'DiziBOX';
  enabled = true;
  readonly policy: ProviderPolicy = {
    allowedHosts: [
      'ddizibox.com',
      'www.ddizibox.com',
      '*.ddizibox.com',
      'www.dizibox.live',
      'dizibox.live',
      'pilavyerplay.top',
      'play2.pilavyerplay.top',
      '*.pilavyerplay.top',
      '*.molystream.org',
      '*.molystream.net',
      '*.top',
      '*.xyz',
      '*.site',
      '127.0.0.1',
      'localhost',
      '*',
    ],
    authorization: {
      kind: 'explicit-permission',
      evidenceUrl: 'https://ddizibox.com/',
      attribution: 'DiziBOX · Türkçe Altyazı & Dublaj (ddizibox.com)',
    },
    timeoutMs: 12000,
    minRequestIntervalMs: 50,
  };

  private catalogItems: CatalogEntry[] | null = null;
  private readonly searchCache = new Map<string, string>(); // query -> pageUrl
  private readonly episodeCache = new Map<string, string>(); // seriesUrl:s:e -> epUrl

  private readonly publicCatalog: PublicCatalog;
  constructor(private readonly http: HttpTransport = safeHttp) {
    this.publicCatalog = new PublicCatalog(
      BASE_URL,
      http,
      (query) =>
        query.search
          ? `${BASE_URL}/ara?q=${encodeURIComponent(query.search)}`
          : query.type === 'movie'
            ? `${BASE_URL}/filmler/`
            : `${BASE_URL}/diziler/`,
    );
  }

  async listCatalog(query: CatalogQuery, context?: ProviderContext) {
    if (query.type !== 'series') return [];
    const local = await this.loadCatalog();
    if (local.length)
      return sliceCatalog(
        local.map((i) => ({ ...i, mediaType: 'series' as const })),
        query,
      );
    return this.publicCatalog.list(query, context);
  }

  async catalogDetail(
    pageUrl: string,
    type: 'movie' | 'series',
    context?: ProviderContext,
  ): Promise<PublicCatalogEntry | null> {
    return this.publicCatalog.detail(pageUrl, type, context);
  }

  clearCache() {
    this.publicCatalog.clear();
    this.catalogItems = null;
    this.searchCache.clear();
    this.episodeCache.clear();
  }

  private async loadCatalog(): Promise<CatalogEntry[]> {
    if (this.catalogItems) return this.catalogItems;
    try {
      const raw = await readFile('reports/dizibox-catalog.json', 'utf8');
      const parsed = JSON.parse(raw) as { items?: CatalogEntry[] };
      this.catalogItems = parsed.items ?? [];
    } catch {
      this.catalogItems = [];
    }
    return this.catalogItems;
  }

  private async findSeriesPage(
    title: string,
    originalTitle?: string,
    alternatives: string[] = [],
    signal?: AbortSignal,
  ): Promise<string | null> {
    const candidates = [title, originalTitle, ...alternatives]
      .filter((t): t is string => Boolean(t))
      .map(normalizeTitle);

    const cacheKey = 's:' + candidates.join('|');
    if (this.searchCache.has(cacheKey)) {
      return this.searchCache.get(cacheKey)!;
    }

    // 1. Check local catalog
    const catalog = await this.loadCatalog();
    for (const c of candidates) {
      const exact = catalog.find((i) => normalizeTitle(i.title) === c);
      if (exact) {
        this.searchCache.set(cacheKey, exact.pageUrl);
        return exact.pageUrl;
      }
    }
    for (const c of candidates) {
      const cleanC = cleanMediaTitle(c);
      if (cleanC.length >= 3) {
        const exactClean = catalog.find(
          (i) => cleanMediaTitle(i.title) === cleanC,
        );
        if (exactClean) {
          this.searchCache.set(cacheKey, exactClean.pageUrl);
          return exactClean.pageUrl;
        }
      }
    }
    let bestMatch: { url: string; score: number } | null = null;
    for (const c of candidates) {
      for (const item of catalog) {
        const score = similarity(c, normalizeTitle(item.title));
        if (score >= 0.82 && (!bestMatch || score > bestMatch.score)) {
          bestMatch = { url: item.pageUrl, score };
        }
      }
    }
    if (bestMatch) {
      this.searchCache.set(cacheKey, bestMatch.url);
      return bestMatch.url;
    }

    // 2. Fallback to live search across all candidate terms
    const liveTerms = [title, originalTitle, ...alternatives].filter(
      (t): t is string => Boolean(t),
    );
    for (const term of liveTerms) {
      try {
        const searchUrls = [
          `${BASE_URL}/ara?q=${encodeURIComponent(term)}`,
          `https://www.dizibox.live/?s=${encodeURIComponent(term)}`,
        ];

        for (const searchUrl of searchUrls) {
          const res = await this.http(searchUrl, this.policy.allowedHosts, {
            signal,
            timeoutMs: 8000,
            headers: { 'user-agent': USER_AGENT },
          });
          if (res.status === 200) {
            const html = Buffer.from(res.body).toString('utf8');
            // Check ddizibox cards
            const cardRegex =
              /<a[^>]+href=["']((?:https:\/\/ddizibox\.com)?\/dizi\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
            let bestLive: { url: string; score: number } | null = null;

            for (const m of html.matchAll(cardRegex)) {
              let linkUrl = m[1]!;
              if (!linkUrl.startsWith('http')) linkUrl = `${BASE_URL}${linkUrl}`;
              if (linkUrl.includes('/sezon-') || linkUrl.includes('?sezon='))
                continue;
              const linkText =
                m[2]?.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1]?.trim() ||
                m[2]?.replace(/<[^>]+>/g, '').trim() ||
                '';
              for (const c of candidates) {
                const score = scoreTitleMatch(linkText, c);
                if (score >= 0.82 && (!bestLive || score > bestLive.score)) {
                  bestLive = { url: linkUrl, score };
                }
              }
            }

            // Also check old dizibox.live link pattern
            if (!bestLive) {
              const legacyRegex =
                /<a[^>]+href=["'](https:\/\/www\.dizibox\.live\/diziler\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
              for (const m of html.matchAll(legacyRegex)) {
                const linkUrl = m[1]!;
                const linkText = m[2]?.replace(/<[^>]+>/g, '').trim() || '';
                for (const c of candidates) {
                  const score = scoreTitleMatch(linkText, c);
                  if (score >= 0.82 && (!bestLive || score > bestLive.score)) {
                    bestLive = { url: linkUrl, score };
                  }
                }
              }
            }

            if (bestLive) {
              this.searchCache.set(cacheKey, bestLive.url);
              return bestLive.url;
            }
          }
        }
      } catch {
        /* search failed */
      }
    }

    return null;
  }

  private async findEpisodeUrl(
    seriesUrl: string,
    season: number,
    episode: number,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const key = `${seriesUrl}:${season}:${episode}`;
    if (this.episodeCache.has(key)) return this.episodeCache.get(key)!;

    const res = await this.http(seriesUrl, this.policy.allowedHosts, {
      signal,
      timeoutMs: 8000,
      headers: { 'user-agent': USER_AGENT },
    });
    if (res.status !== 200) return null;

    const html = Buffer.from(res.body).toString('utf8');

    // 1. ddizibox new pattern: /dizi/[slug]/sezon-[s]/bolum-[e]
    const newEpRegex =
      /href=["']((?:https:\/\/ddizibox\.com)?\/dizi\/[a-z0-9-]+?\/sezon-(\d+)\/bolum-(\d+)[^"']*)["']/gi;
    for (const m of html.matchAll(newEpRegex)) {
      const s = parseInt(m[2]!, 10);
      const e = parseInt(m[3]!, 10);
      if (s === season && e === episode) {
        const fullUrl = m[1]!.startsWith('http')
          ? m[1]!
          : `${BASE_URL}${m[1]!}`;
        this.episodeCache.set(key, fullUrl);
        return fullUrl;
      }
    }

    // 2. Legacy dizibox pattern: [slug]-[s]-sezon-[e]-bolum-izle
    const legacyEpRegex =
      /href=["']((?:https:\/\/www\.dizibox\.live)?\/([a-z0-9-]+?)-(\d+)-sezon-(\d+)-bolum(?:-[^"'\s/]+)?-izle\/?)["']/gi;
    for (const m of html.matchAll(legacyEpRegex)) {
      const s = parseInt(m[3]!, 10);
      const e = parseInt(m[4]!, 10);
      if (s === season && e === episode) {
        const fullUrl = m[1]!.startsWith('http')
          ? m[1]!
          : `https://www.dizibox.live${m[1]!}`;
        this.episodeCache.set(key, fullUrl);
        return fullUrl;
      }
    }

    // 3. Fallback deterministic probe for ddizibox
    if (seriesUrl.includes('ddizibox.com/dizi/')) {
      const cleanSeriesUrl = seriesUrl.replace(/\/+$/, '');
      const probeUrl = `${cleanSeriesUrl}/sezon-${season}/bolum-${episode}`;
      this.episodeCache.set(key, probeUrl);
      return probeUrl;
    }

    return null;
  }

  async searchMovie(
    query: MovieQuery,
    context?: ProviderContext,
  ): Promise<MediaResult[]> {
    const candidates = [
      query.title,
      query.originalTitle,
      ...(query.alternativeTitles ?? []),
    ]
      .filter((t): t is string => Boolean(t))
      .map(normalizeTitle);

    const cacheKey = 'm:' + candidates.join('|');
    if (this.searchCache.has(cacheKey)) {
      return [
        {
          providerId: this.id,
          title: query.title,
          mediaType: 'movie',
          pageUrl: this.searchCache.get(cacheKey)!,
          externalId: query.imdbId,
          confidence: 1,
        },
      ];
    }

    const liveTerms = [
      query.title,
      query.originalTitle,
      ...(query.alternativeTitles ?? []),
    ].filter((t): t is string => Boolean(t));

    for (const term of liveTerms) {
      try {
        const searchUrl = `${BASE_URL}/ara?q=${encodeURIComponent(term)}`;
        const res = await this.http(searchUrl, this.policy.allowedHosts, {
          signal: context?.signal,
          timeoutMs: 8000,
          headers: { 'user-agent': USER_AGENT },
        });
        if (res.status === 200) {
          const html = Buffer.from(res.body).toString('utf8');
          const cardRegex =
            /<a[^>]+href=["']((?:https:\/\/ddizibox\.com)?\/film\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
          let bestLive: { url: string; score: number } | null = null;

          for (const m of html.matchAll(cardRegex)) {
            let linkUrl = m[1]!;
            if (!linkUrl.startsWith('http')) linkUrl = `${BASE_URL}${linkUrl}`;
            const linkText =
              m[2]?.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1]?.trim() ||
              m[2]?.replace(/<[^>]+>/g, '').trim() ||
              '';
            for (const c of candidates) {
              const score = scoreTitleMatch(linkText, c);
              if (score >= 0.82 && (!bestLive || score > bestLive.score)) {
                bestLive = { url: linkUrl, score };
              }
            }
          }

          if (bestLive) {
            this.searchCache.set(cacheKey, bestLive.url);
            return [
              {
                providerId: this.id,
                title: query.title,
                mediaType: 'movie',
                pageUrl: bestLive.url,
                externalId: query.imdbId,
                confidence: bestLive.score,
              },
            ];
          }
        }
      } catch {
        /* search failed */
      }
    }

    return [];
  }

  async searchEpisode(
    query: EpisodeQuery,
    context?: ProviderContext,
  ): Promise<MediaResult[]> {
    const seriesUrl = await this.findSeriesPage(
      query.seriesTitle,
      query.originalTitle,
      query.alternativeTitles,
      context?.signal,
    );
    if (!seriesUrl) return [];

    const epUrl = await this.findEpisodeUrl(
      seriesUrl,
      query.season,
      query.episode,
      context?.signal,
    );
    if (!epUrl) return [];

    return [
      {
        providerId: this.id,
        title: query.seriesTitle,
        mediaType: 'series',
        pageUrl: epUrl,
        externalId: query.imdbId,
        season: query.season,
        episode: query.episode,
        confidence: 1,
      },
    ];
  }

  async resolveStreams(
    media: MediaResult,
    context?: ProviderContext,
  ): Promise<ResolvedStream[]> {
    try {
      // 1. Fetch content page
      const pageRes = await this.http(media.pageUrl, this.policy.allowedHosts, {
        signal: context?.signal,
        timeoutMs: 8000,
        headers: { 'user-agent': USER_AGENT, referer: `${BASE_URL}/` },
      });
      if (pageRes.status !== 200) return [];
      const pageHtml = Buffer.from(pageRes.body).toString('utf8');

      // 2. Check Pilavyer Player (modern ddizibox.com)
      const pvMatch = pageHtml.match(/data-pv=["']([a-zA-Z0-9_-]+)["']/i);
      const coreScriptMatch = pageHtml.match(
        /src=["'](https:\/\/[^"']*pilavyerplay[^"']*\/assets\/js\/(?:core|c)\.js)["']/i,
      );

      if (pvMatch && coreScriptMatch) {
        const pvSlug = pvMatch[1]!;
        const scriptUrl = coreScriptMatch[1]!;
        const playerBase = scriptUrl.replace(
          /\/(?:e\/c|assets\/js\/core)\.js.*$/,
          '',
        );
        const sUrl = `${playerBase}/assets/js/s.php?s=${encodeURIComponent(pvSlug)}`;

        const sRes = await this.http(sUrl, this.policy.allowedHosts, {
          signal: context?.signal,
          timeoutMs: 8000,
          headers: {
            'user-agent': USER_AGENT,
            referer: media.pageUrl,
            origin: new URL(media.pageUrl).origin,
          },
        });

        if (sRes.status === 200) {
          const sHtml = Buffer.from(sRes.body).toString('utf8');
          const pMatch = sHtml.match(/window\.__PLAYER__\s*=\s*(\{[\s\S]*?\});/);
          if (pMatch) {
            const config = JSON.parse(pMatch[1]!) as {
              stream?: string;
              subs?: { lang?: string; label?: string; src?: string }[];
              audios?: { name?: string; label?: string; lang?: string }[];
            };

            if (config.stream) {
              const subtitles = (config.subs ?? [])
                .filter((s) => Boolean(s.src))
                .map((s, idx) => ({
                  id: s.lang || `sub-${idx}`,
                  lang: s.lang === 'tr' ? 'tur' : s.lang || 'tur',
                  url: s.src!,
                }));

              const audios = config.audios ?? [];
              const hasTrAudio = audios.some((a) =>
                /türkçe|tr|dublaj/i.test(a.label ?? a.lang ?? ''),
              );
              const hasOrigAudio = audios.some((a) =>
                /orijinal|orig|en|english/i.test(a.label ?? a.lang ?? ''),
              );
              const hasTrSub = (config.subs ?? []).some((s) =>
                /tr|türkçe|turkish/i.test(s.lang ?? s.label ?? ''),
              );

              const streams: ResolvedStream[] = [];
              const streamHeaders = {
                referer: sUrl,
                origin: playerBase,
                'user-agent': USER_AGENT,
              };

              if (hasTrAudio && hasOrigAudio) {
                streams.push({
                  providerId: this.id,
                  url: config.stream,
                  quality: '1080p',
                  qualityEvidence: 'metadata',
                  language: 'tr-dub',
                  format: 'HLS',
                  subtitles,
                  sourceLabel: 'DiziBOX · 1080p Türkçe Dublaj',
                  headers: streamHeaders,
                });
                streams.push({
                  providerId: this.id,
                  url: config.stream,
                  quality: '1080p',
                  qualityEvidence: 'metadata',
                  language: 'tr-sub',
                  format: 'HLS',
                  subtitles,
                  sourceLabel: 'DiziBOX · 1080p Türkçe Altyazı',
                  headers: streamHeaders,
                });
              } else if (hasTrSub) {
                streams.push({
                  providerId: this.id,
                  url: config.stream,
                  quality: '1080p',
                  qualityEvidence: 'metadata',
                  language: 'tr-sub',
                  format: 'HLS',
                  subtitles,
                  sourceLabel: 'DiziBOX · 1080p Türkçe Altyazı',
                  headers: streamHeaders,
                });
              } else {
                streams.push({
                  providerId: this.id,
                  url: config.stream,
                  quality: '1080p',
                  qualityEvidence: 'metadata',
                  language: 'tr-dub',
                  format: 'HLS',
                  subtitles,
                  sourceLabel: 'DiziBOX · 1080p HD',
                  headers: streamHeaders,
                });
              }

              if (streams.length) return streams;
            }
          }
        }
      }

      // 3. Fallback to legacy molystream player
      const playerIframe = pageHtml.match(
        /<iframe[^>]+src=["'](https:\/\/(?:www\.)?dizibox\.(?:live|com)\/player\/[^"']+)["']/i,
      );
      if (playerIframe) {
        const playerUrl = playerIframe[1]!;
        const playerRes = await this.http(playerUrl, this.policy.allowedHosts, {
          signal: context?.signal,
          timeoutMs: 8000,
          headers: {
            'user-agent': USER_AGENT,
            referer: media.pageUrl,
          },
        });
        if (playerRes.status === 200) {
          const playerHtml = Buffer.from(playerRes.body).toString('utf8');
          const embedIframe = playerHtml.match(
            /<iframe[^>]+src=["'](https:\/\/[^"']*molystream[^"']*)["']/i,
          );
          if (embedIframe) {
            const embedUrl = embedIframe[1]!;
            const embedRes = await this.http(embedUrl, this.policy.allowedHosts, {
              signal: context?.signal,
              timeoutMs: 8000,
              headers: {
                'user-agent': USER_AGENT,
                referer: playerUrl,
              },
            });
            if (embedRes.status === 200) {
              const embedHtml = Buffer.from(embedRes.body).toString('utf8');
              const decryptMatch = embedHtml.match(
                /CryptoJS\.AES\.decrypt\s*\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/,
              );
              if (decryptMatch) {
                const decrypted = decryptAes(decryptMatch[1]!, decryptMatch[2]!);
                if (decrypted) {
                  const fileMatch = decrypted.match(
                    /file:\s*["'](https:\/\/[^"']+)["']/,
                  );
                  if (fileMatch) {
                    return [
                      {
                        providerId: this.id,
                        url: fileMatch[1]!,
                        quality: '1080p',
                        qualityEvidence: 'metadata',
                        language: 'tr-sub',
                        format: 'HLS',
                        subtitles: [],
                        sourceLabel: 'DiziBOX · 1080p Türkçe Altyazı',
                        headers: {
                          referer: embedUrl,
                          'user-agent': USER_AGENT,
                        },
                      },
                    ];
                  }
                }
              }
            }
          }
        }
      }

      return [];
    } catch {
      return [];
    }
  }

  async healthCheck(context?: ProviderContext): Promise<ProviderHealth> {
    const start = performance.now();
    try {
      const res = await this.http(
        `${BASE_URL}/`,
        this.policy.allowedHosts,
        {
          signal: context?.signal,
          method: 'GET',
          timeoutMs: 5000,
          maxBytes: 1024,
          truncate: true,
          headers: {
            'user-agent': USER_AGENT,
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
        error: e instanceof Error ? e.message : 'DiziBOX unreachable',
      };
    }
  }
}
