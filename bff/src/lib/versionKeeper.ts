// Keeping every source's copy of a chapter, for the series that asked (lib_series.keep_versions, the admin's switch).
//
// One pass over such a series: every chapter the library holds, against every source the series follows, fetches the copies
// not kept yet -- the source the endorsed copy came from is skipped (it IS the endorsed file). The downloader's own gates pace
// each source, so a pass is as polite as any download; a pass also stops after `budget` fetches, so a long series is a few
// passes, not one afternoon of requests. A source that does not list a chapter, or fails, is skipped and tried at the next
// pass. Never throws.
import { q, one } from './db';
import { runtime } from './runtime';
import { seriesSourcesFor } from './seriesSources';
import { keepVersion, refreshColoredListing, type ListingCache } from './bookVersions';
import { blockedNow, isDisabled } from './sourceHealth';
import { seriesIsMonitored } from './updater';
import { COLORED_KEY } from './bookVersionsRead';

type Log = { info: (m: string) => void; warn: (m: string) => void };

const running = new Set<string>();

export const keepingNow = (seriesId: string): boolean => running.has(seriesId);

export async function keepAllVersions(seriesId: string, log: Log, budget = 25): Promise<{ kept: number; failed: number; left: boolean }> {
  if (running.has(seriesId)) return { kept: 0, failed: 0, left: false };
  running.add(seriesId);
  let kept = 0, failed = 0, left = false;
  try {
    const flags = await one<{ keep_versions: boolean; colored_source: string | null; colored_ref_source: string | null }>(
      'SELECT keep_versions, colored_source, colored_ref_source FROM lib_series WHERE id = $1', [seriesId]);
    // Every followed source's copy for a series that keeps them all; otherwise only a followed colored source's. A colored edition that is
    // its own title on a source (lib_series.colored_ref_*) is a target of its own, under the reserved key, whatever the series follows.
    const targets: string[] = (await seriesSourcesFor(seriesId))
      .filter((s) => s.registered && (flags?.keep_versions || s.sourceId === flags?.colored_source)).map((s) => s.sourceId);
    if (flags?.colored_source === COLORED_KEY && flags.colored_ref_source) targets.push(COLORED_KEY);
    if (!targets.length) return { kept, failed, left };
    // The sweep's own gates: a series nobody monitors is left alone, and a source that is switched off or resting is not asked.
    if (!(await seriesIsMonitored(seriesId))) return { kept, failed, left };
    for (let i = targets.length - 1; i >= 0; i--) {
      const t = targets[i];
      if (t === COLORED_KEY) continue;
      if (await isDisabled(t).catch(() => false) || await blockedNow(t).catch(() => null)) targets.splice(i, 1);
    }
    if (!targets.length) return { kept, failed, left: true };
    const listings: ListingCache = new Map();
    const books = await q<{ number: number; source_id: string | null }>(
      `SELECT number::float8 AS number, source_id FROM lib_books WHERE series_id = $1 AND pruned_at IS NULL ORDER BY number`, [seriesId]);
    const have = new Set((await q<{ number: number; source_id: string }>(
      `SELECT b.number::float8 AS number, v.source_id FROM lib_book_versions v JOIN lib_books b ON b.id = v.book_id WHERE b.series_id = $1`, [seriesId]))
      .map((r) => `${r.number}|${r.source_id}`));
    const failedOnce = new Set<string>();
    for (const b of books) {
      for (const target of targets) {
        if (runtime.stopping) return { kept, failed, left: true };
        const key = `${b.number}|${target}`;
        if (b.source_id === target || have.has(key) || failedOnce.has(target + '|' + b.number)) continue;
        if (kept + failed >= budget) { left = true; return { kept, failed, left }; }
        try {
          const r = await keepVersion(seriesId, b.number, target, listings);
          if (r === 'kept') kept++;
        } catch (e) {
          failed++;
          failedOnce.add(target + '|' + b.number);
          log.warn(`versions: ${seriesId} ch ${b.number} from ${target}: ${(e as Error)?.message || e}`);
        }
      }
    }
    return { kept, failed, left };
  } catch (e) {
    log.warn(`versions: ${seriesId}: ${(e as Error)?.message || e}`);
    return { kept, failed, left };
  } finally {
    running.delete(seriesId);
  }
}

/** Every 30 minutes, one pass over each series that keeps every copy or has a colored edition. Idle for a server with none. */
export function scheduleVersionKeeper(log: Log, delayMs = 10 * 60_000, everyMs = 30 * 60_000): void {
  const tick = async () => {
    if (!runtime.stopping) {
      const ids = await q<{ id: string }>('SELECT id FROM lib_series WHERE keep_versions OR colored_source IS NOT NULL').catch(() => []);
      // A colored edition's own chapter list, read again every six hours (lib/bookVersions.ts refreshColoredListing).
      for (const { id } of await q<{ id: string }>(
        `SELECT id FROM lib_series WHERE colored_source = '@colored' AND (colored_ref_listed_at IS NULL OR colored_ref_listed_at < now() - interval '6 hours')`).catch(() => [])) {
        if (runtime.stopping) break;
        await refreshColoredListing(id).catch(() => null);
      }
      for (const { id } of ids) {
        if (runtime.stopping) break;
        const r = await keepAllVersions(id, log);
        if (r.kept) log.info(`versions: ${id}: kept ${r.kept} more cop${r.kept === 1 ? 'y' : 'ies'}${r.left ? ', more to come' : ''}`);
      }
    }
    setTimeout(tick, everyMs).unref?.();
  };
  setTimeout(tick, delayMs).unref?.();
}
