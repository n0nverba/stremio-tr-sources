/** Bounded diagnostics, not a general HTML parser or media resolver. */
export function sameSeriesEpisodes<T extends { url: string }>(
  seriesUrl: string,
  episodes: T[],
): T[] {
  const series = new URL(seriesUrl);
  const parts = series.pathname.split('/').filter(Boolean);
  const slug = parts.at(-1);
  if (!slug) return [];
  return episodes.filter(({ url }) => {
    const candidate = new URL(url);
    if (candidate.origin !== series.origin) return false;
    if (parts[0] === 'dizi')
      return candidate.pathname.startsWith(
        `${series.pathname.replace(/\/$/, '')}/sezon/`,
      );
    const episodeSlug =
      candidate.pathname.split('/').filter(Boolean).at(-1) ?? '';
    return (
      episodeSlug.startsWith(`${slug}-`) &&
      /\d+-sezon.*\d+-bolum/i.test(episodeSlug)
    );
  });
}

export function inspectPublicPage(
  html: string,
  baseUrl: string,
  status: number,
  linkLimit = 150,
) {
  const limit = Math.max(1, Math.min(10000, Math.floor(linkLimit) || 150));
  const title = (html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '')
    .replace(/<[^>]*>/g, '')
    .trim()
    .slice(0, 300);
  const securityWidgetPresent = /cf-chl-|cf-turnstile|g-recaptcha/i.test(html);
  // A widget/script on a normal page is not proof that the page is blocked.
  const challengeDetected =
    /^(just a moment|attention required|access denied|verify you are human)/i.test(
      title,
    ) ||
    (status !== 200 && securityWidgetPresent);
  const visible = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  const catalogLinks: { text: string; url: string }[] = [];
  const episodeLinks: {
    text: string;
    url: string;
    season: number;
    episode: number;
  }[] = [];
  const seen = new Set<string>();
  for (const match of visible.matchAll(
    /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    try {
      const url = new URL(match[2]!, baseUrl);
      if (
        url.origin !== new URL(baseUrl).origin ||
        url.search ||
        url.hash ||
        url.username ||
        url.password
      )
        continue;
      if (
        !/\/(?:dizi|film|series|movie|diziler)\//i.test(url.pathname) &&
        !/\d+-sezon.*\d+-bolum/i.test(url.pathname)
      )
        continue;
      const text = match[3]!
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
      if (!text || seen.has(url.href)) continue;
      seen.add(url.href);
      const coordinates =
        url.pathname.match(/\/sezon\/(\d+)\/bolum\/(\d+)(?:\/|$)/i) ??
        url.pathname.match(/(\d+)-sezon[-/].*?(\d+)-bolum/i);
      if (coordinates) {
        if (episodeLinks.length >= limit) continue;
        episodeLinks.push({
          text,
          url: url.href,
          season: Number(coordinates[1]),
          episode: Number(coordinates[2]),
        });
      } else if (catalogLinks.length < limit)
        catalogLinks.push({ text, url: url.href });
    } catch {
      /* Ignore malformed links; never request them. */
    }
  }
  const playerHosts = new Set<string>();
  const mediaFormats = new Set<string>();
  // Only observe explicit HTML media elements, without extracting script tokens.
  for (const tag of visible.matchAll(
    /<(?:iframe|video|source)\b[^>]*\bsrc\s*=\s*(["'])(.*?)\1/gi,
  )) {
    try {
      const source = new URL(tag[2]!, baseUrl);
      if (!['http:', 'https:'].includes(source.protocol)) continue;
      playerHosts.add(source.hostname);
      const extension = source.pathname.match(/\.(mp4|m3u8|webm|mov)$/i)?.[1];
      if (extension) mediaFormats.add(extension.toLowerCase());
    } catch {
      /* No request is made to a media/iframe URL. */
    }
  }
  return {
    title,
    challengeDetected,
    securityWidgetPresent,
    catalogLinks,
    episodeLinks,
    playerHosts: [...playerHosts].slice(0, 20),
    mediaFormats: [...mediaFormats],
    imdbIds: [...new Set(visible.match(/\btt\d{7,10}\b/g) ?? [])].slice(0, 20),
    videoElementCount: (visible.match(/<video\b/gi) ?? []).length,
    iframeCount: (visible.match(/<iframe\b/gi) ?? []).length,
  };
}
