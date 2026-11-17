// Keeping another source's copy of a chapter (the write side of lib/bookVersionsRead.ts, which says what a kept copy is).
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { q, one } from './db';
import { DL_ROOT } from './library';
import { getSource } from './sources';
import { downloadChapter } from './downloader';
import { seriesSourcesFor } from './seriesSources';
import { numKey } from './postingOrder';
import { versionsFolder, COLORED_KEY } from './bookVersionsRead';
export * from './bookVersionsRead';

export type KeepResult = 'kept' | 'already' | 'is_endorsed' | 'no_book' | 'not_followed' | 'not_listed';

/**
 * Fetch one source's copy of one chapter and keep it beside the endorsed one. The source must be followed by the series
 * (its own or an extra, lib/seriesSources.ts) and list the chapter. A copy the endorsed file already is -- the source the
 * endorsed chapter came from -- is not stored twice. Throws what the downloader throws.
 */
export async function keepVersion(seriesId: string, number: number, sourceId: string): Promise<KeepResult> {
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
  const listed = (await adapter.listChapters(sourceSeriesId)).filter((c) => numKey(c.number) === numKey(number));
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
