/** Typed subset of SDK 1.6.10's installed builder/getRouter API.
 * That release ships JavaScript without declaration files.
 * Extend this contract when adding another SDK resource.
 */
declare module 'stremio-addon-sdk' {
  import type { RequestHandler } from 'express';

  export interface ManifestResourceObject {
    name: string;
    types?: string[];
    idPrefixes?: string[];
  }

  export interface Manifest {
    id: string;
    name: string;
    version: string;
    description: string;
    resources: (string | ManifestResourceObject)[];
    types: string[];
    catalogs: {
      type: string;
      id: string;
      name?: string;
      extra?: { name: string; isRequired?: boolean }[];
    }[];
    idPrefixes?: string[];
  }

  export interface Meta {
    id: string;
    type: string;
    name: string;
    poster?: string;
    description?: string;
    releaseInfo?: string;
    videos?: { id: string; title: string; season: number; episode: number }[];
  }
  export interface CatalogResponse {
    metas: Meta[];
    cacheMaxAge?: number;
  }
  export interface MetaResponse {
    meta: Meta | null;
    cacheMaxAge?: number;
  }
  export interface Stream {
    url: string;
    name?: string;
    description?: string;
    title?: string;
    subtitles?: { id: string; url: string; lang: string }[];
    behaviorHints?: { notWebReady?: boolean; filename?: string };
  }

  export interface StreamResponse {
    streams: Stream[];
    cacheMaxAge?: number;
    staleRevalidate?: number;
    staleError?: number;
  }

  export interface StreamArguments {
    type: string;
    id: string;
    extra: Record<string, string | string[] | undefined>;
    config: unknown;
  }

  export interface AddonInterface {
    get(
      resource: 'catalog',
      type: string,
      id: string,
      extra?: StreamArguments['extra'],
      config?: unknown,
    ): Promise<CatalogResponse>;
    get(
      resource: 'meta',
      type: string,
      id: string,
      extra?: StreamArguments['extra'],
      config?: unknown,
    ): Promise<MetaResponse>;
    readonly manifest: Readonly<Manifest>;
    get(
      resource: 'stream',
      type: string,
      id: string,
      extra?: StreamArguments['extra'],
      config?: unknown,
    ): Promise<StreamResponse>;
  }

  export class addonBuilder {
    constructor(manifest: Manifest);
    defineStreamHandler(
      handler: (args: StreamArguments) => Promise<StreamResponse>,
    ): this;
    defineCatalogHandler(
      handler: (args: StreamArguments) => Promise<CatalogResponse>,
    ): this;
    defineMetaHandler(
      handler: (args: StreamArguments) => Promise<MetaResponse>,
    ): this;
    getInterface(): AddonInterface;
  }

  export function getRouter(addon: AddonInterface): RequestHandler;
  const sdk: {
    addonBuilder: typeof addonBuilder;
    getRouter: typeof getRouter;
  };
  export default sdk;
}
