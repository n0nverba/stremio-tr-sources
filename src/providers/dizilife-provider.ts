import { PublicCatalog, type CatalogQuery } from './catalog.js';
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
  generateTitleVariants,
  normalizeTitle,
  scoreTitleMatch,
} from '../utils/normalize-title.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const BASE_URL = 'https://dizi77.life';

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

function revB64(s: string): string {
  return Buffer.from(s.split('').reverse().join(''), 'base64').toString('utf8');
}

export class DiziLifeProvider implements MediaProvider {
  readonly id = 'dizilife';
  readonly name = 'DiziLife';
  enabled = true;
  readonly policy: ProviderPolicy = {
    allowedHosts: [
      'dizi77.life',
      'dizi76.life',
      '*.life',
      'dcdlc9f2bddfff97.xyz',
      '*.makesomthingup.click',
      '*.xyz',
      '127.0.0.1',
      'localhost',
      '*',
    ],
    authorization: {
      kind: 'explicit-permission',
      evidenceUrl: 'https://dizi77.life/',
      attribution: 'DiziLife · Film & Dizi (Çift Ses & Altyazı)',
    },
    timeoutMs: 10000,
    minRequestIntervalMs: 150,
  };

  private readonly cache = new Map<string, string>(); // query -> seriesUrl/movieUrl

  private readonly publicCatalog: PublicCatalog;
  constructor(private readonly http: HttpTransport = safeHttp) {
    this.publicCatalog = new PublicCatalog(BASE_URL, http, (query) =>
      query.search
        ? BASE_URL + '/ara?q=' + encodeURIComponent(query.search)
        : BASE_URL + (query.type === 'movie' ? '/filmler' : '/diziler'),
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

  async searchMovie(
    query: MovieQuery,
    context?: ProviderContext,
  ): Promise<MediaResult[]> {
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

    const cachedUrl = this.cache.get(`movie:${query.imdbId}`);
    if (cachedUrl) {
      return [
        {
          providerId: this.id,
          title: query.title,
          mediaType: 'movie',
          pageUrl: cachedUrl,
          externalId: query.imdbId,
          year: query.year,
          confidence: 1,
        },
      ];
    }

    let bestMovie: {
      url: string;
      title: string;
      year?: number;
      score: number;
    } | null = null;

    for (const term of candidates) {
      try {
        const searchUrl = `${BASE_URL}/ara?q=${encodeURIComponent(term)}`;
        const res = await this.http(searchUrl, this.policy.allowedHosts, {
          signal: context?.signal,
          timeoutMs: 8000,
          headers: { 'user-agent': USER_AGENT },
        });

        if (res.status === 200) {
          const html = Buffer.from(res.body).toString('utf8');
          const linkBlocks = [
            ...html.matchAll(
              /<a\s+[^>]*href=["']((?:https?:\/\/[^"'\s/]+)?\/film\/[a-z0-9-]+)["'][^>]*>([\s\S]*?)<\/a>/gi,
            ),
          ];

          for (const block of linkBlocks) {
            const rawLink = block[1]!;
            const inner = block[2] ?? '';
            const fullUrl = rawLink.startsWith('http')
              ? rawLink
              : new URL(rawLink, BASE_URL).href;

            const altMatch = inner.match(/alt=["']([^"']+)["']/i);
            const titleMatch = inner.match(
              /<div[^>]*font-semibold[^>]*>([^<]+)<\/div>/i,
            );
            const yearMatch = inner.match(/<span>(\d{4})<\/span>/i);

            const cardTitle = altMatch
              ? altMatch[1]!
              : titleMatch
                ? titleMatch[1]!.trim()
                : '';
            const cardYear = yearMatch
              ? parseInt(yearMatch[1]!, 10)
              : undefined;
            const slug = fullUrl.split('/film/')[1]?.replace(/-/g, ' ') ?? '';

            // Strict year filtering: reject if difference is > 1 year
            if (query.year && cardYear) {
              if (Math.abs(query.year - cardYear) > 1) {
                continue;
              }
            }

            const termsToTest = [cardTitle, slug].filter(Boolean);
            let itemScore = 0;
            for (const itemTerm of termsToTest) {
              for (const c of candidates) {
                const s = scoreTitleMatch(itemTerm, c);
                if (s > itemScore) itemScore = s;
              }
            }

            if (query.year && cardYear && query.year === cardYear) {
              itemScore = Math.min(1, itemScore + 0.15);
            }

            if (
              itemScore >= 0.82 &&
              (!bestMovie || itemScore > bestMovie.score)
            ) {
              bestMovie = {
                url: fullUrl,
                title: cardTitle || slug,
                year: cardYear,
                score: itemScore,
              };
            }
          }

          if (bestMovie && bestMovie.score >= 0.95) break;
        }
      } catch {
        /* search failed */
      }
      if (bestMovie && bestMovie.score >= 0.95) break;
    }

    if (bestMovie) {
      this.cache.set(`movie:${query.imdbId}`, bestMovie.url);
      return [
        {
          providerId: this.id,
          title: query.title,
          mediaType: 'movie',
          pageUrl: bestMovie.url,
          externalId: query.imdbId,
          year: bestMovie.year ?? query.year,
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

    let seriesUrl = this.cache.get(candidates[0]!);

    if (!seriesUrl) {
      for (const term of candidates) {
        try {
          const searchUrl = `${BASE_URL}/ara?q=${encodeURIComponent(term)}`;
          const res = await this.http(searchUrl, this.policy.allowedHosts, {
            signal: context?.signal,
            timeoutMs: 8000,
            headers: { 'user-agent': USER_AGENT },
          });

          if (res.status === 200) {
            const html = Buffer.from(res.body).toString('utf8');
            const linkRegex =
              /href=["']((?:https?:\/\/[^"'\s/]+)?\/dizi\/[a-z0-9-]+)["']/gi;
            const rawLinks = [
              ...new Set([...html.matchAll(linkRegex)].map((m) => m[1]!)),
            ];
            const links = rawLinks.map((l) =>
              l.startsWith('http') ? l : new URL(l, BASE_URL).href,
            );

            let bestLink: { url: string; score: number } | null = null;
            for (const link of links) {
              const slug = link.split('/dizi/')[1]?.replace(/-/g, ' ') ?? '';
              for (const c of candidates) {
                const score = scoreTitleMatch(slug, c);
                if (score >= 0.82 && (!bestLink || score > bestLink.score)) {
                  bestLink = { url: link, score };
                }
              }
              if (bestLink && bestLink.score >= 0.95) break;
            }

            if (bestLink) {
              seriesUrl = bestLink.url;
              this.cache.set(candidates[0]!, seriesUrl);
            }
          }
        } catch {
          /* search failed */
        }
        if (seriesUrl) break;
      }
    }

    if (!seriesUrl) return [];

    const epUrl = `${seriesUrl}/sezon/${query.season}/bolum/${query.episode}`;
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
      // 1. Fetch episode page
      const epRes = await this.http(media.pageUrl, this.policy.allowedHosts, {
        signal: context?.signal,
        timeoutMs: 8000,
        headers: { 'user-agent': USER_AGENT },
      });
      if (epRes.status !== 200) return [];
      const epHtml = Buffer.from(epRes.body).toString('utf8');

      // 2. Find player iframe
      const iframeMatch = epHtml.match(
        /<iframe[^>]+src=["']((?:https?:)?\/\/[^"']+)["']/i,
      );
      if (!iframeMatch) return [];
      let iframeUrl = iframeMatch[1]!;
      if (iframeUrl.startsWith('//')) iframeUrl = 'https:' + iframeUrl;

      // 3. Fetch player page
      const playerRes = await this.http(iframeUrl, this.policy.allowedHosts, {
        signal: context?.signal,
        timeoutMs: 8000,
        headers: {
          'user-agent': USER_AGENT,
          referer: media.pageUrl,
        },
      });
      if (playerRes.status !== 200) return [];
      const playerHtml = Buffer.from(playerRes.body).toString('utf8');

      // 4. Decrypt player config (dynamically extract obfuscated function name)
      const fnMatch = playerHtml.match(
        /var\s+([a-zA-Z0-9_$]+)\s*=\s*function\(s\)\{return atob/,
      );
      if (!fnMatch) return [];
      const fnName = fnMatch[1]!;
      const re = new RegExp(`${fnName}\\("([^"]+)"\\)`, 'g');
      const sMatches = [...playerHtml.matchAll(re)].map((m) => m[1]!);
      if (sMatches.length < 2) return [];

      const cipherRevB64 = sMatches[0]!;
      const passRevB64 = sMatches[1]!;

      const ciphertextB64 = revB64(cipherRevB64);
      const passphrase = revB64(passRevB64);

      const data = Buffer.from(ciphertextB64, 'base64');
      const salt = data.subarray(8, 16);
      const ciphertext = data.subarray(16);

      const { key, iv } = evpBytesToKey(Buffer.from(passphrase, 'utf8'), salt);
      const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
      let decrypted = decipher.update(ciphertext);
      decrypted = Buffer.concat([decrypted, decipher.final()]);
      const decryptedText = decrypted.toString('utf8');

      // Extract master.m3u8 URL and strip obfuscation parameter
      const fileMatch = decryptedText.match(/file:\s*["']([^"']+)["']/);
      if (!fileMatch) return [];

      let masterUrl = fileMatch[1]!;
      // Obfuscated string param removal: e.g. ?aztsdxdevfqwea
      masterUrl = masterUrl.replace(/\?.*$/, '');

      return [
        {
          providerId: this.id,
          url: masterUrl,
          quality: '1080p',
          qualityEvidence: 'metadata',
          language: 'tr-dub',
          format: 'HLS',
          subtitles: [],
          sourceLabel: 'DiziLife · 1080p Türkçe Dublaj',
          headers: {
            referer: iframeUrl,
            'user-agent': USER_AGENT,
          },
        },
        {
          providerId: this.id,
          url: masterUrl,
          quality: '1080p',
          qualityEvidence: 'metadata',
          language: 'tr-sub',
          format: 'HLS',
          subtitles: [],
          sourceLabel: 'DiziLife · 1080p Türkçe Altyazı',
          headers: {
            referer: iframeUrl,
            'user-agent': USER_AGENT,
          },
        },
      ];
    } catch {
      return [];
    }
  }

  async healthCheck(context?: ProviderContext): Promise<ProviderHealth> {
    const start = performance.now();
    try {
      const res = await this.http(`${BASE_URL}/`, this.policy.allowedHosts, {
        signal: context?.signal,
        method: 'GET',
        timeoutMs: 5000,
        maxBytes: 1024,
        truncate: true,
        headers: {
          'user-agent': USER_AGENT,
        },
      });
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
        error: e instanceof Error ? e.message : 'DiziLife unreachable',
      };
    }
  }
}
