import { validateUrl } from './validate-url.js';

export function auditPlayerHtml(html: string, pageUrl: string) {
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const inline = scripts.map((script) => script[2] ?? '').join('\n');
  const scriptHosts = new Set<string>();
  for (const script of scripts) {
    const src = script[1]?.match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2];
    if (!src) continue;
    try {
      const url = new URL(src, pageUrl);
      if (['https:', 'http:'].includes(url.protocol))
        scriptHosts.add(url.hostname);
    } catch {
      /* Diagnostic only. */
    }
  }
  const iframes = [];
  for (const iframe of html.matchAll(
    /<iframe\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi,
  )) {
    try {
      const url = new URL(iframe[2]!.replace(/&amp;/g, '&'), pageUrl);
      if (!['https:', 'http:'].includes(url.protocol)) continue;
      iframes.push({
        host: url.hostname,
        queryKeys: [...new Set(url.searchParams.keys())].slice(0, 20),
        pathSegments: url.pathname.split('/').filter(Boolean).length,
      });
    } catch {
      /* Never report URL/token values. */
    }
  }
  return {
    scriptCount: scripts.length,
    inlineScriptBytes: Buffer.byteLength(inline),
    scriptHosts: [...scriptHosts].slice(0, 20),
    usesFetch: /\bfetch\s*\(|XMLHttpRequest/.test(inline),
    usesPlayerLibrary: /jwplayer|videojs|new\s+Hls\b|new\s+Plyr\b/i.test(
      inline,
    ),
    usesEval: /\beval\s*\(/.test(inline),
    usesBase64: /\batob\s*\(/.test(inline),
    containsMediaLiteral:
      /https?:[^\s"']+\.(?:mp4|m3u8|webm)(?:[?"'\s]|$)/i.test(inline),
    iframeStructure: iframes.slice(0, 5),
    note: 'Script structure only; no execution, token extraction or inference of DRM.',
  };
}

/** Plain HTML media only. No script execution, decoding, cookies or auth tokens. */
export function publicMediaReferences(
  html: string,
  pageUrl: string,
  hosts: readonly string[],
) {
  const visible = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const media: { url: string; format: 'MP4' | 'HLS' | 'WEBM' | 'MOV' }[] = [];
  const embeds: string[] = [];
  const seen = new Set<string>();
  for (const tag of visible.matchAll(
    /<(iframe|video|source)\b[^>]*\bsrc\s*=\s*(["'])(.*?)\2/gi,
  )) {
    try {
      const url = validateUrl(
        new URL(tag[3]!.replace(/&amp;/g, '&'), pageUrl).href,
        hosts,
      );
      // Do not extract or reuse signed/protected playback addresses.
      if (url.search || url.hash || seen.has(url.href)) continue;
      seen.add(url.href);
      if (tag[1]!.toLowerCase() === 'iframe') {
        if (embeds.length < 3) embeds.push(url.href);
        continue;
      }
      const extension = url.pathname
        .match(/\.(mp4|m3u8|webm|mov)$/i)?.[1]
        ?.toLowerCase();
      const format = extension === 'm3u8' ? 'HLS' : extension?.toUpperCase();
      if (
        format &&
        ['MP4', 'HLS', 'WEBM', 'MOV'].includes(format) &&
        media.length < 20
      ) {
        media.push({
          url: url.href,
          format: format as 'MP4' | 'HLS' | 'WEBM' | 'MOV',
        });
      }
    } catch {
      /* Unknown hosts and invalid URLs are not followed. */
    }
  }
  return { media, embeds };
}

/** Keep public page structure for adapter development; omit executable/private fields. */
export function publicPageSnapshot(html: string): string {
  return html
    .replace(/<(script|style|form)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(["'])[\s\S]*?\1/gi, '')
    .replace(
      /\s+(?:value|nonce|data-token|data-key|data-nonce)\s*=\s*(["'])[\s\S]*?\1/gi,
      '',
    )
    .replace(
      /\s+(href|src|data-src)\s*=\s*(["'])([\s\S]*?)\2/gi,
      (_match, attribute: string, quote: string, value: string) => {
        if (/[?#]/.test(value) || /^(?:javascript|data):/i.test(value))
          return '';
        return ` ${attribute}=${quote}${value}${quote}`;
      },
    );
}
