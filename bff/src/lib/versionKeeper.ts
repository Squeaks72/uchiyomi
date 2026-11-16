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
import { keepVersion } from './bookVersions';

type Log = { info: (m: string) => void; warn: (m: string) => void };

const running = new Set<string>();

export const keepingNow = (seriesId: string): boolean => running.has(seriesId);

export async function keepAllVersions(seriesId: string, log: Log, budget = 25): Promise<{ kept: number; failed: number; left: boolean }> {
  if (running.has(seriesId)) return { kept: 0, failed: 0, left: false };
  running.add(seriesId);
  let kept = 0, failed = 0, left = false;
  try {
    const flags = await one<{ keep_versions: boolean; colored_source: string | null }>('SELECT keep_versions, colored_source FROM lib_series WHERE id = $1', [seriesId]);
    // Every followed source's copy for a series that keeps them all; otherwise only the colored edition's, which is always kept.
    const sources = (await seriesSourcesFor(seriesId)).filter((s) => s.registered && (flags?.keep_versions || s.sourceId === flags?.colored_source));
    if (!sources.length || (await seriesSourcesFor(seriesId)).length < 2) return { kept, failed, left };
    const books = await q<{ number: number; source_id: string | null }>(
      `SELECT number::float8 AS number, source_id FROM lib_books WHERE series_id = $1 AND pruned_at IS NULL ORDER BY number`, [seriesId]);
    const have = new Set((await q<{ number: number; source_id: string }>(
      `SELECT b.number::float8 AS number, v.source_id FROM lib_book_versions v JOIN lib_books b ON b.id = v.book_id WHERE b.series_id = $1`, [seriesId]))
      .map((r) => `${r.number}|${r.source_id}`));
    const failedOnce = new Set<string>();
    for (const b of books) {
      for (const s of sources) {
        if (runtime.stopping) return { kept, failed, left: true };
        const key = `${b.number}|${s.sourceId}`;
        if (b.source_id === s.sourceId || have.has(key) || failedOnce.has(s.sourceId + '|' + b.number)) continue;
        if (kept + failed >= budget) { left = true; return { kept, failed, left }; }
        try {
          const r = await keepVersion(seriesId, b.number, s.sourceId);
          if (r === 'kept') kept++;
        } catch (e) {
          failed++;
          failedOnce.add(s.sourceId + '|' + b.number);
          log.warn(`versions: ${seriesId} ch ${b.number} from ${s.sourceId}: ${(e as Error)?.message || e}`);
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
