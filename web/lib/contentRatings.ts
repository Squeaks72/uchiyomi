/**
 * Admin → Settings → Content ratings (fork change), the part with no React in it so a test can hold the rules: the counts
 * the "Who may open it" group quotes, the source list's order and filter, and the numbers under "Downloads & politeness".
 *
 * The rating itself is lib/sourceAge.ts's (null = the extension's own flag, 0 = all ages, 10-17 = youngest account in, 18 =
 * adult); this only reads it.
 */
import { effectiveAge, type AgeFacts } from './sourceAge';

/** Members who have an age cap at all (the member's `max_age_rating`; null is "no cap"). */
export function cappedMembers(users: ReadonlyArray<{ max_age_rating?: number | null }> | undefined): number {
  return (users ?? []).filter((u) => u.max_age_rating !== null && u.max_age_rating !== undefined).length;
}

/** Libraries that carry a rating (`age_rating`; null is "unrated"). */
export function ratedLibraries(libs: ReadonlyArray<{ age_rating?: number | null }> | undefined): number {
  return (libs ?? []).filter((l) => l.age_rating !== null && l.age_rating !== undefined).length;
}

/**
 * "{rated} sources rated, {adult} count as 18+": `rated` is the sources an admin has rated (0 = all ages included, since
 * that is a choice too), `adult` is every source held to 18 now, whether by a rating or by its extension's flag.
 */
export function ratingSummary(sources: ReadonlyArray<AgeFacts> | undefined): { rated: number; adult: number } {
  const list = sources ?? [];
  return {
    rated: list.filter((s) => s.ageRating !== null && s.ageRating !== undefined).length,
    adult: list.filter((s) => effectiveAge(s) === 18).length,
  };
}

/**
 * The order of the rating list: what an admin has decided first, then what an extension decided for them, then the rest, each
 * group by name. A hundred extension sources is a long list, and the ones worth looking at are the ones that are not default.
 */
export function ratingOrder<T extends AgeFacts & { name: string }>(sources: readonly T[]): T[] {
  const rank = (s: AgeFacts): number => (s.ageRating !== null && s.ageRating !== undefined ? 0 : s.defaultAgeRating ? 1 : 2);
  return [...sources].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The list narrowed by what was typed: a name or an id, case-blind. An empty box is every source. */
export function filterByName<T extends { name: string; id: string }>(sources: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q ? sources.filter((s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)) : [...sources];
}

// ---- GET /api/admin/limits ----------------------------------------------------------------------------------------------

export interface Limit { key: string; value: number; unit: 'count' | 'ms' | 'bytes' | 'files' }

/** How a limit is said: a plain number, seconds, or gigabytes -- which the component then puts in the reader's words. */
export function limitParts(l: Pick<Limit, 'value' | 'unit'>): { kind: 'plain' | 's' | 'gb'; n: string } {
  const round = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  if (l.unit === 'ms') return { kind: 's', n: round(l.value / 1000) };
  if (l.unit === 'bytes') return { kind: 'gb', n: round(l.value / 2 ** 30) };
  return { kind: 'plain', n: String(l.value) };
}
