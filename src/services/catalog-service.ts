import type { CatalogEntry } from '../providers/catalog.js';
import { catalogId, decodeCatalogId } from '../providers/catalog.js';
import type { ProviderRegistry } from '../providers/registry.js';
import type { SettingsStore } from '../config/settings.js';
import type { ErrorJournal } from '../utils/logger.js';
import { withTimeout } from '../utils/timeout.js';
import { env } from '../config/env.js';
import type { MediaResult } from '../types/index.js';
import type { Meta } from 'stremio-addon-sdk';

const PAGE_SIZE = 50;
export class CatalogService {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly settings: SettingsStore,
    private readonly errors: Pick<ErrorJournal, 'record'>,
  ) {}
  private preview(providerId: string, entry: CatalogEntry): Meta {
    const id = catalogId(providerId, entry);
    return {
      id,
      type: entry.mediaType,
      name: entry.title,
      poster: entry.poster,
      description: entry.description,
      releaseInfo: entry.year ? String(entry.year) : undefined,
      videos:
        entry.mediaType === 'series'
          ? entry.episodes?.map((e) => ({
              id: id + ':' + e.season + ':' + e.episode,
              title: e.title ?? e.season + '. Sezon ' + e.episode + '. Bölüm',
              season: e.season,
              episode: e.episode,
            }))
          : undefined,
    };
  }
  async get(
    type: string,
    id: string,
    extra: Record<string, string | string[] | undefined>,
  ) {
    if (
      (type !== 'movie' && type !== 'series') ||
      !(id === 'tr-all' || id.startsWith('tr-provider-'))
    )
      return [];
    const rawSkip = extra.skip ?? '0';
    const rawSearch = extra.search;
    if (
      typeof rawSkip !== 'string' ||
      !/^(0|[1-9]\d{0,5})$/.test(rawSkip) ||
      (rawSearch !== undefined &&
        (typeof rawSearch !== 'string' || rawSearch.length > 300))
    )
      return [];
    const skip = Number(rawSkip);
    const preferences = this.settings.get();
    const providers = this.registry
      .active(preferences)
      .filter(
        (p) =>
          p.listCatalog && (id === 'tr-all' || id === 'tr-provider-' + p.id),
      );
    const groups = await Promise.all(
      providers.map((p) =>
        withTimeout(
          async (signal) => {
            const entries = await p.listCatalog!(
              {
                type,
                skip: id === 'tr-all' ? 0 : skip,
                limit: id === 'tr-all' ? skip + PAGE_SIZE : PAGE_SIZE,
                search: rawSearch,
              },
              { signal },
            );
            return entries.map((e) => this.preview(p.id, e));
          },
          Math.min(
            p.policy.timeoutMs ?? preferences.providerTimeoutMs,
            env.GLOBAL_BUDGET_MS,
          ),
        ).catch(() => {
          this.errors.record(p.id, 'CATALOG_FAILED');
          return [];
        }),
      ),
    );
    if (id !== 'tr-all') return groups.flat().slice(0, PAGE_SIZE);
    // Interleave sources so smaller catalogs also appear on the first page.
    const metas: Meta[] = [];
    const max = Math.max(0, ...groups.map((g) => g.length));
    for (let i = 0; i < max; i++)
      for (const group of groups) if (group[i]) metas.push(group[i]!);
    return metas.slice(skip, skip + PAGE_SIZE);
  }
  async lookup(type: string, rawId: string) {
    if (type !== 'movie' && type !== 'series') return null;
    const parsed = decodeCatalogId(rawId);
    if (!parsed || (type === 'movie' && parsed.episode !== undefined))
      return null;
    const preferences = this.settings.get();
    const provider = this.registry
      .active(preferences)
      .find((p) => p.id === parsed.providerId);
    if (!provider?.catalogDetail) return null;
    try {
      const entry = await withTimeout(
        (signal) => provider.catalogDetail!(parsed.pageUrl, type, { signal }),
        Math.min(
          provider.policy.timeoutMs ?? preferences.providerTimeoutMs,
          env.GLOBAL_BUDGET_MS,
        ),
      );
      if (
        !entry ||
        entry.mediaType !== type ||
        entry.pageUrl !== parsed.pageUrl
      )
        return null;
      return { provider, entry, parsed };
    } catch {
      this.errors.record(provider.id, 'CATALOG_DETAIL_FAILED');
      return null;
    }
  }
  async meta(type: string, id: string): Promise<Meta | null> {
    const found = await this.lookup(type, id);
    return found ? this.preview(found.provider.id, found.entry) : null;
  }
  async media(type: string, id: string) {
    const found = await this.lookup(type, id);
    if (!found) return null;
    const { entry, parsed, provider } = found;
    let pageUrl = entry.pageUrl;
    if (type === 'series') {
      const episode = entry.episodes?.find(
        (e) => e.season === parsed.season && e.episode === parsed.episode,
      );
      if (!episode) return null;
      pageUrl = episode.pageUrl;
    }
    const media: MediaResult = {
      providerId: provider.id,
      title: entry.title,
      year: entry.year,
      mediaType: entry.mediaType,
      pageUrl,
      externalId: entry.externalId,
      confidence: 1,
      season: parsed.season,
      episode: parsed.episode,
    };
    return { provider, media };
  }
}
