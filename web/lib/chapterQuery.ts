// "dandadan 213" in the search box: a series' title followed by a chapter number (2026-11-18). The palette then offers that chapter
// itself -- read it, or show it in the series' chapter list -- beside the usual series results.
//
// The number is the query's LAST token, optionally introduced by "ch", "ch.", "chap", "chapter", "c" or "#". Ambiguity is real: "Kaiju
// No. 8", "Mob Psycho 100" and "86" end in a number that is part of the title. So the palette keeps every normal result, offers the
// chapter only when the text before the number finds a series on its own, and puts a series whose title IS the whole query first.
//
// Pure, so the rules are unit-tested (test/chapterQuery.test.ts).

export interface ChapterQuery {
  /** The text before the number: what to look the series up by. */
  title: string;
  /** The chapter number asked for (213, 213.5). */
  number: number;
}

const NUMBER_AT_END = /(\d{1,6}(?:\.\d{1,3})?)$/;
/** "ch", "ch.", "chap", "chapter" or "c" just before the number, as its own word. */
const LEAD_IN = /(?:^|\s)(?:ch(?:ap(?:ter)?)?\.?|c)\s*$/i;

/** The title and chapter number a query asks for, or null when it does not end in a number after a title of two characters or more. */
export function parseChapterQuery(q: string): ChapterQuery | null {
  const s = q.trim();
  const m = NUMBER_AT_END.exec(s);
  if (!m) return null;
  let rest = s.slice(0, m.index);
  const lead = LEAD_IN.exec(rest);
  if (lead) rest = rest.slice(0, lead.index);
  // The number must stand on its own: after a space, a '#', a lead-in or punctuation -- never glued to the title ("x1", "dandadan213").
  else if (!/[\s#:,\-–—·.]$/u.test(rest)) return null;
  const title = rest.replace(/[\s#,:\-–—·.]+$/u, '').trim();
  const number = Number(m[1]);
  if (title.replace(/\s+/g, '').length < 2 || !Number.isFinite(number)) return null;
  return { title, number };
}

/** A title folded for comparing: case, accents, punctuation and runs of space set aside. */
export const foldTitle = (s: string): string =>
  s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Whether a series' title (or one of its other names) is the whole query: then the number is part of the title, not a chapter. */
export function titleIsWholeQuery(query: string, titles: ReadonlyArray<string | null | undefined>): boolean {
  const q = foldTitle(query);
  return !!q && titles.some((t) => !!t && foldTitle(t) === q);
}
