// The word on a cover's top-start tag (2026-11-19, the owner: "ecchi series have the ecchi tag, pornhwa has pornhwa").
// The admin's filing beats the format: a series filed in a genre library (kind 'genre', e.g. Ecchi) is tagged with that
// genre, and one in an 18+ library is Hentai or Pornhwa -- by its own format when known (a manhwa on the hentai shelf is
// Pornhwa), else by the library's. Everything else keeps its format (Manga, Manhwa...), then the library's name.
import { keys } from './i18n';
import type { SeriesType } from './types';

export type TagLibrary = { name: string; kind?: string | null; autoGenres?: string[] | null };

/** 'genre' = a genre's own word (shown as the admin wrote it); 'adult' / 'type' = a tr() key; 'library' = its name. */
export type ContentTag = { label: string; kind: 'genre' | 'adult' | 'type' | 'library' };

const [HENTAI, PORNHWA] = keys('Hentai', 'Pornhwa');
const LONG_STRIP: ReadonlySet<SeriesType> = new Set(['manhwa', 'manhua', 'webtoon']);

export function contentTag(type: SeriesType | null | undefined, lib: TagLibrary | null | undefined, typeKey: (t: SeriesType) => string): ContentTag | null {
  const known = type && type !== 'unknown' ? type : null;
  if (lib?.kind === 'genre') {
    const g = lib.autoGenres?.find((x) => x.trim());
    return { label: g ? g.trim() : lib.name, kind: 'genre' };
  }
  if (lib?.kind === 'manga_adult' || lib?.kind === 'webtoon_adult') {
    const strip = known ? LONG_STRIP.has(known) : lib.kind === 'webtoon_adult';
    return { label: strip ? PORNHWA : HENTAI, kind: 'adult' };
  }
  if (known) return { label: typeKey(known), kind: 'type' };
  return lib?.name ? { label: lib.name, kind: 'library' } : null;
}
