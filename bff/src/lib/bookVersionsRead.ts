// Every source's copy of a chapter (the read side: no downloads, safe to import from lib/visibility.ts) (the "Keep every source's copy" switch of a series, and Also keep on a chapter).
//
// The endorsed copy is the row in lib_books: what the scanner indexed, what the priority and the admin's Replace chose,
// and what an OPDS reader, Mihon or the offline download get when the account has said nothing. Other sources' copies are
// rows in lib_book_versions, files in <series folder>/.versions/<source>/ (a dot folder: the scanner skips it).
//
// An account may choose a source for a series (user_series_source). Then `chosenVersion` answers that source's copy of a
// chapter, if one is kept -- and visibleBookFile, which every page, file and thumbnail route resolves a chapter through,
// returns it, so the web reader, OPDS, Mihon and the offline manifest all follow the choice with no route knowing.
//
// ⚠️ What is keyed to the ENDORSED file and must not be applied to another copy: junk-page marks, spread marks and joins, panel
// boxes, translations and page sizes. A copy from another source can have a different page count, so page 5 there is another
// image. A chosen copy is served as plain pages (routes/catalog.ts skips the overlays; bookPages measures its own file).
// Reading progress is by chapter number and is untouched.
import { posix } from 'node:path';
import { q, one } from './db';

export interface ChosenVersion { file: string; root: string; pages: number; sourceId: string }
export interface HeldVersion { sourceId: string; pages: number; scanlator: string | null; publishedAt: string | null; size: number | null }

/** The folder, under the series' own, that a source's kept copies live in. Dot-led, so the scanner never sees it. */
export const versionsFolder = (seriesFolder: string, sourceId: string): string =>
  posix.join(seriesFolder, '.versions', sourceId.replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) || 'source');

/** The copy of this chapter the account chose a source for, when that copy is kept; null means "serve the endorsed file". */
export async function chosenVersion(userId: string | null | undefined, bookId: string): Promise<ChosenVersion | null> {
  if (!userId) return null;
  const r = await one<{ file: string; root: string; pages: number; source_id: string }>(
    `SELECT v.file, v.root, v.pages, v.source_id
       FROM lib_book_versions v
       JOIN lib_books b ON b.id = v.book_id
       JOIN user_series_source u ON u.series_id = b.series_id AND u.user_id = $1 AND u.source_id = v.source_id
      WHERE v.book_id = $2`, [userId, bookId]).catch(() => null);
  return r ? { file: r.file, root: r.root, pages: r.pages, sourceId: r.source_id } : null;
}

/** An account's source for a series, or null for none (the endorsed copies). */
export async function mySource(userId: string, seriesId: string): Promise<string | null> {
  return (await one<{ source_id: string }>('SELECT source_id FROM user_series_source WHERE user_id = $1 AND series_id = $2', [userId, seriesId]).catch(() => null))?.source_id ?? null;
}

export async function setMySource(userId: string, seriesId: string, sourceId: string | null): Promise<void> {
  if (!sourceId) { await q('DELETE FROM user_series_source WHERE user_id = $1 AND series_id = $2', [userId, seriesId]); return; }
  await q(`INSERT INTO user_series_source (user_id, series_id, source_id) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, series_id) DO UPDATE SET source_id = EXCLUDED.source_id, updated_at = now()`, [userId, seriesId, sourceId]);
}

/** Which sources' copies are kept, per chapter number, for a series: what the Versions sheet and the source picker show. */
export async function heldBySeries(seriesId: string): Promise<Map<number, HeldVersion[]>> {
  const rows = await q<{ number: number; source_id: string; pages: number; scanlator: string | null; published_at: string | null; size: string | null }>(
    `SELECT b.number::float8 AS number, v.source_id, v.pages, v.scanlator, v.published_at, v.size
       FROM lib_book_versions v JOIN lib_books b ON b.id = v.book_id WHERE b.series_id = $1 ORDER BY b.number, v.source_id`, [seriesId]).catch(() => []);
  const out = new Map<number, HeldVersion[]>();
  for (const r of rows) {
    const l = out.get(r.number) ?? [];
    l.push({ sourceId: r.source_id, pages: r.pages, scanlator: r.scanlator, publishedAt: r.published_at, size: r.size == null ? null : Number(r.size) });
    out.set(r.number, l);
  }
  return out;
}

