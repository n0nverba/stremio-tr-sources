import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from './logger.js';

export function findStremioAuthKey(): string | null {
  const base = process.env.LOCALAPPDATA || '';
  const searchDirs = [
    join(base, 'Programs', 'Stremio', 'stremio-shell-ng.exe.WebView2', 'EBWebView', 'Default', 'Local Storage', 'leveldb'),
  ];

  for (const dir of searchDirs) {
    if (!existsSync(dir)) continue;
    try {
      for (const f of readdirSync(dir)) {
        if (f.endsWith('.ldb') || f.endsWith('.log')) {
          try {
            const raw = readFileSync(join(dir, f)).toString('latin1').replace(/\x00/g, '');
            const target = 'profile';
            let idx = 0;
            while ((idx = raw.indexOf(target, idx)) !== -1) {
              const slice = raw.slice(idx, idx + 150);
              if (slice.includes('auth')) {
                const match = slice.match(/"([A-Za-z0-9+/=]{44})"/);
                if (match && match[1]) {
                  return match[1];
                }
              }
              idx += target.length;
            }
          } catch {}
        }
      }
    } catch {}
  }
  return null;
}

export async function syncAddonToStremioAccount(manifestUrl: string): Promise<boolean> {
  const authKey = findStremioAuthKey();
  if (!authKey) {
    logger.debug('Stremio authKey bulunamadı (oturum açılmamış olabilir).');
    return false;
  }

  try {
    const getRes = await fetch('https://api.strem.io/api/addonCollectionGet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'AddonCollectionGet', authKey }),
    });

    if (!getRes.ok) {
      logger.debug({ status: getRes.status }, 'Stremio addonCollectionGet başarısız.');
      return false;
    }

    const getData = (await getRes.json()) as {
      result?: {
        addons?: Array<{
          transportUrl?: string;
          transportName?: string;
          manifest?: { id?: string; [key: string]: unknown };
          flags?: { official?: boolean; protected?: boolean };
        }>;
      };
    };

    const addons = getData.result?.addons;
    if (!addons || !Array.isArray(addons)) {
      return false;
    }

    let manifest: any = null;
    try {
      const localRes = await fetch('http://127.0.0.1:7000/manifest.json');
      if (localRes.ok) {
        manifest = await localRes.json();
      }
    } catch {}

    if (!manifest) {
      for (let i = 0; i < 8; i++) {
        try {
          const res = await fetch(manifestUrl);
          if (res.ok) {
            manifest = await res.json();
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 600));
      }
    }

    if (!manifest) {
      logger.debug('Manifest okunamadı, senkronizasyon atlandı.');
      return false;
    }

    const targetIdx = addons.findIndex(
      (a) => a.manifest && a.manifest.id === 'com.stremiotr.sources',
    );

    const newAddon = {
      transportUrl: manifestUrl,
      transportName: '',
      manifest,
      flags: { official: false, protected: false },
    };

    if (targetIdx !== -1 && addons[targetIdx]) {
      if (addons[targetIdx]?.transportUrl === manifestUrl) {
        logger.info('Stremio eklenti adresi zaten güncel.');
        return true;
      }
      addons[targetIdx] = newAddon;
    } else {
      addons.push(newAddon);
    }

    const setRes = await fetch('https://api.strem.io/api/addonCollectionSet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'AddonCollectionSet',
        authKey,
        addons,
      }),
    });

    if (setRes.ok) {
      logger.info({ manifestUrl }, 'Stremio hesabı başarıyla yeni eklenti adresiyle eşitlendi!');
      return true;
    }
  } catch (error) {
    logger.debug({ error }, 'Stremio hesap senkronizasyonu sırasında hata oluştu.');
  }

  return false;
}

export async function removeAddonFromStremioAccount(): Promise<boolean> {
  const authKey = findStremioAuthKey();
  if (!authKey) return false;

  try {
    const getRes = await fetch('https://api.strem.io/api/addonCollectionGet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'AddonCollectionGet', authKey }),
    });

    if (!getRes.ok) return false;

    const getData = (await getRes.json()) as {
      result?: {
        addons?: Array<{
          manifest?: { id?: string };
        }>;
      };
    };

    const addons = getData.result?.addons;
    if (!addons || !Array.isArray(addons)) return false;

    const filtered = addons.filter(
      (a) => !a.manifest || a.manifest.id !== 'com.stremiotr.sources',
    );

    if (filtered.length === addons.length) return true;

    const setRes = await fetch('https://api.strem.io/api/addonCollectionSet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'AddonCollectionSet',
        authKey,
        addons: filtered,
      }),
    });

    return setRes.ok;
  } catch {
    return false;
  }
}
