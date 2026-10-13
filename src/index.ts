import { env } from './config/env.js';
import { SettingsStore } from './config/settings.js';
import { createRegistry } from './providers/registry.js';
import { createApp, createRuntime } from './server.js';
import { logger } from './utils/logger.js';
import { getLanIp } from './utils/lan-ip.js';
async function main() {
  const registry = await createRegistry();
  const settings = new SettingsStore();
  await settings.load();
  const app = createApp(createRuntime(registry, settings));
  const bindHost = process.env.NODE_ENV === 'test' ? env.HOST : '0.0.0.0';
  const server = app.listen(env.PORT, bindHost, () => {
    const lanIp = getLanIp();
    logger.info({ port: env.PORT, host: bindHost }, 'Stremio TR Sources ready');
    console.log(
      `Yönetim (PC): http://127.0.0.1:${env.PORT}/admin/\n` +
      `Stremio (PC): http://127.0.0.1:${env.PORT}/manifest.json\n` +
      `Stremio (Mobil / TV): http://${lanIp}:${env.PORT}/manifest.json`,
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
