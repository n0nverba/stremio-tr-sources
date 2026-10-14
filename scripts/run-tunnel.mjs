import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cloudflaredExe = resolve(rootDir, 'cloudflared.exe');
const tunnelFile = resolve(rootDir, 'data', 'tunnel-url.txt');

try {
  mkdirSync(resolve(rootDir, 'data'), { recursive: true });
} catch {}

const proc = spawn(cloudflaredExe, [
  'tunnel',
  '--url',
  'http://127.0.0.1:7000',
  '--http-host-header',
  'localhost:7000',
], {
  cwd: rootDir,
  stdio: ['ignore', 'pipe', 'pipe'],
});

function handleData(data) {
  const text = data.toString();
  const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
  if (match) {
    const tunnelUrl = match[0];
    const manifestUrl = `${tunnelUrl}/manifest.json`;
    try {
      writeFileSync(tunnelFile, manifestUrl, 'utf8');
      console.log(`[TUNNEL] Aktif HTTPS Manifest: ${manifestUrl}`);
    } catch {}
  }
}

proc.stdout.on('data', handleData);
proc.stderr.on('data', handleData);

proc.on('exit', (code) => {
  console.log(`[TUNNEL] Kapatıldı (Kod: ${code})`);
  process.exit(code ?? 0);
});
