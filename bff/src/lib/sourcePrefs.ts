import { one } from './db';

/**
 * Which sources a series should be taken from, in order of preference.
 *
 * The sibling of lib/scanlatorPrefs.ts, one level up: that one ranks the GROUP a copy came from, this one
 * ranks the SOURCE. A server-wide order, overridable per series, because the right answer genuinely
 * differs per title -- a source that is first to post one series is often behind on another.
 *
 * What it buys, and what `scanlatorPrefs` could not: an UPGRADE. Until now a chapter on disk was never
 * replaced, whoever released it ("a copy from a better-ranked group appearing later is not a missing
 * chapter", lib/updater.ts). That is right when the ranking is about who translated it and the copy is
 * already readable. It is wrong when a series has been following a mediocre source and the preferred one
 * catches up: every chapter fetched in the meantime stays the worse copy for good, and the only fix was
 * to delete them by hand and fetch again.
 *
 * So a listed chapter whose source outranks the source of the copy held is re-fetched over it. Chapter
 * ids, reading progress and bookmarks all survive, because the file is written to the same path -- named
 * from the chapter NUMBER alone, which is exactly why lib/downloader.ts names it that way.
 */
export interface StoredSourcePrefs {
  /** Source ids, most preferred first. Anything not listed ranks below everything listed. */
  priority?: string[];
}

export interface SourcePriority {
  order: readonly string[];
  /** Lower is better. An unlisted source ranks below every listed one, never equal to it. */
  rank(sourceId: string | null | undefined): number;
  /** Whether a copy from `offered` should replace one currently held from `held`. */
  outranks(offered: string | null | undefined, held: string | null | undefined): boolean;
}

const UNRANKED = Number.MAX_SAFE_INTEGER;

function build(order: string[]): SourcePriority {
  const at = new Map(order.map((id, i) => [id, i] as const));
  const rank = (id: string | null | undefined) => (id && at.has(id) ? at.get(id)! : UNRANKED);
  return {
    order,
    rank,
    // Both unranked is NOT an upgrade: with no opinion about either source there is no reason to spend a
    // download replacing a readable chapter, and "unranked beats unranked" would re-fetch the whole
    // library every sweep.
    outranks: (offered, held) => {
      const a = rank(offered);
      const b = rank(held);
      return a < b && a !== UNRANKED;
    },
  };
}

const clean = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.map((x) => String(x ?? '').trim()).filter(Boolean))] : [];

let globalCache: { at: number; order: string[] } | null = null;
const CACHE_MS = 15_000;

/** Drop the cached server-wide order, after it has been written. */
export function invalidateSourcePrefs(): void { globalCache = null; }

async function globalOrder(): Promise<string[]> {
  if (globalCache && Date.now() - globalCache.at < CACHE_MS) return globalCache.order;
  const row = await one<{ source_prefs: unknown }>(
    'SELECT source_prefs FROM server_settings WHERE id = 1').catch(() => null);
  const order = clean((row?.source_prefs as StoredSourcePrefs | null)?.priority);
  globalCache = { at: Date.now(), order };
  return order;
}

/**
 * The order in force for one series: its own if it has one, else the server's.
 *
 * REPLACES rather than merges, unlike the scanlator preferences, which add the series' blocks to the
 * server's. An order is a single ranked sequence; interleaving two of them produces a third that neither
 * party asked for, and "prefer Weeb Central for this one" is a statement about this one.
 */
export async function effectiveSourcePriority(seriesPrefs: unknown): Promise<SourcePriority> {
  const own = clean((seriesPrefs as StoredSourcePrefs | null)?.priority);
  return build(own.length ? own : await globalOrder());
}
