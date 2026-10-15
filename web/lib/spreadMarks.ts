// The reader's own correction of a double-page spread that is not one (bff lib/spreadMarks.ts).
//
// The server's detector says which neighbouring pages are one spread a source cut in two (`join` on the first page). It is
// sometimes wrong, and a reader can un-join a pair: this account's reader then shows the two pages apart. It is applied to
// the flow after it is built, so the pairing rules in lib/readerSpread.ts need to know nothing about where a join went.
import { api } from './api';

/** First page numbers of the pairs un-joined in one chapter. */
export type Splits = readonly number[];

interface Joinable { ci: number; number: number; join?: 'rtl' | 'ltr' | null }

/**
 * `items` with the un-joined pairs' joins taken off; `splitsByCi[ci]` is chapter `ci`'s. The very array when there is
 * nothing to apply, so a flow memoised on it does not change.
 */
export function applySplits<T extends Joinable>(items: T[], splitsByCi: ReadonlyArray<Splits | undefined>): T[] {
  if (!splitsByCi.some((s) => s && s.length)) return items;
  return items.map((it) => (it.join && splitsByCi[it.ci]?.includes(it.number) ? { ...it, join: undefined } : it));
}

/** The pair the page at flow index `at` is half of, as the first page's number and whether the reader un-joined it. */
export interface SpreadChoice { first: number; split: boolean }

/**
 * What the sheet can offer for the page being read: a pair the detector joined (so it can be un-joined), or one the reader
 * already un-joined (so it can be given back). `flat` is the flow as the detector left it, before applySplits.
 */
export function spreadChoice(
  flat: ReadonlyArray<{ ci: number; number: number; join?: 'rtl' | 'ltr' | null }>,
  at: number,
  splits: Splits | undefined,
): SpreadChoice | null {
  const me = flat[at];
  if (!me) return null;
  const startsAt = (i: number): number | null => {
    const a = flat[i], b = flat[i + 1];
    return a && b && a.ci === me.ci && b.ci === a.ci && a.join && b.number === a.number + 1 ? a.number : null;
  };
  const first = startsAt(at) ?? startsAt(at - 1);
  return first === null ? null : { first, split: !!splits?.includes(first) };
}

export const loadSplits = (bookId: string): Promise<Splits> =>
  api<{ splits: number[] }>(`/api/books/${encodeURIComponent(bookId)}/spread-splits`).then((r) => r.splits ?? []).catch(() => []);

export const saveSplit = (bookId: string, page: number, split: boolean): Promise<Splits> =>
  api<{ splits: number[] }>(`/api/books/${encodeURIComponent(bookId)}/spread-splits/${page}`, { method: 'PUT', json: { split } }).then((r) => r.splits ?? []);
