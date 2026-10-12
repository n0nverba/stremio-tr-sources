import sdk from 'stremio-addon-sdk';
import { createManifest } from './manifest.js';
import { mapStream } from './stream-mapper.js';
import type { StreamService } from '../services/stream-service.js';
import type { CatalogService } from '../services/catalog-service.js';
import type { ProviderRegistry } from '../providers/registry.js';
export function createAddon(
  service: StreamService,
  catalogs?: CatalogService,
  registry?: ProviderRegistry,
) {
  const builder = new sdk.addonBuilder(createManifest(registry));
  builder.defineCatalogHandler(async (args) => ({
    metas: (await catalogs?.get(args.type, args.id, args.extra)) ?? [],
    cacheMaxAge: 0,
  }));
  builder.defineMetaHandler(async (args) => ({
    meta: (await catalogs?.meta(args.type, args.id)) ?? null,
    cacheMaxAge: 0,
  }));
  builder.defineStreamHandler(async (args) => {
    const started = Date.now();
    console.log(`[STREAM REQ] Aranan: ${args.type} ${args.id}`);
    const resolved = await service.get(args.type, args.id);
    const streams = resolved.map(mapStream);
    console.log(
      `[STREAM RESP] ${args.type} ${args.id} -> ${streams.length} akış bulundu (${Date.now() - started}ms)`,
    );
    return {
      streams,
      cacheMaxAge: 0,
      staleRevalidate: 0,
      staleError: 0,
    };
  });
  return builder.getInterface();
}
