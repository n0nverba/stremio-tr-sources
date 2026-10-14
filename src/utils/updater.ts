import { spawnSync, execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_OWNER = 'n0nverba';
const REPO_NAME = 'stremio-tr-sources';
const BRANCH = 'main';

export interface UpdateStatus {
  updateAvailable: boolean;
  offline: boolean;
  localSha: string;
  remoteSha: string | null;
  message: string;
}

export function getLocalCommitSha(): string {
  try {
    const res = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
    if (res.status === 0 && res.stdout) {
      return res.stdout.trim();
    }
  } catch {}

  const commitFile = resolve('data', 'installed-commit.txt');
  if (existsSync(commitFile)) {
    try {
      return readFileSync(commitFile, 'utf8').trim();
    } catch {}
  }

  return 'bilinmiyor';
}

export async function checkGitHubUpdate(timeoutMs = 4000): Promise<UpdateStatus> {
  const localSha = getLocalCommitSha();
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

    if (!res.ok) {
      return {
        updateAvailable: false,
        offline: true,
        localSha: localSha.slice(0, 7),
        remoteSha: null,
        message: 'GitHub API yanıt vermedi.',
      };
    }

    const data = (await res.json()) as { sha: string; commit?: { message?: string } };
    const remoteSha = data.sha;
    const firstLine = data.commit?.message ? data.commit.message.split('\n')[0] : '';

    const updateAvailable = !localSha.startsWith(remoteSha) && !remoteSha.startsWith(localSha);

    return {
      updateAvailable,
      offline: false,
      localSha: localSha.slice(0, 7),
      remoteSha: remoteSha.slice(0, 7),
      message: firstLine || '',
    };
  } catch {
    return {
      updateAvailable: false,
      offline: true,
      localSha: localSha.slice(0, 7),
      remoteSha: null,
      message: 'GitHub sunucusuna ulaşılamadı (çevrimdışı).',
    };
  } finally {
    clearTimeout(timer);
  }
}

export function runUpdateScript(): { success: boolean; output: string } {
  try {
    const output = execSync('node scripts/updater.mjs --apply', {
      encoding: 'utf8',
      timeout: 120000,
    });
    return { success: true, output };
  } catch (err: any) {
    return {
      success: false,
      output: err?.stdout || err?.stderr || err?.message || 'Bilinmeyen hata',
    };
  }
}
