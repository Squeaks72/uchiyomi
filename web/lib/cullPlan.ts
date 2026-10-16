import type { VersionCopy } from './types';

export interface CullBook { id: string; number: number; sourceId?: string | null; owned?: boolean; pruned?: boolean }

export interface CullPlan {
  /** Numbers to take out of the series for good (files deleted, number hidden): no other source's copy is, or could be, here. */
  remove: number[];
  /** Files to delete while the number stays listed: another copy of the same number is on the server and is not being culled. */
  deleteIds: string[];
  /** The chapter row keeps its place and takes the main source's copy of the same number. */
  swaps: { bookId: string; copy: VersionCopy }[];
  /** Candidates the server will not delete: not downloaded by Uchiyomi (a library the admin assembled). */
  notOurs: number;
}

/** The sources that hold chapters on this series other than its main one, with how many each holds. */
export function foreignSources(books: readonly CullBook[], primary: string | undefined): { id: string; count: number }[] {
  const n = new Map<string, number>();
  for (const b of books) if (b.sourceId && b.sourceId !== primary) n.set(b.sourceId, (n.get(b.sourceId) ?? 0) + 1);
  return [...n].map(([id, count]) => ({ id, count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
}

/**
 * What "remove everything that did not come from the main source" does, per chapter number. The removal list is
 * by NUMBER on the server, so a number the main source (or any copy left on the server) also holds must never go
 * in it -- that would hide a real chapter along with the wrong one. Such a number is swapped for the main source's
 * copy when it has one and the admin allows, and is otherwise only emptied of the foreign file.
 */
export function cullPlan(o: {
  books: readonly CullBook[];
  primary: string;
  sources: ReadonlySet<string>;
  swap: boolean;
  mainCopy: (number: number) => VersionCopy | undefined;
}): CullPlan {
  const isCand = (b: CullBook) => !!b.sourceId && b.sourceId !== o.primary && o.sources.has(b.sourceId);
  const keptNumbers = new Set(o.books.filter((b) => !isCand(b) && !b.pruned).map((b) => b.number));
  const plan: CullPlan = { remove: [], deleteIds: [], swaps: [], notOurs: 0 };
  const byNumber = new Map<number, CullBook[]>();
  for (const b of o.books) if (isCand(b)) byNumber.set(b.number, [...(byNumber.get(b.number) ?? []), b]);
  for (const [number, cands] of byNumber) {
    const ours = cands.filter((b) => b.owned !== false);
    plan.notOurs += cands.length - ours.length;
    if (!ours.length) continue;
    if (keptNumbers.has(number)) {
      plan.deleteIds.push(...ours.filter((b) => !b.pruned).map((b) => b.id));
      continue;
    }
    const copy = o.swap ? o.mainCopy(number) : undefined;
    if (copy) plan.swaps.push({ bookId: ours[0].id, copy });
    else plan.remove.push(number);
    // A second foreign row on a swapped number has nothing to take the copy: its file goes, the number stays.
    if (copy) plan.deleteIds.push(...ours.slice(1).filter((b) => !b.pruned).map((b) => b.id));
  }
  plan.remove.sort((a, b) => a - b);
  return plan;
}
