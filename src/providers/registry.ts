import { DizipalCatalogProvider } from './dizipal-catalog-provider.js';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { MediaProvider } from './base.js';
import { DemoProvider } from './demo-provider.js';
import {
  AuthorizedHttpProvider,
  providerConfigSchema,
} from './authorized-http.js';
import { unsupportedSources } from '../config/providers.js';
import { env } from '../config/env.js';
import {
  AuthorizedSearchProvider,
  searchProviderConfigSchema,
} from './authorized-search.js';
import { DiziboxProvider } from './dizibox-provider.js';
import { HDFilmCehennemiProvider } from './hdfilmcehennemi-provider.js';
import { DiziLifeProvider } from './dizilife-provider.js';
import { FilmMakinesiProvider } from './filmmakinesi-provider.js';
import type { Settings } from '../config/settings.js';
export class ProviderRegistry {
  private readonly providers = new Map<string, MediaProvider>();
  register(provider: MediaProvider) {
    if (
      this.providers.has(provider.id) ||
      (unsupportedSources.some((s) => s.id === provider.id) &&
        !provider.catalogOnly)
    )
      throw new Error('DUPLICATE_OR_RESERVED_PROVIDER');
    if (
      !provider.policy.allowedHosts.length ||
      !provider.policy.authorization.evidenceUrl ||
      !provider.policy.authorization.attribution
    )
      throw new Error('AUTHORIZATION_REQUIRED');
    if (
      provider.policy.authorization.kind === 'catalog-only' &&
      !provider.catalogOnly
    )
      throw new Error('CATALOG_ONLY_PROVIDER_REQUIRED');
    this.providers.set(provider.id, provider);
  }
  all() {
    return [...this.providers.values()];
  }
  active(settings: Settings) {
    return this.all().filter((p) => settings.providers[p.id] ?? p.enabled);
  }
  describe(settings: Settings) {
    return this.all().map((p) => ({
      id: p.id,
      name: p.name,
      enabled: settings.providers[p.id] ?? p.enabled,
      authorization: p.policy.authorization,
      catalogOnly: p.catalogOnly ?? false,
    }));
  }
}
export async function createRegistry() {
  const registry = new ProviderRegistry();
  registry.register(new DemoProvider());
  registry.register(new DiziboxProvider());
  registry.register(new HDFilmCehennemiProvider());
  registry.register(new DiziLifeProvider());
  registry.register(new FilmMakinesiProvider());
  registry.register(new DizipalCatalogProvider());
  let raw: string;
  try {
    raw = await readFile(env.PROVIDERS_FILE, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return registry;
    throw new Error('PROVIDERS_FILE_UNREADABLE');
  }
  const providers = z
    .array(z.union([providerConfigSchema, searchProviderConfigSchema]))
    .max(20)
    .parse(JSON.parse(raw));
  for (const config of providers)
    registry.register(
      'searchUrl' in config
        ? new AuthorizedSearchProvider(config)
        : new AuthorizedHttpProvider(config),
    );
  return registry;
}
