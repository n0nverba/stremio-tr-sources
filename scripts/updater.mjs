import { execSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  cpSync,
} from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_OWNER = 'n0nverba';
const REPO_NAME = 'stremio-tr-sources';
const BRANCH = 'main';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(rootDir, 'data');
const commitFile = resolve(dataDir, 'installed-commit.txt');

function hasGit() {
  if (!existsSync(resolve(rootDir, '.git'))) {
    return false;
  }
  try {
    const res = spawnSync('git', ['--version'], { encoding: 'utf8' });
    return res.status === 0;
  } catch {
    return false;
  }
}

function getLocalCommit() {
  if (hasGit()) {
    try {
      const res = execSync('git rev-parse HEAD', {
        cwd: rootDir,
        encoding: 'utf8',
      }).trim();
      return res;
    } catch {}
  }

  if (existsSync(commitFile)) {
    try {
      return readFileSync(commitFile, 'utf8').trim();
    } catch {}
  }

  return 'bilinmiyor';
}

async function fetchRemoteCommit(timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/commits/${BRANCH}`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'stremio-tr-updater',
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!res.ok) return null;
    const data = await res.json();
    const firstLine = data.commit?.message ? data.commit.message.split('\n')[0] : '';
    return { sha: data.sha, message: firstLine || '' };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkUpdate(timeoutMs = 4000) {
  const localSha = getLocalCommit();
  const remote = await fetchRemoteCommit(timeoutMs);

  if (!remote) {
    return {
      updateAvailable: false,
      offline: true,
      localSha,
      remoteSha: null,
      message: 'GitHub sunucusuna ulaşılamadı (çevrimdışı veya sınır aşıldı).',
    };
  }

  const updateAvailable = !localSha.startsWith(remote.sha) && !remote.sha.startsWith(localSha);
  return {
    updateAvailable,
    offline: false,
    localSha: localSha.slice(0, 7),
    remoteSha: remote.sha.slice(0, 7),
    fullRemoteSha: remote.sha,
    message: remote.message,
  };
}

export async function applyUpdate() {
  console.log('[GÜNCELLEME] Güncellemeler kontrol ediliyor...');
  const check = await checkUpdate(8000);

  if (check.offline) {
    return { success: false, message: 'İnternet bağlantısı yok veya GitHub erişilemiyor.' };
  }

  if (!check.updateAvailable) {
    console.log(`[OK] Eklenti zaten en güncel sürümde (${check.localSha}).`);
    return { success: true, message: 'Eklenti zaten güncel.' };
  }

  console.log(`[BİLGİ] Yeni sürüm bulundu: ${check.remoteSha} - "${check.message}"`);

  // Senaryo 1: Git ile güncelleme
  if (hasGit()) {
    console.log('[1/3] Git üzerinden son değişiklikler çekiliyor...');
    try {
      execSync('git pull --ff-only origin ' + BRANCH, {
        cwd: rootDir,
        stdio: 'inherit',
      });
      return finishBuild();
    } catch {
      console.warn('[UYARI] "git pull" başarısız oldu, doğrudan dosya indirmeye geçiliyor...');
      return updateViaZip(check.fullRemoteSha);
    }
  }

  // Senaryo 2: Git yoksa (ZIP kullanıcıları) doğrudan GitHub Arşivini indirip üzerine yazma
  return updateViaZip(check.fullRemoteSha);
}

async function updateViaZip(remoteSha) {
  console.log('[1/3] GitHub üzerinden en son kod paketi indiriliyor...');
  mkdirSync(dataDir, { recursive: true });
  const zipPath = resolve(dataDir, 'update-latest.zip');
  const tempExtractDir = resolve(dataDir, 'update-temp');

  try {
    const zipUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/archive/refs/heads/${BRANCH}.zip`;
    const res = await fetch(zipUrl);
    if (!res.ok) {
      return { success: false, message: `GitHub ZIP indirilemedi: HTTP ${res.status}` };
    }

    const arrayBuffer = await res.arrayBuffer();
    writeFileSync(zipPath, Buffer.from(arrayBuffer));

    // Klasörü temizle ve aç
    if (existsSync(tempExtractDir)) {
      rmSync(tempExtractDir, { recursive: true, force: true });
    }
    mkdirSync(tempExtractDir, { recursive: true });

    // tar veya powershell ile çıkart
    try {
      execSync(`tar -xf "${zipPath}" -C "${tempExtractDir}"`, { stdio: 'ignore' });
    } catch {
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${tempExtractDir}' -Force"`,
        { stdio: 'inherit' },
      );
    }

    // GitHub zip'i genellikle "stremio-tr-sources-main" klasöründe açar
    const extractedSubdir = resolve(tempExtractDir, `${REPO_NAME}-${BRANCH}`);
    const sourceDir = existsSync(extractedSubdir) ? extractedSubdir : tempExtractDir;

    console.log('[2/3] Dosyalar güncelleniyor (özel ayarlar ve oturum korunuyor)...');
    cpSync(sourceDir, rootDir, {
      recursive: true,
      force: true,
      filter: (src) => {
        // Kullanıcı verilerini, tünel adresini, modülleri ve ortam değişkenlerini ezme
        if (src.includes('\\data') || src.includes('/data')) return false;
        if (src.includes('\\node_modules') || src.includes('/node_modules')) return false;
        if (src.endsWith('.env')) return false;
        return true;
      },
    });

    writeFileSync(commitFile, remoteSha, 'utf8');

    // Geçici dosyaları temizle
    try {
      rmSync(zipPath, { force: true });
      rmSync(tempExtractDir, { recursive: true, force: true });
    } catch {}

    return finishBuild();
  } catch (err) {
    return { success: false, message: `Güncelleme yüklenirken hata oluştu: ${err?.message || err}` };
  }
}

function finishBuild() {
  console.log('[3/3] Değişiklikler derleniyor (npm run build)...');
  try {
    execSync('npm.cmd run build', {
      cwd: rootDir,
      stdio: 'inherit',
    });
    console.log('\n============================================================');
    console.log('🎉 GÜNCELLEME BAŞARIYLA TAMAMLANDI!');
    console.log('   Yeni kodlar ve kaynaklar başarıyla yüklendi.');
    console.log('============================================================\n');
    return { success: true, message: 'Güncelleme başarıyla tamamlandı.' };
  } catch (err) {
    return { success: false, message: 'Derleme (build) sırasında hata oluştu.' };
  }
}

// CLI Argümanları
if (process.argv.includes('--check')) {
  checkUpdate().then((res) => {
    console.log(JSON.stringify(res, null, 2));
  });
} else if (process.argv.includes('--apply')) {
  applyUpdate().then((res) => {
    if (!res.success) {
      console.error('[HATA]', res.message);
      process.exit(1);
    }
  });
} else if (process.argv.includes('--check-and-update')) {
  checkUpdate(3000)
    .then(async (check) => {
      if (check.updateAvailable) {
        console.log(`[GÜNCELLEME] Yeni GitHub sürümü bulundu (${check.remoteSha}). Yükleniyor...`);
        await applyUpdate();
      }
    })
    .catch(() => {});
}
