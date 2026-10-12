import type {
  Quality,
  ResolvedStream,
  LanguagePreference,
} from '../types/index.js';
export const qualityRank: Record<Quality, number> = {
  '2160p': 4,
  '1080p': 3,
  '720p': 2,
  '480p': 1,
  Unknown: 0,
};
export function qualityFromHeight(height: number): Quality {
  return height >= 2160
    ? '2160p'
    : height >= 1080
      ? '1080p'
      : height >= 720
        ? '720p'
        : height >= 480
          ? '480p'
          : 'Unknown';
}
export function parseMasterPlaylist(text: string) {
  if (!text.trimStart().startsWith('#EXTM3U'))
    throw new Error('INVALID_PLAYLIST');
  const variants: {
    uri: string;
    quality: Quality;
    codec?: string;
  }[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const resolution = /RESOLUTION=\d+x(\d+)/i.exec(line);
    const codec = /CODECS="([^"]+)"/i.exec(line)?.[1];
    const uri = lines
      .slice(i + 1)
      .find((l) => l.trim() && !l.startsWith('#'))
      ?.trim();
    if (uri)
      variants.push({
        uri,
        quality: resolution
          ? qualityFromHeight(Number(resolution[1]))
          : 'Unknown',
        codec,
      });
  }
  return variants;
}
export function arrangeStreams(
  streams: ResolvedStream[],
  language: LanguagePreference,
  quality: 'highest' | 'lowest',
): ResolvedStream[] {
  const target = language.endsWith('dub') ? 'tr-dub' : 'tr-sub';
  const filtered = language.startsWith('only-')
    ? streams.filter((s) => s.language === target)
    : streams;
  const unique = [
    ...new Map(filtered.map((s) => [`${s.url}::${s.language}`, s])).values(),
  ];
  return unique.sort((a, b) => {
    const preference = language.startsWith('prefer-')
      ? Number(b.language === target) - Number(a.language === target)
      : 0;
    if (preference) return preference;
    // Unknown quality always comes last.
    if (a.quality === 'Unknown' || b.quality === 'Unknown')
      return Number(a.quality === 'Unknown') - Number(b.quality === 'Unknown');
    return (
      (quality === 'highest' ? -1 : 1) *
      (qualityRank[a.quality] - qualityRank[b.quality])
    );
  });
}
