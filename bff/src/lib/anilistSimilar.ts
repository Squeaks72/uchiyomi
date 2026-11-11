// Find similar (fork): "series like this one, matching at least N of these genres and tags".
//
// More like this leads with what AniList's readers recommend and falls back on ANY of the series' first three genres, which
// for a series like Dandadan (Action, Comedy, Supernatural...) is most of the catalogue. This lets a person choose which of
// the series' genres and tags matter and how many of them an answer must share. Genres are coarse (about twenty); the tags
// (Youkai, Aliens, Ghost...) carry the flavour, each with a 0-100 rank for how strongly readers say it applies.
//
// AniList cannot filter on "at least N of these", so a pool is asked per chosen tag (the fifty most popular manga carrying
// it) and the overlap is counted here. A pool is kept six hours: moving the slider or toggling a chip asks nothing. This is
// the one place a person's click asks AniList (the rest of the app reads tables the background tick fills): it goes through
// the server's one AniList quota as a lookup someone waits on, so a busy quota answers `busy` rather than queueing.
//
// Who sees what is decided per viewer, as for Related: a series the server holds is the library's (when the viewer may list
// it), one it does not is AniList's cover and words, and 18+ entries follow adultOk.
import { fetchAniListFacets, fetchAniListFacetPool, type AniListFacets, type FacetItem } from './anilist';
import { adultOk, heldEntry, isOneShot, shownHeld, similarTarget, type OutsideWork } from './anilistRelated';
import { libraryIndex } from './discoverIdentity';
import { browsableIds, type ViewCtx } from './visibility';

/** A series' facets are kept a day; a pool six hours. Both bounded: a long-lived server must not grow without end. */
const FACETS_TTL_MS = 24 * 60 * 60_000;
const POOL_TTL_MS = 6 * 60 * 60_000;
const CACHE_MAX = 300;
/** Most pools one search asks for: the series' strongest tags first. */
const MAX_POOLS = 6;
/** Most chips a search may select, and most answers returned. */
export const MAX_SELECTED = 14;
export const MAX_RESULTS = 36;
/** The tags offered on the chips: the strongest, spoilers never named. */
const OFFERED_TAGS = 16;

export interface Selection { genres: string[]; tags: string[] }
export interface FacetsAnswer { genres: string[]; tags: Array<{ name: string; rank: number }> }
export interface SimilarHit {
  anilistId: number;
  /** The genres and tags this answer shares with the series, among the ones chosen. */
  matched: string[];
  /** How many of the chosen chips it shares (`matched.length`) and how many were chosen. */
  hits: number;
  score: number;
  /** Set when the server holds it; otherwise `outside` is AniList's cover and words. */
  seriesId?: string;
  outside?: OutsideWork;
}

// ---- scoring (pure) ----------------------------------------------------------------------------------------------

const norm = (s: string) => s.trim().toLowerCase();

export interface Scored { item: FacetItem; matched: string[]; hits: number; score: number }

/**
 * The pool's entries that share at least `min` of the chosen genres and tags with the series, best first. A genre counts
 * 1 (and is also met by a tag of that name: the library's own genres are not always AniList's); a tag counts the weaker of the two ranks (a tag the series barely has, or the candidate barely has, is a weak match).
 * Each chip is weighted by how rare it is in the pool (a tag every candidate has says little), so a shared "Youkai" outranks
 * a shared "Male Protagonist". Most chips shared first, then score, then the community score. Pure.
 */
export function scorePool(target: AniListFacets, sel: Selection, pool: readonly FacetItem[], min: number, selfId: number): Scored[] {
  const genreKeys = new Map(sel.genres.map((g) => [norm(g), g]));
  const targetRank = new Map(target.tags.map((t) => [norm(t.name), t.rank]));
  const tagKeys = new Map(sel.tags.map((t) => [norm(t), t]));
  const total = genreKeys.size + tagKeys.size;
  if (!total) return [];
  const need = Math.max(1, Math.min(total, Math.floor(min) || 1));
  const items = [...new Map(pool.filter((p) => p.id !== selfId).map((p) => [p.id, p])).values()];
  const df = new Map<string, number>();
  const hitsOf = (it: FacetItem) => {
    const out: Array<{ key: string; label: string; w: number }> = [];
    const have = new Set([...it.genres, ...it.tags.map((t) => t.name)].map(norm));
    for (const [k, label] of genreKeys) if (have.has(k)) out.push({ key: `g:${k}`, label, w: 1 });
    const tags = new Map(it.tags.map((t) => [norm(t.name), t.rank]));
    for (const [k, label] of tagKeys) {
      const r = tags.get(k);
      if (r !== undefined) out.push({ key: `t:${k}`, label, w: Math.min(r, targetRank.get(k) ?? r) / 100 });
    }
    return out;
  };
  const all = items.map((it) => ({ it, hits: hitsOf(it) }));
  for (const { hits } of all) for (const h of hits) df.set(h.key, (df.get(h.key) ?? 0) + 1);
  const n = all.length;
  return all
    .filter(({ hits }) => hits.length >= need)
    .map(({ it, hits }) => ({
      item: it,
      matched: hits.map((h) => h.label),
      hits: hits.length,
      score: hits.reduce((a, h) => a + h.w * (1 + Math.log((n + 1) / ((df.get(h.key) ?? 0) + 1))), 0),
    }))
    .sort((a, b) => b.hits - a.hits || b.score - a.score || (b.item.score ?? 0) - (a.item.score ?? 0) || a.item.id - b.item.id);
}

// ---- asking AniList (cached) -------------------------------------------------------------------------------------

function kept<T>(m: Map<string, { at: number; v: T }>, key: string, ttl: number): T | undefined {
  const e = m.get(key);
  if (!e) return undefined;
  if (Date.now() - e.at > ttl) { m.delete(key); return undefined; }
  return e.v;
}
function keep<T>(m: Map<string, { at: number; v: T }>, key: string, v: T): T {
  if (m.size >= CACHE_MAX) m.delete(m.keys().next().value as string);
  m.set(key, { at: Date.now(), v });
  return v;
}
const facetCache = new Map<string, { at: number; v: AniListFacets | null }>();
const poolCache = new Map<string, { at: number; v: FacetItem[] }>();
/** Test hook: forget what was kept. */
export function resetSimilarCache(): void { facetCache.clear(); poolCache.clear(); }

async function facetsOf(anilistId: number): Promise<AniListFacets | null> {
  const k = String(anilistId);
  const hit = kept(facetCache, k, FACETS_TTL_MS);
  if (hit !== undefined) return hit;
  return keep(facetCache, k, await fetchAniListFacets(anilistId));
}

/** AniList's genres, then the ones the library's own copy of the series carries that AniList does not name (any case). */
export function withOwn(anilist: readonly string[], own: readonly string[]): string[] {
  const seen = new Set(anilist.map(norm));
  const extra = own.map((g) => g.trim()).filter((g) => g && g.length <= 40 && !seen.has(norm(g)) && seen.add(norm(g)));
  return [...anilist, ...extra];
}

/** The chips a series page offers: its genres and its strongest tags that do not spoil the story. `lookups: false` as Related. */
export async function similarFacets(seriesId: string, own: readonly string[] = []): Promise<{ lookups: boolean; facets: FacetsAnswer | null }> {
  const t = await similarTarget(seriesId);
  if (!t) return { lookups: false, facets: null };
  const f = await facetsOf(t.anilistId);
  if (!f) return { lookups: true, facets: null };
  return {
    lookups: true,
    facets: {
      genres: withOwn(f.genres, own),
      tags: f.tags.filter((x) => !x.spoiler).slice(0, OFFERED_TAGS).map(({ name, rank }) => ({ name, rank })),
    },
  };
}

export interface SimilarAnswer { lookups: boolean; busy?: boolean; partial?: boolean; total: number; content: SimilarHit[] }

/**
 * Series like this one for this viewer that share at least `min` of the chosen chips. Chips the series does not carry are
 * ignored (a request is checked against the series' own facets, never trusted). `busy` when AniList's quota had no room for
 * even one pool; `partial` when it ran out part-way and the answer is built from the pools that arrived.
 */
export async function similarFor(seriesId: string, sel: Selection, min: number, ctx: ViewCtx, own: readonly string[] = []): Promise<SimilarAnswer> {
  const t = await similarTarget(seriesId);
  if (!t) return { lookups: false, total: 0, content: [] };
  let facets: AniListFacets | null;
  try { facets = await facetsOf(t.anilistId); } catch { return { lookups: true, busy: true, total: 0, content: [] }; }
  if (!facets) return { lookups: true, total: 0, content: [] };
  const offered = withOwn(facets.genres, own);
  const genres = [...new Set(sel.genres.map(norm))].map((g) => offered.find((x) => norm(x) === g)).filter((x): x is string => !!x);
  const tags = [...new Set(sel.tags.map(norm))].map((n) => facets!.tags.find((x) => norm(x.name) === n && !x.spoiler)).filter((x): x is NonNullable<typeof x> => !!x);
  const chosen: Selection = { genres: genres.slice(0, MAX_SELECTED), tags: tags.map((x) => x.name).slice(0, MAX_SELECTED) };
  const total = chosen.genres.length + chosen.tags.length;
  if (!total) return { lookups: true, total: 0, content: [] };

  const showAdult = adultOk({ adult: true }, ctx);
  const asks = tags.length
    ? [...tags].sort((a, b) => b.rank - a.rank).slice(0, MAX_POOLS).map((x) => ({ key: `t:${x.name}`, by: { tag: x.name } }))
    // A genre AniList does not list (the library's own, "Shounen") is asked as a tag of that name instead.
    : chosen.genres.slice(0, MAX_POOLS).map((g) => (facets!.genres.some((x) => norm(x) === norm(g))
      ? { key: `g:${g}`, by: { genre: g } } : { key: `t:${g}`, by: { tag: g } }));
  const pool: FacetItem[] = [];
  let got = 0;
  let partial = false;
  for (const a of asks) {
    const key = `${a.key}|${showAdult ? 1 : 0}`;
    let items = kept(poolCache, key, POOL_TTL_MS);
    if (!items) {
      try { items = keep(poolCache, key, await fetchAniListFacetPool(a.by, showAdult)); } catch { partial = true; continue; }
    }
    got++;
    pool.push(...items);
  }
  if (!got) return { lookups: true, busy: true, total, content: [] };

  const scored = scorePool(facets, chosen, pool, min, t.anilistId).filter((s) => adultOk(s.item, ctx));
  const idx = await libraryIndex(ctx);
  const heldOf = scored.map((s) => heldEntry(idx, s.item));
  const shown = await browsableIds(heldOf.flat().map((h) => h.id), ctx);
  const content: SimilarHit[] = [];
  const listed = new Set<string>();
  scored.forEach((s, i) => {
    if (content.length >= MAX_RESULTS) return;
    const h = shownHeld(heldOf[i], seriesId, t.work, shown);
    // A held one the viewer may not list is dropped, never named; the series itself and its editions likewise.
    if (h === null) return;
    const base = { anilistId: s.item.id, matched: s.matched, hits: s.hits, score: Math.round(s.score * 100) / 100 };
    if (h) {
      if (listed.has(h.id)) return;
      listed.add(h.id);
      content.push({ ...base, seriesId: h.id });
      return;
    }
    const it = s.item;
    if (isOneShot(it)) return;
    content.push({ ...base, outside: { anilistId: it.id, title: it.title, cover: it.cover, format: it.format, status: it.status, score: it.score } });
  });
  return { lookups: true, ...(partial ? { partial: true } : {}), total, content };
}
