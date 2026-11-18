// What a library is for (2026-11-18, libraries.kind): an Automatic add files a series into the first library of the series' kind --
// manga or manhwa/manhua/webtoon, adult or not -- instead of the default library. Libraries with no kind are "any".
import { one } from './db';
import { typeFromGenres, typeFromLanguage } from './seriesTypeSignals';
import { adultSourceSeries } from './ageRating';
import { adultFilter } from './visibility';

export const LIBRARY_KINDS = ['manga', 'manga_adult', 'webtoon', 'webtoon_adult'] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

/** The kind of library a series belongs in, by what its source says of it: its genres, its language, its content rating, its source. */
export async function kindOfSeries(
  series: { genres?: readonly unknown[] | null; contentRating?: string | null } | null | undefined,
  o: { lang?: string | null; sourceAdult?: boolean } = {},
): Promise<LibraryKind> {
  const genres = Array.isArray(series?.genres) ? series!.genres : [];
  const type = typeFromGenres(genres)?.type ?? typeFromLanguage(o.lang ?? null);
  const webtoon = type === 'manhwa' || type === 'manhua' || type === 'webtoon';
  const lists = await adultFilter().catch(() => ({ genres: [] as string[], sources: [] as string[] }));
  const fold = (g: string) => g.trim().toLowerCase();
  const adultGenres = new Set(lists.genres.map(fold));
  const adult = !!o.sourceAdult || adultSourceSeries(series ?? null)
    || genres.some((g) => typeof g === 'string' && adultGenres.has(fold(g)));
  return webtoon ? (adult ? 'webtoon_adult' : 'webtoon') : (adult ? 'manga_adult' : 'manga');
}

/** The first shared library of that kind (by the libraries' order), or null when none is set up for it. */
export async function firstLibraryOfKind(kind: LibraryKind): Promise<string | null> {
  const r = await one<{ id: string }>(
    `SELECT id FROM libraries WHERE kind = $1 AND owner_user_id IS NULL AND NOT managed_private ORDER BY sort_order, name LIMIT 1`, [kind]).catch(() => null);
  return r?.id ?? null;
}
