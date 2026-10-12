import type { ProviderRegistry } from '../providers/registry.js';
import type { Manifest } from 'stremio-addon-sdk';
export const manifest: Manifest = {
  id: 'com.stremiotr.sources',
  name: 'Stremio TR Sources',
  version: '1.1.1',
  description:
    'Türkçe dizi ve film kaynakları (Film Makinesi, DiziBOX, HDFilmCehennemi, DiziLife).',
  resources: [
    'catalog',
    {
      name: 'meta',
      types: ['movie', 'series'],
      idPrefixes: ['tr:'],
    },
    {
      name: 'stream',
      types: ['movie', 'series'],
      idPrefixes: ['tt', 'tr:'],
    },
  ],
  types: ['movie', 'series'],
  catalogs: ['movie', 'series'].map((type) => ({
    type,
    id: 'tr-all',
    name: type === 'movie' ? 'TR · Tüm Filmler' : 'TR · Tüm Diziler',
    extra: [
      { name: 'search', isRequired: false },
      { name: 'skip', isRequired: false },
    ],
  })),
  idPrefixes: ['tt', 'tr:'],
};

export function createManifest(registry?: ProviderRegistry): Manifest {
  return {
    ...manifest,
    catalogs: [
      ...manifest.catalogs,
      ...(registry
        ?.all()
        .filter((p) => p.listCatalog)
        .flatMap((p) =>
          ['movie', 'series'].map((type) => ({
            type,
            id: 'tr-provider-' + p.id,
            name: p.name + (type === 'movie' ? ' · Filmler' : ' · Diziler'),
            extra: [
              { name: 'search', isRequired: false },
              { name: 'skip', isRequired: false },
            ],
          })),
        ) ?? []),
    ],
  };
}
