// Find similar (fork): series like this one that share at least N of the genres and tags a person picks.
//
// GET /api/series/:id/similar/facets answers the chips (the series' genres and strongest non-spoiler AniList tags), and
// GET /api/series/:id/similar/search?genres=&tags=&min= the series that share at least `min` of the chosen ones. A held
// series is a library card, one the server does not hold is AniList's cover (RelatedOutside), as in Related.
import type { RelatedOutside } from './related';
import type { Series } from './types';

export interface SimilarFacets { lookups: boolean; genres: string[]; tags: Array<{ name: string; rank: number }> }
export interface SimilarHit { anilistId: number; matched: string[]; hits: number; score: number; series?: Series; outside?: RelatedOutside }
export interface SimilarAnswer { lookups: boolean; busy?: boolean; partial?: boolean; total: number; content: SimilarHit[] }

/** The tags chosen when the panel opens: the strongest few. Tags carry the flavour; genres are too coarse to start on. */
export const DEFAULT_TAGS = 6;
/** The share of the chosen chips an answer must carry until the person moves the slider. */
export const DEFAULT_SHARE = 0.6;

export const defaultTags = (f: SimilarFacets | undefined): string[] => (f?.tags ?? []).slice(0, DEFAULT_TAGS).map((t) => t.name);

/** The number of chips an answer must share: the person's choice kept inside 1..total, else most of what is chosen. */
export function effectiveMin(chosen: number, picked: number | null): number {
  if (chosen <= 0) return 1;
  const want = picked ?? Math.ceil(chosen * DEFAULT_SHARE);
  return Math.max(1, Math.min(chosen, want));
}

/** The search's address; names are sorted so the same choice is one cache entry. */
export function searchUrl(seriesId: string, genres: readonly string[], tags: readonly string[], min: number): string {
  const p = new URLSearchParams();
  if (genres.length) p.set('genres', [...genres].sort().join(','));
  if (tags.length) p.set('tags', [...tags].sort().join(','));
  p.set('min', String(min));
  return `/api/series/${encodeURIComponent(seriesId)}/similar/search?${p}`;
}

/** What a card says under the title: how many of the chosen chips it shares, then which. */
export function matchNote(h: SimilarHit, total: number): string {
  return `${h.hits}/${total} · ${h.matched.join(', ')}`;
}
