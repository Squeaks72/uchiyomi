// Where an Automatic add files a new series (2026-11-18, libraries.kind + auto_genres, Admin -> Libraries -> "Automatic adding").
//
// A library says what Automatic may put in it: series of a kind (manga or manhwa/manhua/webtoon, adult or not), series with one of its
// genres ('genre': Ecchi -> the ecchi library), anything ("Any", null: the fallback), or nothing ('ignore'). The order an add asks in:
//   1. an adult series: the first library for its adult kind -- before the genres, so an adult title tagged Ecchi lands with the adult ones;
//   2. a genre library one of its genres names;
//   3. the first library for its kind;
//   4. otherwise the add's own choice (the library around the source's folder, else the default) -- unless that library is set to
//      'ignore', when it is the first "Any" library that is not.
// A library set to 'ignore' is never picked by Automatic, whichever step would have picked it. An add that names a library is never moved.
import { one, q } from './db';
import { typeFromGenres, typeFromLanguage } from './seriesTypeSignals';
import { adultSourceSeries } from './ageRating';
import { adultFilter } from './visibility';

export const LIBRARY_KINDS = ['manga', 'manga_adult', 'webtoon', 'webtoon_adult'] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

const fold = (g: string) => g.trim().toLowerCase();

/** The kind of library a series belongs in, by what its source says of it: its genres, its language, its content rating, its source. */
export async function kindOfSeries(
  series: { genres?: readonly unknown[] | null; contentRating?: string | null } | null | undefined,
  o: { lang?: string | null; sourceAdult?: boolean } = {},
): Promise<LibraryKind> {
  const genres = Array.isArray(series?.genres) ? series!.genres : [];
  const type = typeFromGenres(genres)?.type ?? typeFromLanguage(o.lang ?? null);
  const webtoon = type === 'manhwa' || type === 'manhua' || type === 'webtoon';
  const lists = await adultFilter().catch(() => ({ genres: [] as string[], sources: [] as string[] }));
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

/** The first genre library one of these genres names, or null. */
export async function firstLibraryForGenres(genres: readonly unknown[] | null | undefined): Promise<string | null> {
  const have = new Set((Array.isArray(genres) ? genres : []).filter((g): g is string => typeof g === 'string').map(fold));
  if (!have.size) return null;
  const libs = await q<{ id: string; auto_genres: string[] | null }>(
    `SELECT id, auto_genres FROM libraries WHERE kind = 'genre' AND owner_user_id IS NULL AND NOT managed_private ORDER BY sort_order, name`).catch(() => []);
  return libs.find((l) => (l.auto_genres ?? []).some((g) => have.has(fold(g))))?.id ?? null;
}

/** Where Automatic files this series, by the steps above; null leaves the add's own choice. */
export async function automaticLibraryFor(
  series: { genres?: readonly unknown[] | null; contentRating?: string | null } | null | undefined,
  o: { lang?: string | null; sourceAdult?: boolean },
): Promise<string | null> {
  const kind = await kindOfSeries(series, o);
  if (kind === 'manga_adult' || kind === 'webtoon_adult') {
    const adult = await firstLibraryOfKind(kind);
    if (adult) return adult;
  }
  return (await firstLibraryForGenres(series?.genres)) ?? (await firstLibraryOfKind(kind));
}

/** Whether Automatic may file into this library (not set to 'ignore'). */
export async function automaticMayUse(libraryId: string): Promise<boolean> {
  const r = await one<{ kind: string | null }>('SELECT kind FROM libraries WHERE id = $1', [libraryId]).catch(() => null);
  return r?.kind !== 'ignore';
}

/** Instead of a library set to 'ignore': the default library if it may be used, else the first "Any" library that may; null when none. */
export async function automaticFallback(): Promise<string | null> {
  const r = await one<{ id: string }>(
    `SELECT id FROM libraries WHERE kind IS NULL AND owner_user_id IS NULL AND NOT managed_private ORDER BY (id = 'lib') DESC, sort_order, name LIMIT 1`).catch(() => null);
  return r?.id ?? null;
}
