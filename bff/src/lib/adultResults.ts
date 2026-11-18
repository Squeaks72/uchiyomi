// Show 18+ off, wherever sources are searched or browsed (2026-11-18): one judgement of each RESULT, instead of hiding whole sources.
//
// Most general aggregators' extensions declare themselves NSFW because they host some adult titles, so hiding every such source left
// almost nothing to search, while a source left in -- and every "add a source" search, which skipped the filter -- showed explicit
// results. Now only sources the admin rated adult are left out whole (lib/visibility.ts sourceBrowsableFor), and each result is judged:
//
//   adult  its source is on the admin's 18+ list, MangaDex rates it erotica/pornographic, a genre is on the admin's 18+ list or the
//          built-in explicit list below, or its title carries an explicit word;
//   safe   MangaDex rates it safe/suggestive, its genres are known and none is adult -- or the same title is in this library outside
//          the 18+ filter (the evidence a self-declared NSFW source's unlabelled results need);
//   else   unknown: shown from an ordinary source, hidden from a source that declares itself NSFW. Strict on purpose: a few real titles
//          only such sites carry go unseen, and explicit ones do not slip through. Discover's multi-source cards also count a title
//          carried by any ordinary source as safe (lib/searchAll.ts cardRating).
import { q } from './db';
import { ratingOf, type AdultLists, type Judged } from './searchAll';
import { nameKey } from './onlineMatch';
import { adultFilter, browsable, Params, SYSTEM_CTX, type ViewCtx } from './visibility';

/** Genres that mean 18+ whatever the admin's own list holds. */
const EXPLICIT_GENRES = new Set(['hentai', 'smut', 'pornographic', 'porn', 'erotica', 'adult', '18+', 'r-18', 'r18', 'nsfw', 'doujinshi (18+)']);
/** Words in a title that mean 18+. Whole words, so "Pornographer's Daughter" style false hits stay rare and "Adultery" does not match. */
const EXPLICIT_WORDS = /\b(?:hentai|porn|xxx|nsfw|r-?18|futanari|uncensored|ero[- ]?manga)\b/i;

type Item = { title?: string; genres?: string[]; contentRating?: string };
type Src = { id?: string; isNsfw?: boolean } | null | undefined;

/** One result's rating by every signal it carries itself (ratingOf, plus the explicit genres and title words). */
export function judgeResult(item: Item, src: Src, lists: AdultLists): Judged | undefined {
  const genres = (Array.isArray(item.genres) ? item.genres : []).filter((g): g is string => typeof g === 'string').map((g) => g.trim().toLowerCase());
  if (genres.some((g) => EXPLICIT_GENRES.has(g))) return 'adult';
  if (item.title && EXPLICIT_WORDS.test(item.title)) return 'adult';
  return ratingOf(item as any, src, lists);
}

let safeCache: { at: number; keys: Set<string> } | null = null;
/** The title keys of every series in the library outside the 18+ filter (as a viewer with Show 18+ off would see it). Cached a few minutes. */
export async function safeLibraryTitles(): Promise<Set<string>> {
  if (safeCache && Date.now() - safeCache.at < 5 * 60_000) return safeCache.keys;
  const lists = await adultFilter().catch(() => ({ genres: [] as string[], sources: [] as string[] }));
  const ctx: ViewCtx = { ...SYSTEM_CTX, hideAdultLibraries: true, adultGenres: lists.genres, adultSources: lists.sources };
  const p = new Params();
  const rows = await q<{ title: string }>(`SELECT s.title FROM lib_series s WHERE ${browsable('s', ctx, p)}`, p.values as any[]).catch(() => []);
  const keys = new Set(rows.map((r) => nameKey(r.title)).filter(Boolean));
  safeCache = { at: Date.now(), keys };
  return keys;
}

/** The judge for one search, with the library's safe titles folded in: what lib/searchAll.ts's Rated.of takes. */
export async function resultJudge(): Promise<(item: Item, src: Src) => Judged | undefined> {
  const [lists, safe] = await Promise.all([adultFilter(), safeLibraryTitles()]);
  return (item, src) => {
    const j = judgeResult(item, src, lists);
    return (j === undefined || j === 'flagged') && item.title && safe.has(nameKey(item.title)) ? 'safe' : j;
  };
}

/** One source's results with Show 18+ off: the adult ones out, and an unknown one out when its source declares itself NSFW. */
export async function tameResults<T extends Item>(items: T[], src: Src): Promise<T[]> {
  const judge = await resultJudge();
  return items.filter((r) => {
    const j = judge(r, src);
    return j === 'safe' || (j === undefined && !src?.isNsfw);
  });
}
