import type { Stream } from 'stremio-addon-sdk';
import type { ResolvedStream } from '../types/index.js';
import { env } from '../config/env.js';
const labels = {
  'tr-dub': 'Türkçe Dublaj',
  'tr-sub': 'Türkçe Altyazı',
  original: 'Orijinal Dil',
  multi: 'Çoklu Ses',
  unknown: 'Bilinmeyen Dil',
};
export function mapStream(stream: ResolvedStream): Stream {
  const isDub = stream.language === 'tr-dub';
  const isSub = stream.language === 'tr-sub';
  const langLabel = isDub
    ? 'Türkçe Dublaj'
    : isSub
      ? 'Türkçe Altyazı'
      : (labels[stream.language] ?? 'Türkçe');
  const badge = isDub
    ? '🇹🇷 TR Dublaj'
    : isSub
      ? '💬 TR Altyazı'
      : '🇹🇷 TR Stream';

  let filename = 'video';
  try {
    filename = new URL(stream.url).pathname.split('/').pop() ?? 'video';
  } catch {
    /* relative or custom URL */
  }

  let playUrl = stream.url;
  const referer = stream.headers?.referer || stream.headers?.Referer;
  const origin = stream.headers?.origin || stream.headers?.Origin;
  const isProxied = Boolean(referer || origin);

  if (isProxied) {
    const params = new URLSearchParams({ url: stream.url });
    if (referer) params.set('referer', referer);
    if (origin) params.set('origin', origin);
    const sp =
      stream.headers?.['x-sp-key'] ||
      stream.headers?.['x-sp'] ||
      stream.headers?.['X-Sp'];
    if (sp) params.set('sp', sp);
    if (isDub) params.set('audio', 'tr');
    if (isSub) params.set('audio', 'orig');
    playUrl = `http://127.0.0.1:${env.PORT}/proxy/hls/stream.m3u8?${params.toString()}`;
  }

  return {
    url: playUrl,
    name: `${badge}\n${stream.quality}`,
    title: `${stream.providerId.toUpperCase()} • ${stream.quality}\n${langLabel} (${stream.format})\n${stream.sourceLabel}`,
    ...(stream.subtitles?.length ? { subtitles: stream.subtitles } : {}),
    behaviorHints: {
      filename: isProxied ? 'stream.m3u8' : filename,
      ...(stream.behaviorHints ?? {}),
      ...(!isProxied && stream.headers
        ? { proxyHeaders: { request: stream.headers } }
        : {}),
      ...(!isProxied &&
      (stream.format !== 'MP4' || !stream.url.startsWith('https:'))
        ? { notWebReady: true }
        : {}),
    },
  };
}
