import { z } from 'zod';
import type { ParsedId } from '../types/index.js';
const typeSchema = z.enum(['movie', 'series']);
const idSchema = z.string().max(64);
export function parseId(type: unknown, id: unknown): ParsedId | null {
  const checkedType = typeSchema.safeParse(type);
  const checkedId = idSchema.safeParse(id);
  if (!checkedType.success || !checkedId.success) return null;
  if (checkedType.data === 'movie') {
    return /^tt\d{7,10}$/.test(checkedId.data)
      ? { type: 'movie', imdbId: checkedId.data }
      : null;
  }
  const match = /^(tt\d{7,10}):(0|[1-9]\d{0,2}):([1-9]\d{0,3})$/.exec(
    checkedId.data,
  );
  return match
    ? {
        type: 'series',
        imdbId: match[1]!,
        season: Number(match[2]),
        episode: Number(match[3]),
      }
    : null;
}
