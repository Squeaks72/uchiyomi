// The copies of one chapter this server holds, as the series page lists them under the chapter (mangadot-style version rows).
//
// A chapter's ENDORSED copy is its lib_books file: what the scanner indexed, what the source priority and an admin's Replace
// chose, and what anyone gets who has picked nothing. Other sources' copies are kept beside it (bff lib/bookVersionsRead.ts,
// GET /api/series/:id/kept `held`). Which one an account reads is, in order: its pick for this chapter (`picks`, PUT
// /api/books/:id/my-version), its source for the series (`mySource`), the endorsed copy -- and a pick whose copy is not kept
// falls back to the endorsed one, as the server does.
//
// Pure, so the rules are unit-tested (test/chapterCopies.test.ts).
import { matchesGroup, ALL_GROUPS } from './groupFilter';

/** The pick that means "the endorsed file", even when the account reads the series from another source (bff ENDORSED_KEY). */
export const ENDORSED_PICK = '@endorsed';
/** The reserved source key of a colored edition that is its own title on a source (bff COLORED_KEY). */
export const COLORED_SOURCE = '@colored';

export interface KeptCopy { sourceId: string; pages: number; scanlator?: string | null }

export interface ChapterCopy {
  /** The kept copy's source, or null for the endorsed copy. */
  sourceId: string | null;
  /** The source's display name, or null when it is unknown (a file that arrived some other way). */
  sourceName: string | null;
  /** The group that released this copy, as its source said; null when it did not. */
  group: string | null;
  pages: number;
  /** The lib_books file: the copy Uchiyomi endorses. */
  endorsed: boolean;
  /** The series' colored edition. */
  colored: boolean;
  /** The copy this account is served for the chapter. Exactly one per chapter. */
  reading: boolean;
}

export interface CopyContext {
  /** Source id -> display name. */
  names: Record<string, string>;
  coloredSource: string | null;
  /** The display name of a colored edition kept under COLORED_SOURCE (its source's name). */
  coloredName?: string | null;
  mySource: string | null;
  /** This account's pick for this chapter, if any. */
  pick?: string | null;
}

/** Every copy of a chapter the server holds: the endorsed one first, then the kept ones by source name. */
export function copiesOf(
  book: { sourceId?: string | null; scanlator?: string | null; media: { pagesCount: number } },
  kept: ReadonlyArray<KeptCopy> | undefined,
  ctx: CopyContext,
): ChapterCopy[] {
  const others = (kept ?? []).filter((k) => k.sourceId && k.sourceId !== book.sourceId);
  const want = ctx.pick ?? ctx.mySource;
  const servedKept = want && want !== ENDORSED_PICK ? others.find((k) => k.sourceId === want)?.sourceId ?? null : null;
  const nameOf = (id: string) => (id === COLORED_SOURCE ? ctx.coloredName || ctx.names[id] || null : ctx.names[id] ?? null);
  const endorsed: ChapterCopy = {
    sourceId: null,
    sourceName: book.sourceId ? nameOf(book.sourceId) : null,
    group: book.scanlator ?? null,
    pages: book.media.pagesCount,
    endorsed: true,
    colored: !!ctx.coloredSource && ctx.coloredSource !== COLORED_SOURCE && book.sourceId === ctx.coloredSource,
    reading: servedKept === null,
  };
  const rest = others
    .map((k): ChapterCopy => ({
      sourceId: k.sourceId,
      sourceName: nameOf(k.sourceId),
      group: k.scanlator ?? null,
      pages: k.pages,
      endorsed: false,
      colored: k.sourceId === ctx.coloredSource,
      reading: k.sourceId === servedKept,
    }))
    .sort((a, b) => (a.sourceName ?? '').localeCompare(b.sourceName ?? ''));
  return [endorsed, ...rest];
}

/**
 * What to send to PUT /api/books/:id/my-version to read `copy`: null whenever the series' own choice already serves it, so
 * a reader who never strays from it stores nothing; otherwise the copy's source, or ENDORSED_PICK for the endorsed file.
 */
export function pickFor(copy: ChapterCopy, mySource: string | null, keptSources: ReadonlyArray<string>): string | null {
  const seriesServes = mySource && keptSources.includes(mySource) ? mySource : null;
  if (copy.endorsed) return seriesServes ? ENDORSED_PICK : null;
  return copy.sourceId === seriesServes ? null : copy.sourceId;
}

/** The copies a group filter leaves: all of them for ALL_GROUPS, else those released by the group. */
export function copiesForGroup(copies: ReadonlyArray<ChapterCopy>, group: string): ChapterCopy[] {
  return group === ALL_GROUPS ? [...copies] : copies.filter((c) => matchesGroup({ scanlator: c.group }, group));
}
