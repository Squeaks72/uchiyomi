import { t as tr } from '@/lib/i18n';
import { blurb } from '@/lib/blurb';
import { languageName, relativeTime } from '@/lib/format';
import type { Series } from '@/lib/types';

/** What the at-a-glance card of a series shows, whichever wall it was opened from. */
export interface Glance {
  title: string;
  /** The description in full, markup and entities out. Empty when the source gave none. */
  text: string;
  /** The same description cut for the hover on a thumbnail. */
  short: string;
  altTitles: string[];
  genres: string[];
  facts: { label: string; value: string }[];
  /** The library entry whose other names the card may ask the server for (admins only). */
  altFrom?: string;
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Names other than `main`, each once, in the order given. */
export function otherNames(main: string, names: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const n of names) {
    const v = (n ?? '').trim();
    if (v && !same(v, main) && !out.some((o) => same(o, v))) out.push(v);
  }
  return out;
}

function statusWord(s?: string | null): string | null {
  switch ((s ?? '').toUpperCase()) {
    case 'ONGOING': return tr('Ongoing');
    case 'COMPLETED': case 'ENDED': return tr('Completed');
    case 'HIATUS': return tr('Hiatus');
    case 'CANCELLED': case 'ABANDONED': return tr('Cancelled');
    default: return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : null;
  }
}

const fact = (label: string, value: string | number | null | undefined) =>
  value === null || value === undefined || value === '' ? [] : [{ label, value: String(value) }];

/** A series in the library. */
export function glanceOfSeries(s: Series): Glance {
  const m = s.metadata ?? {};
  const title = m.title || s.name;
  const age = m.ageRating && m.ageRating > 0 ? `${m.ageRating}+` : null;
  return {
    title,
    text: blurb(m.summary, Infinity),
    short: blurb(m.summary),
    altTitles: otherNames(title, [s.name]),
    genres: (m.genres ?? []).slice(0, 10),
    facts: [
      ...fact(tr('Status'), statusWord(m.status)),
      ...fact(tr('Author'), m.author),
      ...fact(tr('Publisher'), m.publisher),
      ...fact(tr('Chapters'), s.booksCount || null),
      ...fact(tr('Unread'), s.yomi?.unread || null),
      ...fact(tr('Language'), m.language ? languageName(m.language) : null),
      ...fact(tr('Age rating'), age),
      ...fact(tr('Your rating'), s.yomi?.rating ? `${s.yomi.rating} / 5` : null),
    ],
    altFrom: s.id,
  };
}

/** A title on a source, as Discover lists it. */
export function glanceOfSource(item: {
  title: string; summary?: string; lang?: string | null; updatedAt?: string; rating?: 'adult' | 'safe';
  libraryLangs?: string[]; providerNames?: string[]; providerTitles?: string[];
}): Glance {
  return {
    title: item.title,
    text: blurb(item.summary, Infinity),
    short: blurb(item.summary),
    altTitles: otherNames(item.title, item.providerTitles ?? []),
    genres: [],
    facts: [
      ...fact(tr('Sources'), item.providerNames?.length ? item.providerNames.join(', ') : null),
      ...fact(tr('Language'), item.lang ? languageName(item.lang) : null),
      ...fact(tr('Updated'), item.updatedAt ? relativeTime(item.updatedAt) : null),
      ...fact(tr('Age rating'), item.rating === 'adult' ? '18+' : null),
      ...fact(tr('In your library'), item.libraryLangs?.length ? item.libraryLangs.map((l) => languageName(l)).join(', ') : null),
    ],
  };
}

/** A trending title from AniList. */
export function glanceOfTrending(t: {
  title: string; description: string; genres: string[]; score: number | null; chapters: number | null; status: string | null;
}): Glance {
  return {
    title: t.title,
    text: blurb(t.description, Infinity),
    short: blurb(t.description),
    altTitles: [],
    genres: (t.genres ?? []).slice(0, 10),
    facts: [
      ...fact(tr('Status'), statusWord(t.status)),
      ...fact(tr('Chapters'), t.chapters || null),
      ...fact(tr('Score'), t.score != null ? `${t.score}%` : null),
    ],
  };
}
