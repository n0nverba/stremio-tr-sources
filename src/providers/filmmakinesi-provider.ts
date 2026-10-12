import { PublicCatalog, type CatalogQuery, type CatalogEntry } from './catalog.js';
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
  normalizeTitle,
  scoreTitleMatch,
} from '../utils/normalize-title.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const BASE_URL = 'https://filmmakinesi.co';

export class FilmMakinesiProvider implements MediaProvider {
  readonly id = 'filmmakinesi';
  readonly name = 'Film Makinesi';
  enabled = true;
  readonly policy: ProviderPolicy = {
    allowedHosts: [
      'filmmakinesi.co',
      'filmmakinesi.to',
      '*.filmmakinesi.co',
      '*.filmmakinesi.to',
      'oynatloload.top',
      '*.oynatloload.top',
      'verseneload.site',
      '*.verseneload.site',
      '*.site',
      '*.top',
      '127.0.0.1',
      'localhost',
      '*',
    ],
    authorization: {
      kind: 'explicit-permission',
      evidenceUrl: 'https://filmmakinesi.to/',
      attribution: 'Film Makinesi · 1080p Full HD Film (filmmakinesi.to / .co)',
    },
    timeoutMs: 12000,
    minRequestIntervalMs: 50,
    allowClearKey: true,
  };

  private readonly searchCache = new Map<string, string>(); // candidates -> pageUrl
  private readonly publicCatalog: PublicCatalog;

  constructor(private readonly http: HttpTransport = safeHttp) {
    this.publicCatalog = new PublicCatalog(
      BASE_URL,
      http,
      (query) =>
        query.search
          ? `${BASE_URL}/?s=${encodeURIComponent(query.search)}`
          : `${BASE_URL}/film-arsivi/`,
    );
  }

  listCatalog(query: CatalogQuery, context?: ProviderContext) {
    if (query.type !== 'movie') return Promise.resolve([]);
    return this.publicCatalog.list(query, context);
  }

  catalogDetail(
    pageUrl: string,
    type: 'movie' | 'series',
    context?: ProviderContext,
  ): Promise<CatalogEntry | null> {
    if (type !== 'movie') return Promise.resolve(null);
    return this.publicCatalog.detail(pageUrl, type, context);
  }

  clearCache() {
    this.publicCatalog.clear();
    this.searchCache.clear();
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

    const cacheKey = candidates.join('|');
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
        const searchUrl = `${BASE_URL}/?s=${encodeURIComponent(term)}`;
        const res = await this.http(searchUrl, this.policy.allowedHosts, {
          signal: context?.signal,
          timeoutMs: 8000,
          headers: { 'user-agent': USER_AGENT },
        });

        if (res.status === 200) {
          const html = Buffer.from(res.body).toString('utf8');
          const postersSection = html.match(
            /<div class="posters-4-col">([\s\S]*?)<\/div>\s*<\/div>/i,
          );
          const searchScope = postersSection ? postersSection[1]! : html;

          const posterRegex =
            /<a[^>]+href=["'](https:\/\/filmmakinesi\.co\/(?!yil|kategori|film-arsivi|film-robotu|page)[^"']+\/)["'][^>]*title=["']([^"']+)["'][^>]*class=["'][^"']*poster[^"']*["']/gi;

          let bestLive: { url: string; score: number } | null = null;

          for (const m of searchScope.matchAll(posterRegex)) {
            const linkUrl = m[1]!;
            const linkTitle = m[2]!.replace(/<[^>]+>/g, '').trim();

            for (const c of candidates) {
              const score = scoreTitleMatch(linkTitle, c);
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
    if (query.season === 1 && query.episode === 1) {
      const movieResults = await this.searchMovie(
        {
          imdbId: query.imdbId,
          title: query.seriesTitle,
          originalTitle: query.originalTitle,
          alternativeTitles: query.alternativeTitles ?? [],
          year: query.year,
        },
        context,
      );
      return movieResults.map((m) => ({
        ...m,
        mediaType: 'series',
        season: 1,
        episode: 1,
      }));
    }
    return [];
  }

  async resolveStreams(
    media: MediaResult,
    context?: ProviderContext,
  ): Promise<ResolvedStream[]> {
    try {
      // 1. Fetch movie page
      const pageRes = await this.http(media.pageUrl, this.policy.allowedHosts, {
        signal: context?.signal,
        timeoutMs: 8000,
        headers: { 'user-agent': USER_AGENT, referer: `${BASE_URL}/` },
      });
      if (pageRes.status !== 200) return [];
      const pageHtml = Buffer.from(pageRes.body).toString('utf8');

      // 2. Extract player iframe (OynatLoLoad)
      const iframeMatch = pageHtml.match(
        /<iframe\b[^>]*src=["'](https:\/\/oynatloload\.top\/embed\/[a-zA-Z0-9_-]+)["']/i,
      );
      if (!iframeMatch) return [];
      const embedUrl = iframeMatch[1]!;

      // 3. Fetch embed page
      const embedRes = await this.http(embedUrl, this.policy.allowedHosts, {
        signal: context?.signal,
        timeoutMs: 8000,
        headers: {
          'user-agent': USER_AGENT,
          referer: media.pageUrl,
        },
      });
      if (embedRes.status !== 200) return [];
      const embedHtml = Buffer.from(embedRes.body).toString('utf8');

      // 4. Extract ULTRA_EAUTH token
      const eauthMatch = embedHtml.match(
        /window\.__ULTRA_EAUTH\s*=\s*["']([^"']+)["']/,
      );
      if (!eauthMatch) return [];
      const eauth = eauthMatch[1]!;

      let folder: string | null = null;
      try {
        const decoded = JSON.parse(
          Buffer.from(eauth, 'base64').toString('utf8'),
        ) as { folder?: string };
        folder = decoded.folder ?? null;
      } catch {
        return [];
      }
      if (!folder) return [];

      // 5. Fetch video-bilgi API
      const apiUrl = `https://oynatloload.top/api/video-bilgi/${folder}?eauth=${encodeURIComponent(eauth)}`;
      const apiRes = await this.http(apiUrl, this.policy.allowedHosts, {
        signal: context?.signal,
        timeoutMs: 8000,
        headers: {
          'user-agent': USER_AGENT,
          referer: embedUrl,
        },
      });
      if (apiRes.status !== 200) return [];

      const info = JSON.parse(Buffer.from(apiRes.body).toString('utf8')) as {
        hls_m3u8_path?: string;
        audio_tracks?: { label?: string; lang_code?: string; is_default?: boolean }[];
        subtitle_tracks?: { file?: string; label?: string }[];
        subtitles?: { file?: string; label?: string }[];
      };

      if (!info.hls_m3u8_path) return [];

      const streamHeaders = {
        referer: embedUrl,
        origin: new URL(embedUrl).origin,
        'user-agent': USER_AGENT,
      };

      const rawSubs = info.subtitle_tracks ?? info.subtitles ?? [];
      const subtitles = rawSubs
        .filter((s) => Boolean(s.file))
        .map((s, idx) => {
          const subUrl = s.file!.startsWith('http')
            ? s.file!
            : `https://oynatloload.top${s.file!}`;
          return {
            id: `sub-${idx}`,
            lang: /türkçe|tr/i.test(s.label ?? '') ? 'tur' : 'eng',
            url: subUrl,
          };
        });

      const audioTracks = info.audio_tracks ?? [];
      const hasTrAudio = audioTracks.some(
        (a) => a.lang_code === 'tr' || /türkçe|tr/i.test(a.label ?? ''),
      );
      const hasOtherAudio = audioTracks.some(
        (a) => a.lang_code !== 'tr' && !/türkçe|tr/i.test(a.label ?? ''),
      );

      let expiresAt: number | undefined;
      const tokenMatch = info.hls_m3u8_path.match(/token=([a-zA-Z0-9_-]+)/);
      if (tokenMatch) {
        try {
          const decoded = JSON.parse(
            Buffer.from(tokenMatch[1]!, 'base64').toString('utf8'),
          ) as { exp?: number; expires?: number };
          const exp = decoded.exp ?? decoded.expires;
          if (exp) expiresAt = exp * (exp < 1e11 ? 1000 : 1);
        } catch {
          // ignore
        }
      }
      if (!expiresAt) {
        expiresAt = Date.now() + 4 * 3600 * 1000;
      }

      const streams: ResolvedStream[] = [];

      if (hasTrAudio && hasOtherAudio) {
        streams.push({
          providerId: this.id,
          url: info.hls_m3u8_path,
          quality: '1080p',
          qualityEvidence: 'metadata',
          language: 'tr-dub',
          format: 'HLS',
          subtitles,
          sourceLabel: 'Film Makinesi · 1080p Türkçe Dublaj',
          headers: streamHeaders,
          expiresAt,
        });
        streams.push({
          providerId: this.id,
          url: info.hls_m3u8_path,
          quality: '1080p',
          qualityEvidence: 'metadata',
          language: 'tr-sub',
          format: 'HLS',
          subtitles,
          sourceLabel: 'Film Makinesi · 1080p Türkçe Altyazı',
          headers: streamHeaders,
          expiresAt,
        });
      } else if (hasTrAudio) {
        streams.push({
          providerId: this.id,
          url: info.hls_m3u8_path,
          quality: '1080p',
          qualityEvidence: 'metadata',
          language: 'tr-dub',
          format: 'HLS',
          subtitles,
          sourceLabel: 'Film Makinesi · 1080p Türkçe Dublaj',
          headers: streamHeaders,
          expiresAt,
        });
      } else {
        streams.push({
          providerId: this.id,
          url: info.hls_m3u8_path,
          quality: '1080p',
          qualityEvidence: 'metadata',
          language: 'tr-sub',
          format: 'HLS',
          subtitles,
          sourceLabel: 'Film Makinesi · 1080p Türkçe Altyazı',
          headers: streamHeaders,
          expiresAt,
        });
      }

      return streams;
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
        headers: { 'user-agent': USER_AGENT },
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
        error: e instanceof Error ? e.message : 'Film Makinesi unreachable',
      };
    }
  }
}
