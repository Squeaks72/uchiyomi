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
import type { VersionCopy } from './types';

/** The pick that means "the endorsed file", even when the account reads the series from another source (bff ENDORSED_KEY). */
export const ENDORSED_PICK = '@endorsed';
/** The reserved source key of a colored edition that is its own title on a source (bff COLORED_KEY). */
export const COLORED_SOURCE = '@colored';

export interface KeptCopy { sourceId: string; pages: number; scanlator?: string | null; stamped?: boolean }

export interface ChapterCopy {
  /** The kept or listed copy's source, or null for the endorsed copy. */
  sourceId: string | null;
  /**
   * False for a copy a source lists that this server does not hold yet: pressing it downloads it beside the endorsed one
   * (POST /api/series/:id/versions/fetch), then reads it.
   */
  held: boolean;
  /** The source's display name, or null when it is unknown (a file that arrived some other way). */
  sourceName: string | null;
  /** The group that released this copy, as its source said; null when it did not. */
  group: string | null;
  /** The chapter's title as this copy's source lists it ("Spell 34: The Return"); null when the listing has none. */
  title: string | null;
  pages: number;
  /** The lib_books file: the copy Uchiyomi endorses. */
  endorsed: boolean;
  /** The series' colored edition. */
  colored: boolean;
  /** The copy this account is served for the chapter. Exactly one per chapter. */
  reading: boolean;
  /** Its source stamped a banner or logo on its pages (bff lib/edgeMarks.ts). Unknown, and false, for a copy not on the server. */
  stamped?: boolean;
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
  /** The endorsed file carries a source's stamp. */
  stampedEndorsed?: boolean;
}

/**
 * A group name as a source gave it, or null for none. Sources send blanks for "no group" -- an empty string, or a lone zero-width
 * space (Comick does) -- which would otherwise draw an empty tag.
 */
export function cleanGroup(g: string | null | undefined): string | null {
  const t = (g ?? '').replace(/[\u200b-\u200d\u2060\ufeff]/g, '').trim();
  return t || null;
}

/** A listed copy's group: its scanlator, else its groups joined as the server joins a joint release. */
const groupOfCopy = (c: Pick<VersionCopy, 'scanlator' | 'groups'>): string | null =>
  cleanGroup(c.scanlator) ?? cleanGroup((c.groups ?? []).map((g) => cleanGroup(g)).filter(Boolean).join(' & '));

/**
 * The group and source of the file on disk: what the file says, else the listed copy the server matched it to (`onDisk`; for a
 * file that arrived with no stamp, the copy the series chose). The tag beside a chapter's title.
 */
export function endorsedOrigin(
  book: { sourceId?: string | null; scanlator?: string | null },
  listed: ReadonlyArray<VersionCopy> | undefined,
): { sourceId: string | null; group: string | null } {
  const disk = (listed ?? []).find((c) => c.onDisk);
  return {
    sourceId: book.sourceId ?? disk?.source ?? null,
    group: cleanGroup(book.scanlator) ?? (disk ? groupOfCopy(disk) : null),
  };
}

/**
 * Every copy of a chapter: the endorsed one first, then the kept ones and the listed ones not held, by source name. A listed copy is
 * offered only from a source with no copy here already (a kept copy is one per source), and never in another language than the
 * series' (one the server would never take).
 */
export function copiesOf(
  book: { sourceId?: string | null; scanlator?: string | null; chapterName?: string | null; media: { pagesCount: number } },
  kept: ReadonlyArray<KeptCopy> | undefined,
  ctx: CopyContext,
  listed?: ReadonlyArray<VersionCopy>,
): ChapterCopy[] {
  const origin = endorsedOrigin(book, listed);
  // A copy's title is its source's listing entry's: the endorsed file's is the copy it was matched to, a kept copy's its source's.
  const titleBy = new Map<string, string>();
  for (const c of listed ?? []) { const t = (c.title ?? '').trim(); if (c.source && t && !titleBy.has(c.source)) titleBy.set(c.source, t); }
  const disk = (listed ?? []).find((c) => c.onDisk);
  const titleOf = (sid: string | null) => (sid ? titleBy.get(sid) ?? null : null);
  const others = (kept ?? []).filter((k) => k.sourceId && k.sourceId !== origin.sourceId);
  const want = ctx.pick ?? ctx.mySource;
  const servedKept = want && want !== ENDORSED_PICK ? others.find((k) => k.sourceId === want)?.sourceId ?? null : null;
  const nameOf = (id: string) => (id === COLORED_SOURCE ? ctx.coloredName || ctx.names[id] || null : ctx.names[id] ?? null);
  const endorsed: ChapterCopy = {
    sourceId: null,
    held: true,
    sourceName: origin.sourceId ? nameOf(origin.sourceId) : null,
    group: origin.group,
    title: (disk?.title ?? '').trim() || titleOf(origin.sourceId) || book.chapterName?.trim() || null,
    pages: book.media.pagesCount,
    endorsed: true,
    colored: !!ctx.coloredSource && ctx.coloredSource !== COLORED_SOURCE && origin.sourceId === ctx.coloredSource,
    reading: servedKept === null,
    stamped: !!ctx.stampedEndorsed,
  };
  const rest = others
    .map((k): ChapterCopy => ({
      sourceId: k.sourceId,
      held: true,
      sourceName: nameOf(k.sourceId),
      group: cleanGroup(k.scanlator),
      title: titleOf(k.sourceId),
      pages: k.pages,
      endorsed: false,
      colored: k.sourceId === ctx.coloredSource,
      reading: k.sourceId === servedKept,
      stamped: !!k.stamped,
    }));
  const taken = new Set<string>([...(origin.sourceId ? [origin.sourceId] : []), ...others.map((k) => k.sourceId)]);
  const offered: ChapterCopy[] = [];
  for (const c of listed ?? []) {
    if (c.onDisk || !c.source || taken.has(c.source) || c.otherLanguage) continue;
    taken.add(c.source);
    offered.push({
      sourceId: c.source, held: false, sourceName: c.sourceName || nameOf(c.source), group: groupOfCopy(c), title: (c.title ?? '').trim() || null, pages: c.pages ?? 0,
      endorsed: false, colored: c.source === ctx.coloredSource, reading: false,
    });
  }
  // Held before offered, each by source name: what can be read now comes first.
  const byName = (a: ChapterCopy, b: ChapterCopy) => (a.sourceName ?? '').localeCompare(b.sourceName ?? '');
  return [endorsed, ...rest.sort(byName), ...offered.sort(byName)];
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
