import { Router } from 'express';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function rewriteAudioTrack(line: string, audioMode?: string): string {
  if (!audioMode) return line;

  const isTr =
    /LANGUAGE=["'](tr|tur)["']/i.test(line) ||
    /NAME=["'][^"']*türkçe[^"']*["']/i.test(line);

  if (audioMode === 'orig') {
    if (isTr) {
      return line
        .replace(/DEFAULT=(?:YES|NO)/i, 'DEFAULT=NO')
        .replace(/AUTOSELECT=(?:YES|NO)/i, 'AUTOSELECT=NO');
    } else {
      let updated = line
        .replace(/DEFAULT=(?:YES|NO)/i, 'DEFAULT=YES')
        .replace(/AUTOSELECT=(?:YES|NO)/i, 'AUTOSELECT=YES');
      if (!/DEFAULT=/i.test(updated)) updated += ',DEFAULT=YES';
      if (!/AUTOSELECT=/i.test(updated)) updated += ',AUTOSELECT=YES';
      return updated;
    }
  } else if (audioMode === 'tr') {
    if (isTr) {
      let updated = line
        .replace(/DEFAULT=(?:YES|NO)/i, 'DEFAULT=YES')
        .replace(/AUTOSELECT=(?:YES|NO)/i, 'AUTOSELECT=YES');
      if (!/DEFAULT=/i.test(updated)) updated += ',DEFAULT=YES';
      if (!/AUTOSELECT=/i.test(updated)) updated += ',AUTOSELECT=YES';
      return updated;
    } else {
      return line
        .replace(/DEFAULT=(?:YES|NO)/i, 'DEFAULT=NO')
        .replace(/AUTOSELECT=(?:YES|NO)/i, 'AUTOSELECT=NO');
    }
  }

  return line;
}

function rewriteSubtitleTrack(line: string, audioMode?: string): string {
  if (!audioMode) return line;

  const isTr =
    /LANGUAGE=["'](tr|tur)["']/i.test(line) ||
    /NAME=["'][^"']*türkçe[^"']*["']/i.test(line);

  const isForced =
    /FORCED=YES/i.test(line) ||
    /NAME=["'][^"']*(?:zorunlu|forced)[^"']*["']/i.test(line) ||
    /LANGUAGE=["'][^"']*(?:forced)[^"']*["']/i.test(line);

  if (audioMode === 'orig') {
    if (isTr && !isForced) {
      let updated = line
        .replace(/DEFAULT=(?:YES|NO)/i, 'DEFAULT=YES')
        .replace(/AUTOSELECT=(?:YES|NO)/i, 'AUTOSELECT=YES')
        .replace(/FORCED=YES/i, 'FORCED=NO');
      if (!/DEFAULT=/i.test(updated)) updated += ',DEFAULT=YES';
      if (!/AUTOSELECT=/i.test(updated)) updated += ',AUTOSELECT=YES';
      if (!/FORCED=/i.test(updated)) updated += ',FORCED=NO';
      return updated;
    } else {
      return line
        .replace(/DEFAULT=(?:YES|NO)/i, 'DEFAULT=NO')
        .replace(/AUTOSELECT=(?:YES|NO)/i, 'AUTOSELECT=NO')
        .replace(/FORCED=YES/i, 'FORCED=NO');
    }
  } else if (audioMode === 'tr') {
    if (isTr && !isForced) {
      return line
        .replace(/DEFAULT=(?:YES|NO)/i, 'DEFAULT=NO')
        .replace(/AUTOSELECT=(?:YES|NO)/i, 'AUTOSELECT=NO');
    } else if (!isTr) {
      return line
        .replace(/DEFAULT=(?:YES|NO)/i, 'DEFAULT=NO')
        .replace(/AUTOSELECT=(?:YES|NO)/i, 'AUTOSELECT=NO');
    }
  }

  return line;
}

export function generateXSp(sp: string): string {
  const n = Math.floor(Date.now() / 1000);
  const r = Math.floor(2176782336 * Math.random()).toString(36);
  let hash = 2166136261;
  const str = `${sp}|${n}|${r}`;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `${n}.${r}.${hash.toString(16)}`;
}

function isHlsPlaylist(abs: string): boolean {
  if (abs.includes('.vtt') || abs.includes('.webvtt')) return false;
  if (abs.includes('/cdn/') || /\/\d+\.txt(?:\?|$)/i.test(abs)) return false;
  return (
    abs.includes('.m3u8') ||
    abs.includes('/q/') ||
    abs.includes('manifest') ||
    abs.includes('/sub') ||
    abs.includes('playlist') ||
    abs.includes('.txt')
  );
}

export function createProxyRouter(): Router {
  const router = Router();

  router.get(['/hls', '/hls/stream.m3u8'], async (req, res) => {
    const targetUrl = typeof req.query.url === 'string' ? req.query.url : null;
    const referer =
      typeof req.query.referer === 'string' ? req.query.referer : undefined;
    const origin =
      typeof req.query.origin === 'string' ? req.query.origin : undefined;
    const sp = typeof req.query.sp === 'string' ? req.query.sp : undefined;
    const audioMode =
      typeof req.query.audio === 'string' ? req.query.audio : undefined;

    if (!targetUrl) {
      res.status(400).send('Missing url parameter');
      return;
    }

    try {
      const xSpHeader = sp
        ? sp.includes('.')
          ? sp
          : generateXSp(sp)
        : undefined;

      const response = await fetch(targetUrl, {
        headers: {
          'user-agent': USER_AGENT,
          ...(referer ? { referer } : {}),
          ...(origin ? { origin } : {}),
          ...(xSpHeader ? { 'x-sp': xSpHeader } : {}),
        },
      });

      if (!response.ok) {
        res
          .status(response.status)
          .send(`Upstream error: ${response.statusText}`);
        return;
      }

      const text = await response.text();
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');

      const baseUrl = new URL(targetUrl);
      const lines = text.split('\n');
      const rewritten = lines
        .map((line) => {
          let currentLine = line;
          const trimmed = currentLine.trim();
          if (!trimmed) return currentLine;

          if (trimmed.startsWith('#EXT-X-MEDIA:TYPE=AUDIO')) {
            currentLine = rewriteAudioTrack(currentLine, audioMode);
          } else if (trimmed.startsWith('#EXT-X-MEDIA:TYPE=SUBTITLES')) {
            currentLine = rewriteSubtitleTrack(currentLine, audioMode);
          }

          if (trimmed.startsWith('#')) {
            return currentLine.replace(
              /URI=["']([^"']+)["']/g,
              (_match, uri) => {
                const abs = new URL(uri, baseUrl).href;
                const proxyPath = isHlsPlaylist(abs)
                  ? '/proxy/hls/stream.m3u8'
                  : '/proxy/segment';
                const params = new URLSearchParams({ url: abs });
                if (referer) params.set('referer', referer);
                if (origin) params.set('origin', origin);
                if (sp) params.set('sp', sp);
                if (audioMode) params.set('audio', audioMode);
                return `URI="${proxyPath}?${params.toString()}"`;
              },
            );
          }

          const abs = new URL(trimmed, baseUrl).href;
          const proxyPath = isHlsPlaylist(abs)
            ? '/proxy/hls/stream.m3u8'
            : '/proxy/segment';
          const params = new URLSearchParams({ url: abs });
          if (referer) params.set('referer', referer);
          if (origin) params.set('origin', origin);
          if (sp) params.set('sp', sp);
          if (audioMode) params.set('audio', audioMode);
          return `${proxyPath}?${params.toString()}`;
        })
        .join('\n');

      res.send(rewritten);
    } catch (error) {
      res
        .status(500)
        .send(error instanceof Error ? error.message : 'Proxy failed');
    }
  });

  router.get('/segment', async (req, res) => {
    const targetUrl = typeof req.query.url === 'string' ? req.query.url : null;
    const referer =
      typeof req.query.referer === 'string' ? req.query.referer : undefined;
    const origin =
      typeof req.query.origin === 'string' ? req.query.origin : undefined;
    const sp = typeof req.query.sp === 'string' ? req.query.sp : undefined;

    if (!targetUrl) {
      res.status(400).send('Missing url parameter');
      return;
    }

    try {
      const xSpHeader = sp
        ? sp.includes('.')
          ? sp
          : generateXSp(sp)
        : undefined;

      const response = await fetch(targetUrl, {
        headers: {
          'user-agent': USER_AGENT,
          ...(referer ? { referer } : {}),
          ...(origin ? { origin } : {}),
          ...(xSpHeader ? { 'x-sp': xSpHeader } : {}),
        },
      });

      if (!response.ok) {
        res
          .status(response.status)
          .send(`Upstream segment error: ${response.statusText}`);
        return;
      }

      const isVtt = targetUrl.includes('.vtt') || targetUrl.includes('.webvtt');
      const contentType = response.headers.get('content-type');
      res.setHeader(
        'Content-Type',
        contentType || (isVtt ? 'text/vtt; charset=utf-8' : 'video/MP2T'),
      );
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=3600');

      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (error) {
      res
        .status(500)
        .send(error instanceof Error ? error.message : 'Segment failed');
    }
  });

  return router;
}
