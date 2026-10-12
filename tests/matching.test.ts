import { describe, expect, it } from 'vitest';
import {
  cleanMediaTitle,
  generateTitleVariants,
  normalizeTitle,
  scoreTitleMatch,
  similarity,
} from '../src/utils/normalize-title.js';
import { parseId } from '../src/utils/parse-id.js';
import { confidence, selectMatches } from '../src/services/matching-service.js';
import type {
  EpisodeQuery,
  MediaResult,
  MovieQuery,
} from '../src/types/index.js';
const query: MovieQuery = {
  imdbId: 'tt0133093',
  title: 'Matrix',
  originalTitle: 'The Matrix',
  year: 1999,
  alternativeTitles: ['Matris'],
};
const result: MediaResult = {
  providerId: 'fixture',
  title: 'The Matrix',
  year: 1999,
  mediaType: 'movie',
  pageUrl: 'https://example.org/matrix',
  confidence: 1,
};
describe('identity parsing', () => {
  it('parses a movie', () =>
    expect(parseId('movie', 'tt0133093')).toEqual({
      type: 'movie',
      imdbId: 'tt0133093',
    }));
  it('parses season and episode', () =>
    expect(parseId('series', 'tt0903747:1:1')).toEqual({
      type: 'series',
      imdbId: 'tt0903747',
      season: 1,
      episode: 1,
    }));
  it('supports specials season zero', () =>
    expect(parseId('series', 'tt0903747:0:1')?.season).toBe(0));
  it.each([
    'tt123',
    'tt0133093:1:1',
    '../../file',
    '',
    'tt0133093\n',
    'tt123456789012',
  ])('rejects malformed movie %s', (id) =>
    expect(parseId('movie', id)).toBeNull(),
  );
  it.each([
    'tt0903747',
    'tt0903747:1:0',
    'tt0903747:01:1',
    'tt0903747:-1:2',
    'tt0903747:1:2:3',
  ])('rejects malformed episode %s', (id) =>
    expect(parseId('series', id)).toBeNull(),
  );
  it('rejects non-string inputs and unsupported types', () => {
    expect(parseId('movie', {})).toBeNull();
    expect(parseId('channel', 'tt0133093')).toBeNull();
  });
});
describe('matching', () => {
  it('normalizes Turkish, Unicode, punctuation and case', () => {
    expect(normalizeTitle('  IŞIK: Çığ, ÖĞÜT! ')).toBe('isik cig ogut');
    expect(normalizeTitle('Işık')).toBe(normalizeTitle('Is\u0327ık'));
  });
  it('gives exact external ID highest confidence', () =>
    expect(confidence(query, { ...result, externalId: query.imdbId })).toBe(1));
  it('uses localized title and year', () =>
    expect(confidence(query, { ...result, title: 'MATRIX!' })).toBe(0.97));
  it('matches original or alternative title and year', () => {
    expect(confidence(query, result)).toBe(0.94);
    expect(confidence(query, { ...result, title: 'Matris' })).toBe(0.94);
  });
  it('rejects another IMDb ID despite title similarity', () =>
    expect(confidence(query, { ...result, externalId: 'tt0234215' })).toBe(0));
  it('rejects wrong year', () =>
    expect(confidence(query, { ...result, year: 2003 })).toBe(0));
  it('never promotes title-only guesses', () =>
    expect(
      selectMatches(query, [{ ...result, year: undefined }], 0.88, 0.06),
    ).toEqual([]));
  it('rejects uncertain candidates', () =>
    expect(
      selectMatches(
        query,
        [result, { ...result, pageUrl: 'https://example.org/other' }],
        0.88,
        0.06,
      ),
    ).toEqual([]));
  it('calculates fuzzy similarity', () => {
    expect(similarity('The Matrx', 'The Matrix')).toBeGreaterThan(0.8);
    expect(similarity('Alien', 'The Matrix')).toBeLessThan(0.5);
  });
  it('requires exact season and episode even for IMDb match', () => {
    const episode: EpisodeQuery = {
      imdbId: 'tt0903747',
      seriesTitle: 'Breaking Bad',
      season: 1,
      episode: 1,
    };
    expect(
      confidence(episode, {
        ...result,
        mediaType: 'series',
        externalId: episode.imdbId,
        season: 1,
        episode: 2,
      }),
    ).toBe(0);
    expect(
      confidence(episode, {
        ...result,
        mediaType: 'series',
        externalId: episode.imdbId,
        season: 1,
        episode: 1,
      }),
    ).toBe(1);
  });
  it('cleans stream site buzzwords and matches series episodes without year', () => {
    const episode: EpisodeQuery = {
      imdbId: 'tt1196946',
      seriesTitle: 'The Mentalist',
      season: 2,
      episode: 1,
    };
    expect(cleanMediaTitle('The Mentalist 2. Sezon 1. Bölüm izle')).toBe(
      'mentalist',
    );
    expect(
      confidence(episode, {
        providerId: 'fixture',
        title: 'The Mentalist 2. Sezon 1. Bölüm izle',
        mediaType: 'series',
        season: 2,
        episode: 1,
        pageUrl: 'https://example.org/ep',
        confidence: 0,
      }),
    ).toBeGreaterThanOrEqual(0.88);
  });
  it('cleans movie titles with Turkish dubbing and quality suffixes', () => {
    const movieQ: MovieQuery = {
      imdbId: 'tt1375666',
      title: 'Inception',
      year: 2010,
      alternativeTitles: [],
    };
    expect(
      cleanMediaTitle('Inception (2010) 1080p Türkçe Dublaj Full HD izle'),
    ).toBe('inception');
    expect(
      confidence(movieQ, {
        providerId: 'fixture',
        title: 'Inception (2010) 1080p Türkçe Dublaj Full HD izle',
        year: 2010,
        mediaType: 'movie',
        pageUrl: 'https://example.org/movie',
        confidence: 0,
      }),
    ).toBeGreaterThanOrEqual(0.88);
  });
  it('generates canonical title variants without leading articles', () => {
    const variants = generateTitleVariants('The Mentalist');
    expect(variants).toContain('The Mentalist');
    expect(variants).toContain('Mentalist');
  });
  it('generates variants for Roman numerals, subtitles, hyphens, and ampersands', () => {
    const duneVariants = generateTitleVariants('Dune: Part Two');
    expect(duneVariants).toContain('Dune: Part 2');
    expect(duneVariants).toContain('Dune Part Two');
    expect(duneVariants).toContain('Dune');

    const spiderVariants = generateTitleVariants('Spider-Man: No Way Home');
    expect(spiderVariants).toContain('Spider Man: No Way Home');
    expect(spiderVariants).toContain('Spiderman: No Way Home');
    expect(spiderVariants).toContain('Spider-Man');

    const fastVariants = generateTitleVariants('Fast & Furious');
    expect(fastVariants).toContain('Fast and Furious');
  });
  it('tolerates 1-year discrepancy for regional releases while rejecting larger gaps', () => {
    const movieQ: MovieQuery = {
      imdbId: 'tt15239678',
      title: 'Dune: Part Two',
      year: 2024,
      alternativeTitles: ['Dune 2'],
    };
    // 2023 vs 2024 (e.g. premiere vs commercial release) -> accepted (>= 0.88)
    expect(
      confidence(movieQ, {
        providerId: 'fixture',
        title: 'Dune: Part Two',
        year: 2023,
        mediaType: 'movie',
        pageUrl: 'https://example.org/dune2',
        confidence: 0,
      }),
    ).toBeGreaterThanOrEqual(0.88);

    // 2020 vs 2024 -> rejected (0)
    expect(
      confidence(movieQ, {
        providerId: 'fixture',
        title: 'Dune: Part Two',
        year: 2020,
        mediaType: 'movie',
        pageUrl: 'https://example.org/dune2',
        confidence: 0,
      }),
    ).toBe(0);
  });
  it('matches Turkish alternative titles with site noise suffixes', () => {
    const movieQ: MovieQuery = {
      imdbId: 'tt0468569',
      title: 'The Dark Knight',
      year: 2008,
      alternativeTitles: ['Kara Şövalye'],
    };
    expect(
      confidence(movieQ, {
        providerId: 'fixture',
        title: 'Kara Şövalye 1080p Türkçe Dublaj izle',
        year: 2008,
        mediaType: 'movie',
        pageUrl: 'https://example.org/dark-knight',
        confidence: 0,
      }),
    ).toBeGreaterThanOrEqual(0.88);
  });
  it('scoreTitleMatch gives high scores to exact matches and distinguishes spin-offs', () => {
    expect(scoreTitleMatch('Dexter', 'Dexter')).toBe(1);
    expect(scoreTitleMatch('dexter-izle', 'Dexter')).toBeGreaterThanOrEqual(
      0.95,
    );
    // Dexter vs Dexter: Original Sin should have significantly lower score
    const mainScore = scoreTitleMatch('dexter', 'Dexter');
    const spinOffScore = scoreTitleMatch('dexter-original-sin', 'Dexter');
    expect(mainScore).toBeGreaterThan(spinOffScore);
  });
});
