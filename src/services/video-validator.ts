import type { ProviderPolicy, ResolvedStream } from '../types/index.js';
import { effectiveExpiry, validateUrl } from '../utils/validate-url.js';
import { safeHttp, type HttpTransport } from '../utils/safe-http.js';
import { parseMasterPlaylist, qualityRank } from './quality-service.js';
import { generateXSp } from '../utils/hls-proxy.js';
const mimeFormats: Record<string, ResolvedStream['format']> = {
  'video/mp4': 'MP4',
  'application/vnd.apple.mpegurl': 'HLS',
  'application/x-mpegurl': 'HLS',
  'audio/mpegurl': 'HLS',
  'audio/x-mpegurl': 'HLS',
  'video/webm': 'WEBM',
  'video/quicktime': 'MOV',
};
export class VideoValidator {
  constructor(private readonly http: HttpTransport = safeHttp) {}
  private async playlist(
    url: string,
    policy: ProviderPolicy,
    signal: AbortSignal,
    depth = 0,
    headers?: Record<string, string>,
  ): Promise<{
    url: string;
    quality?: ResolvedStream['quality'];
    codec?: string;
  }> {
    if (depth > 2) throw new Error('PLAYLIST_DEPTH_EXCEEDED');
    const requestHeaders = headers
      ? {
          ...headers,
          ...(headers['x-sp-key']
            ? { 'x-sp': generateXSp(headers['x-sp-key']) }
            : {}),
        }
      : undefined;
    const playlist = await this.http(url, policy.allowedHosts, {
      signal,
      timeoutMs: policy.timeoutMs,
      minIntervalMs: policy.minRequestIntervalMs,
      maxBytes: 262144,
      headers: requestHeaders,
    });
    if (playlist.status !== 200) throw new Error('PLAYLIST_UNAVAILABLE');
    const text = Buffer.from(playlist.body).toString('utf8');
    const hasEncryption =
      /#EXT-X-(?:KEY|SESSION-KEY):[^\n]*METHOD=(?!NONE)[^,\s]+/i.test(text);
    if (hasEncryption) {
      const isClearKeyAllowed =
        policy.allowClearKey &&
        !/#EXT-X-(?:KEY|SESSION-KEY):[^\n]*METHOD=(?!NONE|AES-128)[^,\s]+/i.test(
          text,
        );
      if (!isClearKeyAllowed) {
        throw new Error('ENCRYPTED_PLAYLIST_UNSUPPORTED');
      }
    }
    for (const line of text.split(/\r?\n/)) {
      const uris = line.startsWith('#')
        ? [...line.matchAll(/URI="([^"]+)"/g)].map((m) => m[1]!)
        : line.trim()
          ? [line.trim()]
          : [];
      for (const uri of uris)
        validateUrl(new URL(uri, playlist.url).href, policy.allowedHosts);
    }
    const variants = parseMasterPlaylist(text).sort(
      (a, b) => qualityRank[b.quality] - qualityRank[a.quality],
    );
    if (variants[0]) {
      const chosen = variants[0];
      const child = await this.playlist(
        new URL(chosen.uri, playlist.url).href,
        policy,
        signal,
        depth + 1,
        headers,
      );
      return {
        url: child.url,
        quality: child.quality ?? chosen.quality,
        codec: child.codec ?? chosen.codec,
      };
    }
    if (!/#EXTINF:/m.test(text)) throw new Error('EMPTY_MEDIA_PLAYLIST');
    return { url: playlist.url };
  }
  async validate(
    input: ResolvedStream,
    policy: ProviderPolicy,
    signal: AbortSignal,
  ): Promise<ResolvedStream> {
    validateUrl(input.url, policy.allowedHosts);
    const expiresAt = effectiveExpiry(input.url, input.expiresAt);
    if (expiresAt && expiresAt <= Date.now() + 30000)
      throw new Error('STREAM_EXPIRED');
    const headers = input.headers
      ? {
          ...input.headers,
          ...(input.headers['x-sp-key']
            ? { 'x-sp': generateXSp(input.headers['x-sp-key']) }
            : {}),
        }
      : undefined;
    const options = {
      signal,
      timeoutMs: policy.timeoutMs,
      minIntervalMs: policy.minRequestIntervalMs,
      headers,
    };
    let response = await this.http(input.url, policy.allowedHosts, {
      ...options,
      method: 'HEAD',
      maxBytes: 0,
    });
    let mime = String(response.headers['content-type'] ?? '')
      .split(';')[0]!
      .toLowerCase();
    if (
      [405, 501].includes(response.status) ||
      (response.status >= 200 && response.status < 300 && !mimeFormats[mime])
    ) {
      response = await this.http(input.url, policy.allowedHosts, {
        ...options,
        range: 'bytes=0-511',
        maxBytes: 512,
        truncate: true,
      });
      mime = String(response.headers['content-type'] ?? '')
        .split(';')[0]!
        .toLowerCase();
      if (!mimeFormats[mime]) {
        const data = Buffer.from(response.body);
        if (data.subarray(4, 8).toString() === 'ftyp' && mime !== 'text/html')
          mime = 'video/mp4';
        else if (data.toString('utf8').trimStart().startsWith('#EXTM3U'))
          mime = 'application/vnd.apple.mpegurl';
      }
    }
    if (response.status < 200 || response.status >= 300 || !mimeFormats[mime])
      throw new Error('VIDEO_UNAVAILABLE');
    const format = mimeFormats[mime]!;
    if (format !== input.format) throw new Error('MEDIA_FORMAT_MISMATCH');
    const finalExpiry = effectiveExpiry(response.url, expiresAt);
    if (finalExpiry && finalExpiry <= Date.now() + 30000)
      throw new Error('STREAM_EXPIRED');
    const stream: ResolvedStream = {
      ...input,
      url: response.url,
      format,
      expiresAt: finalExpiry,
      quality: input.qualityEvidence ? input.quality : 'Unknown',
    };
    const subtitles = await Promise.allSettled(
      stream.subtitles.map(async (subtitle) => {
        validateUrl(subtitle.url, policy.allowedHosts);
        const result = await this.http(subtitle.url, policy.allowedHosts, {
          ...options,
          maxBytes: 262144,
        });
        const text = Buffer.from(result.body)
          .toString('utf8')
          .replace(/^\uFEFF/, '')
          .trimStart();
        const mime = String(result.headers['content-type'] ?? '').split(';')[0];
        const supportedMime = [
          'text/vtt',
          'text/plain',
          'application/x-subrip',
          'application/octet-stream',
        ].includes(mime ?? '');
        if (
          result.status !== 200 ||
          !supportedMime ||
          (!text.startsWith('WEBVTT') &&
            !/^\d+\r?\n\d{2}:\d{2}:\d{2},\d{3}\s+-->/.test(text))
        )
          throw new Error('INVALID_SUBTITLE');
        const expiresAt = effectiveExpiry(result.url);
        if (expiresAt && expiresAt <= Date.now() + 30000)
          throw new Error('SUBTITLE_EXPIRED');
        return { ...subtitle, url: result.url, expiresAt };
      }),
    );
    const validSubtitles = subtitles.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const subtitleExpiry = Math.min(
      ...validSubtitles.map((subtitle) => subtitle.expiresAt ?? Infinity),
    );
    if (Number.isFinite(subtitleExpiry))
      stream.expiresAt = Math.min(stream.expiresAt ?? Infinity, subtitleExpiry);
    stream.subtitles = validSubtitles.map(({ id, lang, url }) => ({
      id,
      lang,
      url,
    }));
    if (format === 'HLS') {
      const playlist = await this.playlist(
        response.url,
        policy,
        signal,
        0,
        input.headers,
      );
      // Keep master playlist URL so players retain audio tracks, subtitles, and adaptive streaming
      stream.url = response.url;
      stream.expiresAt = effectiveExpiry(playlist.url, stream.expiresAt);
      if (stream.expiresAt && stream.expiresAt <= Date.now() + 30000)
        throw new Error('STREAM_EXPIRED');
      if (playlist.quality) {
        stream.quality = playlist.quality;
        stream.qualityEvidence = 'playlist';
        stream.codec = playlist.codec;
      }
    }
    return stream;
  }
}
