// A reader's own correction of a double-page spread the detector got wrong.
//
// The detector (lib/spreadJoin.ts) is good, not perfect: it sometimes joins two pages that are not one spread. A `split` mark
// says THIS account's reader should show the pair (page, page + 1) of one chapter as two pages. No mark leaves the detector's
// answer. Marks are per account, so one reader's correction cannot break a chapter for another, and they sit beside
// lib_books.page_dims, never in it, so a re-measure leaves them alone.
import { q } from './db';

/** The most marks one account keeps on one chapter: a chapter has a few spreads, so more is a script or a slip. */
export const MAX_MARKS_PER_BOOK = 60;

/** The first pages of the pairs this account has un-joined in this chapter. */
export async function splitsFor(userId: string, bookId: string): Promise<number[]> {
  const rows = await q<{ page: number }>(
    `SELECT page FROM spread_marks WHERE user_id = $1 AND book_id = $2 AND mark = 'split' ORDER BY page`, [userId, bookId]);
  return rows.map((r) => r.page);
}

export type SetSplitResult = 'ok' | 'bad_page' | 'too_many';

/**
 * Un-join the pair (page, page + 1), or with `on` false bring the detector's answer back. `pages` is the chapter's page
 * count: `page` must be 1..pages-1.
 */
export async function setSplit(userId: string, bookId: string, page: number, on: boolean, pages: number): Promise<SetSplitResult> {
  if (!Number.isInteger(page) || page < 1 || page >= pages) return 'bad_page';
  if (!on) {
    await q('DELETE FROM spread_marks WHERE user_id = $1 AND book_id = $2 AND page = $3', [userId, bookId, page]);
    return 'ok';
  }
  const [{ n }] = await q<{ n: number }>(
    'SELECT count(*)::int AS n FROM spread_marks WHERE user_id = $1 AND book_id = $2 AND page <> $3', [userId, bookId, page]);
  if (n >= MAX_MARKS_PER_BOOK) return 'too_many';
  await q(
    `INSERT INTO spread_marks (user_id, book_id, page, mark) VALUES ($1, $2, $3, 'split')
     ON CONFLICT (user_id, book_id, page) DO UPDATE SET mark = 'split', updated_at = now()`,
    [userId, bookId, page]);
  return 'ok';
}
