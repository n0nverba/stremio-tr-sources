import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from './logger.js';
import { syncAddonToStremioAccount } from './stremio-sync.js';

let tunnelProcess: ChildProcess | null = null;

function getRootDir(): string {
  if (existsSync(resolve(process.cwd(), 'cloudflared.exe'))) {
    return process.cwd();
  }
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..');
}

export function startTunnel(port: number): void {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  const rootDir = getRootDir();
  const cloudflaredExe = resolve(rootDir, 'cloudflared.exe');
  const tunnelFile = resolve(rootDir, 'data', 'tunnel-url.txt');

  try {
    if (existsSync(tunnelFile)) {
      unlinkSync(tunnelFile);
    }
    mkdirSync(resolve(rootDir, 'data'), { recursive: true });
  } catch {}

  if (!existsSync(cloudflaredExe)) {
    logger.debug('cloudflared.exe bulunamadı, yerel HTTP modunda devam ediliyor.');
    return;
  }

  try {
    const proc = spawn(
      cloudflaredExe,
      [
        'tunnel',
        '--url',
        `http://127.0.0.1:${port}`,
        '--http-host-header',
        `localhost:${port}`,
      ],
      {
        cwd: rootDir,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    tunnelProcess = proc;

    let tunnelReady = false;
    const handleData = (data: Buffer | string) => {
      if (tunnelReady) return;
      const text = data.toString();
      const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) {
        tunnelReady = true;
        const tunnelUrl = match[0];
        const manifestUrl = `${tunnelUrl}/manifest.json`;
        try {
          writeFileSync(tunnelFile, manifestUrl, 'utf8');
        } catch {}
        logger.info({ tunnelUrl, manifestUrl }, 'Cloudflare HTTPS tunnel ready');
        console.log(
          `\n============================================================\n` +
          `🌐 GÜVENLİ HTTPS EKLENTİ ADRESİ (Stremio Kurulum):\n` +
          `   ${manifestUrl}\n` +
          `   (Bu adres PC, Telefon ve TV'deki Stremio ile tam uyumludur)\n` +
          `============================================================\n`,
        );
        void syncAddonToStremioAccount(manifestUrl);
      }
    };

    proc.stdout?.on('data', handleData);
    proc.stderr?.on('data', handleData);

    proc.on('error', (err) => {
      logger.warn({ err }, 'Cloudflare tünel başlatılamadı, yerel HTTP kullanılacak.');
      tunnelProcess = null;
    });

    proc.on('exit', () => {
      tunnelProcess = null;
      try {
        if (existsSync(tunnelFile)) {
          unlinkSync(tunnelFile);
        }
      } catch {}
    });
  } catch (error) {
    logger.warn({ error }, 'Cloudflare tünel işlemi başlatılırken hata oluştu.');
  }
}

export function stopTunnel(): void {
  if (tunnelProcess) {
    try {
      tunnelProcess.kill('SIGTERM');
      tunnelProcess.kill('SIGKILL');
    } catch {}
    tunnelProcess = null;
  }
  try {
    const rootDir = getRootDir();
    const tunnelFile = resolve(rootDir, 'data', 'tunnel-url.txt');
    if (existsSync(tunnelFile)) {
      unlinkSync(tunnelFile);
    }
  } catch {}
}
