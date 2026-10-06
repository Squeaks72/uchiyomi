// An age rating the admin sets on a whole source (Admin -> Sources -> a source -> Age rating).
//
// Suwayomi flags whole extensions (`isNsfw`), which says "can carry adult titles", not how adult the site is. This
// is the admin's own word, per source: 0 means all ages (and overrides the extension's flag), 1-17 is the youngest
// account allowed in, 18 is adult. Nothing stored means the default -- 18 for a flagged extension, unrated otherwise.
//
// Held in memory because `sourceAllowedFor` is synchronous and called from about forty places. Loaded at boot and
// refreshed whenever the 18+ filter lists are re-read (lib/visibility.ts adultFilter), so a stale copy heals itself.
// Keys are lowercased, as the adult source list is; the stored shape is {"sw:123": 13}.
import { one, q } from './db';

export const ADULT_AGE = 18;
export const MAX_SOURCE_AGE = 18;

let ratings = new Map<string, number>();

const key = (id: string) => id.trim().toLowerCase();

/** What a stored value may hold: id -> whole number 0..18, ids of the shape the registry writes. Anything else is dropped. */
export function cleanSourceRatings(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [id, n] of Object.entries(v as Record<string, unknown>)) {
    if (!/^[\p{L}\p{N}_.:\-]{1,120}$/u.test(id)) continue;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_SOURCE_AGE) continue;
    out[key(id)] = n;
  }
  return out;
}

/** Replace the in-memory copy (boot, and each re-read of the settings). */
export function applySourceRatings(stored: unknown): void {
  ratings = new Map(Object.entries(cleanSourceRatings(stored)));
}

/** The admin's rating for a source, or undefined when it has none. */
export function sourceRatingOverride(id: string | null | undefined): number | undefined {
  return id ? ratings.get(key(id)) : undefined;
}

/**
 * The age a source is held to, or null when it is unrated: the admin's rating when there is one (0 reads unrated),
 * otherwise 18 for an extension that declares itself adult.
 */
export function effectiveAgeRating(src: { id?: string; isNsfw?: boolean } | null | undefined): number | null {
  const o = sourceRatingOverride(src?.id);
  if (o !== undefined) return o > 0 ? o : null;
  return src?.isNsfw ? ADULT_AGE : null;
}

/** Whether the source is adult by every signal about the SOURCE (not its titles): the admin's rating, else the flag. */
export const isAdultSource = (src: { id?: string; isNsfw?: boolean } | null | undefined): boolean =>
  (effectiveAgeRating(src) ?? 0) >= ADULT_AGE;

/** Ids rated 18 by the admin, and ids the admin cleared below 18 (their extension's flag no longer counts). Lowercased. */
export function ratedAdultIds(): string[] { return [...ratings].filter(([, n]) => n >= ADULT_AGE).map(([id]) => id); }
export function clearedIds(): string[] { return [...ratings].filter(([, n]) => n < ADULT_AGE).map(([id]) => id); }

export async function loadSourceRatings(): Promise<void> {
  const row = await one<{ source_ratings: unknown }>('SELECT source_ratings FROM server_settings WHERE id = 1');
  applySourceRatings(row?.source_ratings);
}

/** Set (or, with null, clear) one source's rating, and keep the in-memory copy in step. */
export async function setSourceRating(id: string, age: number | null): Promise<void> {
  const k = key(id);
  if (age === null) {
    await q(`UPDATE server_settings SET source_ratings = source_ratings - $1::text, updated_at = now() WHERE id = 1`, [k]);
    ratings.delete(k);
  } else {
    await q(`UPDATE server_settings SET source_ratings = source_ratings || jsonb_build_object($1::text, $2::int), updated_at = now() WHERE id = 1`, [k, age]);
    ratings.set(k, age);
  }
}
