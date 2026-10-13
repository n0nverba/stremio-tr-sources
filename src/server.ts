import { CatalogService } from './services/catalog-service.js';
import express, { type ErrorRequestHandler } from 'express';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { resolve } from 'node:path';
import sdk from 'stremio-addon-sdk';
import { createAddon } from './addon/handlers.js';
import { env } from './config/env.js';
import { unsupportedSources } from './config/providers.js';
import { DEMO_URL } from './providers/demo-provider.js';
import { SettingsStore } from './config/settings.js';
import { ProviderRegistry } from './providers/registry.js';
import { StreamService } from './services/stream-service.js';
import { HealthService } from './services/health-service.js';
import { ErrorJournal, logger } from './utils/logger.js';
import { createProxyRouter } from './utils/hls-proxy.js';
import ipaddr from 'ipaddr.js';
import { getLanIp } from './utils/lan-ip.js';
export function createRuntime(
  registry: ProviderRegistry,
  settings = new SettingsStore(),
  service?: StreamService,
) {
  const errors = new ErrorJournal();
  const catalogs = new CatalogService(registry, settings, errors);
  const streams =
    service ??
    new StreamService(
      registry,
      settings,
      errors,
      undefined,
      undefined,
      catalogs,
    );
  const health = new HealthService(registry, errors);
  return { registry, settings, errors, streams, health, catalogs };
}
export type Runtime = ReturnType<typeof createRuntime>;
function isAllowedClientIp(addr?: string): boolean {
  if (!addr) return false;
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr)) return true;
  try {
    if (!ipaddr.isValid(addr)) return false;
    const range = ipaddr.process(addr).range();
    return range === 'loopback' || range === 'private';
  } catch {
    return false;
  }
}

function isAllowedHost(host?: string, port = env.PORT): boolean {
  if (!host) return false;
  let hostname = host;
  if (host.startsWith('[')) {
    const endBracket = host.indexOf(']');
    if (endBracket !== -1) {
      hostname = host.substring(1, endBracket);
    }
  } else {
    hostname = host.split(':')[0]!;
  }
  hostname = hostname.toLowerCase();
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return true;
  }
  if (
    process.env.PUBLIC_HOST &&
    (hostname === process.env.PUBLIC_HOST.toLowerCase() ||
      host.toLowerCase() === process.env.PUBLIC_HOST.toLowerCase() ||
      host.toLowerCase() === `${process.env.PUBLIC_HOST.toLowerCase()}:${port}`)
  ) {
    return true;
  }
  try {
    if (!ipaddr.isValid(hostname)) return false;
    const range = ipaddr.process(hostname).range();
    return range === 'loopback' || range === 'private';
  } catch {
    return false;
  }
}

export function createApp(runtime: Runtime, port = env.PORT) {
  const app = express();
  const csrf = randomBytes(32).toString('hex');
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  const counters = new Map<
    string,
    {
      count: number;
      reset: number;
    }
  >();
  app.use((req, res, next) => {
    if (!isAllowedClientIp(req.socket.remoteAddress)) {
      res.status(403).json({ error: 'LOCAL_ONLY' });
      return;
    }
    if (!isAllowedHost(req.headers.host, port)) {
      res.status(403).json({ error: 'INVALID_HOST' });
      return;
    }
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, HEAD');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    if (req.path.startsWith('/proxy/')) {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      next();
      return;
    }
    const key = req.socket.remoteAddress!;
    const now = Date.now();
    const counter = counters.get(key);
    if (!counter || counter.reset <= now)
      counters.set(key, { count: 1, reset: now + 60000 });
    else if (++counter.count > 120) {
      res.setHeader('Retry-After', '60');
      res.status(429).json({ error: 'RATE_LIMITED' });
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
  });
  const admin = express.Router();
  admin.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src https://media.w3.org; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) {
      res.status(403).json({ error: 'INVALID_ORIGIN' });
      return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      const token = req.headers['x-csrf-token'];
      if (
        typeof token !== 'string' ||
        !/^[a-f0-9]{64}$/.test(token) ||
        !timingSafeEqual(Buffer.from(token), Buffer.from(csrf))
      ) {
        res.status(403).json({ error: 'INVALID_CSRF' });
        return;
      }
    }
    next();
  });
  admin.use(express.json({ limit: '16kb', strict: true }));
  admin.get('/api/state', (_req, res) => {
    res.json({
      csrf,
      settings: runtime.settings.get(),
      providers: runtime.registry.describe(runtime.settings.get()),
      unsupportedSources,
      demoPreview: { imdbId: 'tt1254207', mediaUrl: DEMO_URL },
      cache: runtime.streams.cache.stats(),
      errors: runtime.errors.list(),
      installUrl: `http://127.0.0.1:${port}/manifest.json`,
      lanInstallUrl: `http://${getLanIp()}:${port}/manifest.json`,
    });
  });
  admin.get('/api/health', (_req, res, next) => {
    runtime.health
      .check(runtime.settings.get())
      .then((value) => res.json(value))
      .catch(next);
  });
  admin.post('/api/settings', (req, res, next) => {
    const input = req.body as {
      providers?: Record<string, unknown>;
    };
    const ids = new Set(runtime.registry.all().map((p) => p.id));
    if (Object.keys(input.providers ?? {}).some((id) => !ids.has(id))) {
      res.status(400).json({ error: 'UNKNOWN_PROVIDER' });
      return;
    }
    runtime.settings
      .save(input)
      .then(() => {
        runtime.streams.clear();
        runtime.health.cache.clear();
        res.json({ ok: true });
      })
      .catch(next);
  });
  admin.post('/api/cache/clear', (_req, res) => {
    runtime.streams.clear();
    runtime.health.cache.clear();
    res.json({ ok: true });
  });
  admin.use(
    express.static(resolve('admin'), { index: 'index.html', etag: false }),
  );
  app.use('/admin', admin);
  app.get('/', (_req, res) => res.redirect('/admin/'));
  app.use('/proxy', createProxyRouter());
  app.use(
    sdk.getRouter(
      createAddon(runtime.streams, runtime.catalogs, runtime.registry),
    ),
  );
  app.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
  const handleError: ErrorRequestHandler = (
    error: unknown,
    _req,
    res,
    _next,
  ) => {
    logger.warn(
      {
        code: 'REQUEST_REJECTED',
        ...(env.NODE_ENV === 'development'
          ? { errorType: error instanceof Error ? error.name : 'Unknown' }
          : {}),
      },
      'Request failed',
    );
    res.status(400).json({ error: 'INVALID_REQUEST' });
  };
  app.use(handleError);
  return app;
}
