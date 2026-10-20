// "Only tell me about a new chapter when it is the one I'd read next" (fork): one account's next-up chapter, and whether a chapter that
// just landed is it.
//
// The rule is the series page's own (web lib/continueLabel.ts): a chapter that is part-read is the one to continue, so nothing new is
// next; otherwise the next one is the first chapter that is not finished AFTER the highest finished one. A new chapter is next-up when
// that is it -- the reader is caught up, or the only thing between them and it is other chapters that just landed with it. A reader
// with an older unread chapter, or a chapter half read, has the new one behind a backlog and (with this setting on) is not told.
import { q, one } from './db';

/** Whether this account asked for the filter: app_settings.data.notifyOnlyNext, per account, off unless set. */
export async function notifyOnlyNextOn(userId: string): Promise<boolean> {
  const r = await one<{ on: boolean | null }>(`SELECT (data -> 'notifyOnlyNext') = 'true'::jsonb AS on FROM app_settings WHERE user_id = $1`, [userId]).catch(() => null);
  return r?.on === true;
}

/**
 * Whether the next chapter this account would read is one of `numbers` (the chapters that just landed). Fails OPEN: a lookup that
 * throws says yes, because a missed notification is worse than an extra one.
 */
export async function isNextUp(userId: string, seriesId: string, numbers: readonly number[]): Promise<boolean> {
  if (!numbers.length) return true;
  try {
    const rows = await q<{ number: number; done: boolean; page: number }>(
      `SELECT b.number::float8 AS number, COALESCE(rp.completed, false) AS done, COALESCE(rp.page, 0) AS page
         FROM lib_books b LEFT JOIN read_progress rp ON rp.book_id = b.id AND rp.user_id = $1
        WHERE b.series_id = $2 AND b.pruned_at IS NULL`, [userId, seriesId]);
    return nextUpIn(rows, numbers);
  } catch { return true; }
}

/** The rule itself, on rows, so a test can hold it. */
export function nextUpIn(rows: ReadonlyArray<{ number: number; done: boolean; page: number }>, numbers: readonly number[]): boolean {
  if (rows.some((r) => !r.done && r.page >= 1)) return false; // part-read: that chapter is the one to continue
  let highest = -Infinity;
  for (const r of rows) if (r.done && r.number > highest) highest = r.number;
  let next = Infinity;
  for (const r of rows) if (!r.done && r.number > highest && r.number < next) next = r.number;
  if (!Number.isFinite(next)) return false;
  return numbers.some((n) => Math.abs(n - next) < 0.001);
}
