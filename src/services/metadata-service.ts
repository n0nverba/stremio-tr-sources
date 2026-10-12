import { z } from 'zod';
import { MemoryCache } from '../cache/memory-cache.js';
import { env } from '../config/env.js';
import { safeHttp, type HttpTransport } from '../utils/safe-http.js';
import type { MovieQuery, ParsedId } from '../types/index.js';
import { generateTitleVariants } from '../utils/normalize-title.js';
const curated: Record<string, MovieQuery> = {
  tt1254207: {
    imdbId: 'tt1254207',
    title: 'Big Buck Bunny',
    originalTitle: 'Big Buck Bunny',
    year: 2008,
    alternativeTitles: [],
  },
  tt0133093: {
    imdbId: 'tt0133093',
    title: 'Matrix',
    originalTitle: 'The Matrix',
    year: 1999,
    alternativeTitles: ['The Matrix'],
  },
  tt0903747: {
    imdbId: 'tt0903747',
    title: 'Breaking Bad',
    originalTitle: 'Breaking Bad',
    year: 2008,
    alternativeTitles: [],
  },
};
const metaSchema = z.object({
  meta: z.object({
    id: z.string(),
    name: z.string().max(300),
    year: z.union([z.number(), z.string()]).optional(),
    releaseInfo: z.string().optional(),
  }),
});
export class MetadataService {
  readonly cache = new MemoryCache<MovieQuery>(env.CACHE_MAX_ENTRIES);
  constructor(
    private readonly http: HttpTransport = safeHttp,
    private readonly remote = env.REMOTE_METADATA === 'true',
  ) {}
  async get(id: ParsedId, signal: AbortSignal): Promise<MovieQuery> {
    const key = `${id.type}:${id.imdbId}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const local = curated[id.imdbId];
    if (local) {
      this.cache.set(key, local, env.METADATA_TTL_MS);
      return structuredClone(local);
    }
    if (this.remote) {
      try {
        let cineResult = await this.http(
          `https://v3-cinemeta.strem.io/meta/${id.type}/${id.imdbId}.json`,
          ['v3-cinemeta.strem.io'],
          { signal, timeoutMs: 2500, maxBytes: 262144 },
        ).catch(() => null);

        // Fallback to opposite type if 404 or empty
        if (!cineResult || cineResult.status !== 200) {
          const altType = id.type === 'movie' ? 'series' : 'movie';
          cineResult = await this.http(
            `https://v3-cinemeta.strem.io/meta/${altType}/${id.imdbId}.json`,
            ['v3-cinemeta.strem.io'],
            { signal, timeoutMs: 2000, maxBytes: 262144 },
          ).catch(() => null);
        }

        const wikiData = await this.fetchWikidataTitles(id.imdbId, signal);

        let title = '';
        let year: number | undefined;
        let originalTitle: string | undefined = wikiData.originalTitle;
        const alternatives = new Set<string>();

        if (cineResult && cineResult.status === 200) {
          try {
            const { meta } = metaSchema.parse(
              JSON.parse(Buffer.from(cineResult.body).toString('utf8')),
            );
            if (meta.id === id.imdbId) {
              title = meta.name;
              const y = Number(
                String(meta.year ?? meta.releaseInfo ?? '').slice(0, 4),
              );
              if (y >= 1800 && y <= 2200) year = y;
              for (const v of generateTitleVariants(meta.name)) {
                alternatives.add(v);
              }
            }
          } catch {
            /* ignore JSON parse error */
          }
        }

        if (!title && wikiData.titles.length > 0) {
          title = wikiData.titles[0]!;
        }

        for (const t of wikiData.titles) {
          for (const v of generateTitleVariants(t)) {
            alternatives.add(v);
          }
        }

        if (title) {
          const value: MovieQuery = {
            imdbId: id.imdbId,
            title,
            originalTitle: originalTitle ?? (alternatives.size ? [...alternatives][0] : undefined),
            year,
            alternativeTitles: [...alternatives],
          };
          this.cache.set(key, value, env.METADATA_TTL_MS);
          return value;
        }
      } catch {
        /* Exact IMDb matches remain available when metadata is offline. */
      }
    }
    const empty = { imdbId: id.imdbId, title: '', alternativeTitles: [] };
    this.cache.set(key, empty, env.NEGATIVE_TTL_MS);
    return empty;
  }

  private async fetchWikidataTitles(
    imdbId: string,
    signal: AbortSignal,
  ): Promise<{ titles: string[]; originalTitle?: string }> {
    const titles = new Set<string>();
    let originalTitle: string | undefined;

    try {
      const searchUrl = `https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=haswbstatement:P345=${imdbId}&format=json`;
      const wikiRes = await this.http(
        searchUrl,
        ['www.wikidata.org', 'wikidata.org'],
        {
          signal,
          timeoutMs: 2000,
          maxBytes: 65536,
          headers: {
            'user-agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) StremioTRAddon/1.0 (contact@stremio-tr.local)',
            accept: 'application/json',
          },
        },
      );
      if (wikiRes.status === 200) {
        const searchData = JSON.parse(
          Buffer.from(wikiRes.body).toString('utf8'),
        ) as {
          query?: { search?: Array<{ title?: string }> };
        };
        const qid = searchData?.query?.search?.[0]?.title;
        if (qid && /^Q\d+$/.test(qid)) {
          const entityUrl = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=labels|aliases|claims|sitelinks&languages=tr|en&sitefilter=trwiki&format=json`;
          const entRes = await this.http(
            entityUrl,
            ['www.wikidata.org', 'wikidata.org'],
            {
              signal,
              timeoutMs: 2000,
              maxBytes: 131072,
              headers: {
                'user-agent':
                  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) StremioTRAddon/1.0 (contact@stremio-tr.local)',
                accept: 'application/json',
              },
            },
          );
          if (entRes.status === 200) {
            const entData = JSON.parse(
              Buffer.from(entRes.body).toString('utf8'),
            ) as {
              entities?: Record<
                string,
                {
                  labels?: {
                    tr?: { value?: string };
                    en?: { value?: string };
                  };
                  aliases?: {
                    tr?: Array<{ value?: string }>;
                    en?: Array<{ value?: string }>;
                  };
                  sitelinks?: { trwiki?: { title?: string } };
                  claims?: {
                    P1476?: Array<{
                      mainsnak?: {
                        datavalue?: { value?: string | { text?: string } };
                      };
                    }>;
                    P1705?: Array<{
                      mainsnak?: {
                        datavalue?: { value?: string | { text?: string } };
                      };
                    }>;
                  };
                }
              >;
            };
            const ent = entData?.entities?.[qid];
            if (ent) {
              const trLabel = ent.labels?.tr?.value?.trim();
              if (trLabel) titles.add(trLabel);

              const enLabel = ent.labels?.en?.value?.trim();
              if (enLabel) titles.add(enLabel);

              const trwiki = ent.sitelinks?.trwiki?.title?.trim();
              if (trwiki) {
                titles.add(trwiki.replace(/\s*\([^)]*\)\s*$/, '').trim());
              }

              for (const a of ent.aliases?.tr ?? []) {
                if (a?.value) titles.add(a.value.trim());
              }
              for (const a of ent.aliases?.en ?? []) {
                if (a?.value) titles.add(a.value.trim());
              }

              for (const c of ent.claims?.P1476 ?? []) {
                const val = c?.mainsnak?.datavalue?.value;
                const text =
                  typeof val === 'string'
                    ? val
                    : val && typeof val === 'object' && val.text
                      ? val.text
                      : undefined;
                if (text) {
                  titles.add(text.trim());
                  if (!originalTitle) originalTitle = text.trim();
                }
              }

              for (const c of ent.claims?.P1705 ?? []) {
                const val = c?.mainsnak?.datavalue?.value;
                const text =
                  typeof val === 'string'
                    ? val
                    : val && typeof val === 'object' && val.text
                      ? val.text
                      : undefined;
                if (text) {
                  titles.add(text.trim());
                  if (!originalTitle) originalTitle = text.trim();
                }
              }
            }
          }
        }
      }
    } catch {
      /* Wikidata search is best-effort */
    }

    if (titles.size === 0) {
      try {
        const sparql = `SELECT ?title WHERE { ?item wdt:P345 "${imdbId}". { ?item rdfs:label ?title. FILTER(LANG(?title) IN ("tr", "en")) } UNION { ?item wdt:P1476 ?title. } } LIMIT 5`;
        const wikiUrl = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
        const wikiRes = await this.http(
          wikiUrl,
          ['query.wikidata.org', 'wikidata.org'],
          {
            signal,
            timeoutMs: 1500,
            maxBytes: 65536,
            headers: {
              'user-agent': 'StremioTRSources/1.0 (contact@stremio-tr.local)',
              accept: 'application/json',
            },
          },
        );
        if (wikiRes.status === 200) {
          const wikiData = JSON.parse(
            Buffer.from(wikiRes.body).toString('utf8'),
          ) as {
            results?: {
              bindings?: Array<{ title?: { value?: string } }>;
            };
          };
          for (const b of wikiData?.results?.bindings ?? []) {
            const val = b?.title?.value?.trim();
            if (val) titles.add(val);
          }
        }
      } catch {
        /* SPARQL fallback is best-effort */
      }
    }

    return {
      titles: [...titles].filter((t) => t.length >= 2),
      originalTitle,
    };
  }
}
