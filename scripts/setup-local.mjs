import process from 'node:process';
import console from 'node:console';
import { setTimeout as delay } from 'node:timers/promises';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  copyFileSync,
  mkdirSync,
  openSync,
  closeSync,
} from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const skipLive = process.argv.includes('--skip-live-checks');

function npm(args) {
  // Arguments are fixed internal commands, never request or provider input.
  const result = spawnSync(
    'cmd.exe',
    ['/d', '/s', '/c', `npm.cmd ${args.join(' ')}`],
    {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0)
    throw new Error(`Başarısız adım: npm ${args.join(' ')}`);
}

async function json(url, timeout = 20000) {
  const response = await globalThis.fetch(url, {
    signal: globalThis.AbortSignal.timeout(timeout),
  });
  if (!response.ok)
    throw new Error(`Yerel endpoint hatası: HTTP ${response.status}`);
  return response.json();
}

function open(url) {
  // URL is built exclusively from a validated numeric port and fixed routes.
  const child = spawn('cmd.exe', ['/d', '/s', '/c', `start "" "${url}"`], {
    windowsHide: true,
    detached: true,
    stdio: 'ignore',
  });
  child.on('error', () => console.log(`Uygulama açılamadı; adres: ${url}`));
  child.unref();
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log(
      'Windows: Stremio-TR-Baslat.cmd\nAlternatif: node scripts/setup-local.mjs\nCanlı kontrolleri atlamak: --skip-live-checks',
    );
    return;
  }
  if (
    process.platform !== 'win32' ||
    Number(process.versions.node.split('.')[0]) !== 24
  ) {
    throw new Error(
      'Bu otomatik başlatıcı Windows ve Node.js 24 LTS gerektirir.',
    );
  }
  console.log('1/6 · Bağımlılıklar kuruluyor…');
  // Keep online registry metadata separate from the partial offline tooling cache.
  npm([
    'install',
    '--cache',
    '.cache/npm-online',
    '--prefer-online',
    '--no-audit',
    '--no-fund',
  ]);
  const environment = join(root, '.env');
  if (!existsSync(environment))
    copyFileSync(join(root, '.env.example'), environment);

  console.log('2/6 · Format, TypeScript, lint, test ve build…');
  npm(['run', 'format']);
  npm(['run', 'format:check']);
  npm(['run', 'check']);

  console.log('3/6 · Yetkili medya ve performans kontrolleri…');
  if (!skipLive) npm(['run', 'test:integration']);
  npm(['run', 'benchmark']);
  if (!skipLive) npm(['run', 'benchmark', '--', '--live']);
  const { env } = await import('../dist/config/env.js');
  const base = `http://127.0.0.1:${env.PORT}`;

  console.log('4/6 · Yerel sunucu başlatılıyor…');
  let existing;
  try {
    existing = await json(`${base}/manifest.json`, 2000);
  } catch {
    /* Start if no manifest exists. */
  }
  if (existing && existing.id !== 'com.stremiotr.sources')
    throw new Error('Port başka bir eklenti tarafından kullanılıyor.');
  if (existing) {
    console.log('Mevcut Stremio TR Sources sunucusu kullanılıyor.');
  } else {
    const logs = join(root, 'data/runtime');
    mkdirSync(logs, { recursive: true });
    const stdout = openSync(join(logs, 'server.stdout.log'), 'a');
    const stderr = openSync(join(logs, 'server.stderr.log'), 'a');
    let failure;
    let child;
    try {
      child = spawn(process.execPath, ['dist/index.js'], {
        cwd: root,
        detached: true,
        windowsHide: true,
        stdio: ['ignore', stdout, stderr],
      });
      child.on('error', () => {
        failure = true;
      });
      child.on('exit', () => {
        failure = true;
      });
      child.unref();
    } catch {
      closeSync(stdout);
      closeSync(stderr);
    }
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (failure) throw new Error(`Sunucu başlayamadı. Loglar: ${logs}`);
      try {
        const manifest = await json(`${base}/manifest.json`, 1000);
        if (manifest.id === 'com.stremiotr.sources') {
          ready = true;
          break;
        }
      } catch {
        /* Give the new local process time to bind. */
      }
      await delay(500);
    }
    if (!ready) throw new Error(`Sunucu hazır olmadı. Loglar: ${logs}`);
  }

  console.log('5/6 · Film ve dizi endpointleri kontrol ediliyor…');
  const movie = await json(`${base}/stream/movie/tt1254207.json`);
  const series = await json(`${base}/stream/series/tt0903747:1:1.json`);
  if (!Array.isArray(movie.streams) || !Array.isArray(series.streams))
    throw new Error('Beklenen stream JSON formatı alınamadı.');
  if (!skipLive && !movie.streams.length)
    throw new Error('Canlı demo için oynatılabilir stream doğrulanamadı.');

  console.log('6/6 · Yönetim paneli ve Stremio kurulumu açılıyor…');
  console.log(
    `Yönetim paneli: ${base}/admin/\nKurulum adresi: ${base}/manifest.json`,
  );
  open(`${base}/admin/`);
  open(`stremio://127.0.0.1:${env.PORT}/manifest.json`);
  console.log(
    'Yerel kurulum kontrolleri tamamlandı. Stremio içinde Big Buck Bunny filminin görüntü/sesini kontrol edin.',
  );
  if (skipLive)
    console.log('Canlı ağ kontrolleri atlandı; oynatım doğrulanmış sayılmaz.');
}

main().catch((error) => {
  console.error(error.message);
  console.error(
    'İşlem durdu; başarısız kontrol tamamlanmış gibi gösterilmedi.',
  );
  process.exitCode = 1;
});
