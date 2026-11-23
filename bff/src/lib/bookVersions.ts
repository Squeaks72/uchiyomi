// Keeping another source's copy of a chapter (the write side of lib/bookVersionsRead.ts, which says what a kept copy is).
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { q, one } from './db';
import { DL_ROOT } from './library';
import { getSource, withTimeout } from './sources';
import { downloadChapter } from './downloader';
import { seriesSourcesFor } from './seriesSources';
import { numKey } from './postingOrder';
import { versionsFolder, COLORED_KEY } from './bookVersionsRead';
export * from './bookVersionsRead';

/** A pass's chapter listings, by source and the source's own series id: filled by the first chapter that needs one. */
export type ListingCache = Map<string, Promise<Awaited<ReturnType<NonNullable<ReturnType<typeof getSource>>['listChapters']>>>>;
const LIST_TIMEOUT_MS = 60_000;

export type KeepResult = 'kept' | 'already' | 'is_endorsed' | 'no_book' | 'not_followed' | 'not_listed';

/**
 * Fetch one source's copy of one chapter and keep it beside the endorsed one. The source must be followed by the series
 * (its own or an extra, lib/seriesSources.ts) and list the chapter. A copy the endorsed file already is -- the source the
 * endorsed chapter came from -- is not stored twice. Throws what the downloader throws.
 */
export async function keepVersion(seriesId: string, number: number, sourceId: string, listings?: ListingCache): Promise<KeepResult> {
  const s = await one<{ folder: string; title: string; colored_ref_source: string | null; colored_ref_series: string | null }>(
    'SELECT folder, title, colored_ref_source, colored_ref_series FROM lib_series WHERE id = $1', [seriesId]);
  if (!s) return 'no_book';
  const book = await one<{ id: string; source_id: string | null }>(
    `SELECT id, source_id FROM lib_books WHERE series_id = $1 AND number = $2 AND pruned_at IS NULL ORDER BY file LIMIT 1`, [seriesId, number]);
  if (!book) return 'no_book';
  // The colored edition may be a title on a source the series already follows: it is fetched from that source's own id for it, and kept
  // under the reserved key, so it is never "the endorsed copy" and never collides with the source's own copy of the original.
  const colored = sourceId === COLORED_KEY;
  if (!colored && book.source_id === sourceId) return 'is_endorsed';
  if (await one('SELECT 1 FROM lib_book_versions WHERE book_id = $1 AND source_id = $2', [book.id, sourceId])) return 'already';
  const follow = colored ? undefined : (await seriesSourcesFor(seriesId)).find((x) => x.sourceId === sourceId);
  const fetchFrom = colored ? s.colored_ref_source : sourceId;
  const sourceSeriesId = colored ? s.colored_ref_series : follow?.sourceSeriesId;
  const adapter = fetchFrom ? getSource(fetchFrom) : null;
  if ((!colored && !follow) || !sourceSeriesId || !adapter || !fetchFrom) return 'not_followed';
  // One listing per (source, series) for a whole pass when the caller passes a cache: a 1000-chapter series is otherwise 1000 listing calls.
  const lkey = `${fetchFrom}|${sourceSeriesId}`;
  let all = listings?.get(lkey);
  if (!all) {
    const fresh = withTimeout(adapter.listChapters(sourceSeriesId), LIST_TIMEOUT_MS);
    listings?.set(lkey, fresh);
    all = fresh;
  }
  const listed = (await all).filter((c) => numKey(c.number) === numKey(number));
  const chapter = listed[0];
  if (!chapter) return 'not_listed';
  const folder = versionsFolder(s.folder, sourceId);
  const got = await downloadChapter({ sourceId: fetchFrom, seriesFolder: folder, chapter, meta: { series: s.title } }, { replace: true });
  if (!got) return 'already';
  const abs = join(DL_ROOT, got.file);
  const st = await stat(abs).catch(() => null);
  await q(
    `INSERT INTO lib_book_versions (book_id, source_id, file, root, pages, scanlator, published_at, size)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (book_id, source_id) DO UPDATE SET file = EXCLUDED.file, pages = EXCLUDED.pages, scanlator = EXCLUDED.scanlator,
       published_at = EXCLUDED.published_at, size = EXCLUDED.size`,
    [book.id, sourceId, got.file, DL_ROOT, got.pages, chapter.scanlator ?? null, chapter.publishedAt ?? null, st && st.isFile() ? st.size : null]);
  return 'kept';
}

/** One chapter of a colored edition's own title, as its source lists it (lib_series.colored_ref_listing). */
export interface ColoredListed { sourceId: string; number: number; title: string | null; scanlator: string | null; groups: string[]; pages: number | null; publishedAt: string | null }

/**
 * Read a colored edition's own title's chapter list from its source and keep it on the series (colored_ref_listing): only the list --
 * numbers, titles, groups, pages -- so the series page shows a colored version under every chapter it has, at once. Downloads are the
 * version keeper's, at its own pace. Answers how many chapters were listed, or null when the series has no such edition or the source
 * did not answer (the previous list stands).
 */
export async function refreshColoredListing(seriesId: string): Promise<number | null> {
  const s = await one<{ colored_source: string | null; colored_ref_source: string | null; colored_ref_series: string | null }>(
    'SELECT colored_source, colored_ref_source, colored_ref_series FROM lib_series WHERE id = $1', [seriesId]);
  if (!s || s.colored_source !== COLORED_KEY || !s.colored_ref_source || !s.colored_ref_series) {
    await q('UPDATE lib_series SET colored_ref_listing = NULL, colored_ref_listed_at = NULL WHERE id = $1 AND colored_ref_listing IS NOT NULL', [seriesId]);
    return null;
  }
  const adapter = getSource(s.colored_ref_source);
  if (!adapter) return null;
  const listed = await adapter.listChapters(s.colored_ref_series).catch(() => null);
  if (!listed) return null;
  const rows: ColoredListed[] = listed.filter((c) => Number.isFinite(c.number)).map((c) => ({
    sourceId: c.sourceId, number: c.number, title: c.title ?? null, scanlator: c.scanlator ?? null, groups: c.groups ?? [],
    pages: c.pages ?? null, publishedAt: c.publishedAt ?? null,
  }));
  await q('UPDATE lib_series SET colored_ref_listing = $2::jsonb, colored_ref_listed_at = now() WHERE id = $1', [seriesId, JSON.stringify(rows)]);
  return rows.length;
}
