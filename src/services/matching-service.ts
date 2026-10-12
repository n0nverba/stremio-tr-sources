import type { EpisodeQuery, MediaResult, MovieQuery } from '../types/index.js';
import {
  cleanMediaTitle,
  normalizeTitle,
  similarity,
} from '../utils/normalize-title.js';
export function confidence(
  query: MovieQuery | EpisodeQuery,
  result: MediaResult,
): number {
  const episode = 'seriesTitle' in query;
  if (result.mediaType !== (episode ? 'series' : 'movie')) return 0;
  if (
    episode &&
    (result.season !== query.season || result.episode !== query.episode)
  )
    return 0;
  if (
    result.externalId &&
    /^tt\d+$/.test(result.externalId) &&
    result.externalId !== query.imdbId
  )
    return 0;
  if (result.externalId === query.imdbId) return 1;
  const yearDiff =
    query.year && result.year ? Math.abs(query.year - result.year) : undefined;
  if (yearDiff !== undefined && yearDiff > 1) return 0;

  const yearExact = yearDiff === 0;
  const yearClose = yearDiff === 1;
  const yearOrEpisode = yearExact || (episode && !result.year);

  const primary = episode ? query.seriesTitle : query.title;
  const alternatives = [
    query.originalTitle,
    ...(query.alternativeTitles ?? []),
  ].filter((s): s is string => Boolean(s));
  const exactPrimary =
    !!primary && normalizeTitle(primary) === normalizeTitle(result.title);
  const exactAlternate = alternatives.some(
    (t) => normalizeTitle(t) === normalizeTitle(result.title),
  );

  if (exactPrimary) {
    if (yearOrEpisode) return 0.97;
    if (yearClose) return 0.93;
    return 0.78;
  }
  if (exactAlternate) {
    if (yearOrEpisode) return 0.94;
    if (yearClose) return 0.9;
    return 0.76;
  }

  // Cleaned title matching (strips "izle", "dublaj", "sezon", "1080p", "the", etc.)
  const primaryClean = cleanMediaTitle(primary || '');
  const resultClean = cleanMediaTitle(result.title || '');
  const exactCleanPrimary =
    !!primaryClean && !!resultClean && primaryClean === resultClean;
  const exactCleanAlternate = alternatives.some((t) => {
    const c = cleanMediaTitle(t);
    return !!c && !!resultClean && c === resultClean;
  });

  if (exactCleanPrimary) {
    if (yearOrEpisode) return 0.96;
    if (yearClose) return 0.92;
    return 0.78;
  }
  if (exactCleanAlternate) {
    if (yearOrEpisode) return 0.93;
    if (yearClose) return 0.89;
    return 0.76;
  }

  // Substring containment after cleaning across primary and all alternatives
  const allCandidatesClean = [
    primaryClean,
    ...alternatives.map(cleanMediaTitle),
  ].filter((c): c is string => Boolean(c) && c.length >= 4);

  for (const c of allCandidatesClean) {
    if (
      resultClean.length >= 4 &&
      (resultClean.includes(c) || c.includes(resultClean))
    ) {
      const lenRatio =
        Math.min(c.length, resultClean.length) /
        Math.max(c.length, resultClean.length);
      if (lenRatio >= 0.7) {
        if (yearOrEpisode) return 0.91;
        if (yearClose) return 0.88;
        return 0.72;
      }
    }
  }

  const fuzzy = Math.max(
    0,
    ...[primary, ...alternatives]
      .filter(Boolean)
      .map((t) =>
        Math.max(
          similarity(t, result.title),
          similarity(cleanMediaTitle(t), resultClean),
        ),
      ),
  );
  if (yearOrEpisode) return 0.9 * fuzzy;
  if (yearClose) return 0.85 * fuzzy;
  return 0.7 * fuzzy;
}
export function selectMatches(
  query: MovieQuery | EpisodeQuery,
  results: MediaResult[],
  threshold: number,
  margin: number,
): MediaResult[] {
  const ranked = results
    .map((result) => ({ ...result, confidence: confidence(query, result) }))
    .filter((result) => result.confidence >= threshold)
    .sort((a, b) => b.confidence - a.confidence);
  const first = ranked[0];
  if (!first) return [];
  const rival = ranked.find(
    (item) =>
      (item.externalId ?? item.pageUrl) !== (first.externalId ?? first.pageUrl),
  );
  if (
    first.confidence < 1 &&
    rival &&
    first.confidence - rival.confidence < margin
  )
    return [];
  return ranked.filter(
    (item) =>
      (item.externalId ?? item.pageUrl) === (first.externalId ?? first.pageUrl),
  );
}
