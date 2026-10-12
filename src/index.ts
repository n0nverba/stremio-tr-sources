import { env } from './config/env.js';
import { SettingsStore } from './config/settings.js';
import { createRegistry } from './providers/registry.js';
import { createApp, createRuntime } from './server.js';
import { logger } from './utils/logger.js';
async function main() {
  const registry = await createRegistry();
  const settings = new SettingsStore();
  await settings.load();
  const app = createApp(createRuntime(registry, settings));
  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info({ port: env.PORT }, 'Stremio TR Sources ready');
    console.log(
      `Yönetim: http://127.0.0.1:${env.PORT}/admin/\nStremio: http://127.0.0.1:${env.PORT}/manifest.json`,
    );
  });
  server.on('error', () => {
    logger.error({ code: 'LISTEN_FAILED' }, 'Cannot start local server');
    process.exitCode = 1;
  });
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    const force = setTimeout(() => {
      server.closeAllConnections();
      process.exit(1);
    }, 10000);
    force.unref();
    server.close(() => {
      clearTimeout(force);
      process.exitCode = 0;
    });
    server.closeIdleConnections();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
main().catch(() => {
  logger.error(
    { code: 'STARTUP_CONFIGURATION_FAILED' },
    'Check environment, settings and provider configuration',
  );
  process.exitCode = 1;
});
