// Volumes and arcs (fork): read each series' volume list, keep it in series_volumes, and announce a volume or arc the
// moment every chapter of it is held -- for the people who would rather read a whole volume at once than a chapter a week.
//
// Where a series' volumes come from, first that answers:
//   1. the admin's text (series_volumes.manual) when it names any volume -- it is also the only place arcs come from;
//   2. Wikipedia's volume list for the series' AniList entry (wiki.ts), matched against the chapters held;
//   3. the volume tags in the sources' own chapter names ("Vol.3 Ch.25", units.ts volumesFromNames).
// Refreshed in the background: a few minutes after boot, then every six hours, the series whose list is missing or
// a fortnight old (a new volume appears on Wikipedia a few weeks after it is published in Japan).
//
// "Complete" is every WHOLE chapter of the unit held (units.ts isComplete); a half chapter or an extra never holds a
// volume back. Each unit is announced once per series (volume_announced). The first time a series' list is read, the
// units already complete are recorded without a word (`seeded`), so the feature does not open with a flood.
//
// Who hears: the accounts that wait for volumes of that series (volume_watch) -- by web push, and through any
// notification target that asked for `volume_complete` (lib/notify sendVolumeNews). Those accounts are spared the
// per-chapter news of that series (lib/nextUp.ts wantsNews).
import { q, one } from '../db';
import { runtime } from '../runtime';
import { haveNumbers } from '../libraryNumbers';
import { notifyUser } from '../push';
import { sendVolumeNews } from '../notify';
import { seriesVisible, viewCtxFor } from '../visibility';
import { articlesForAniList, findVolumes } from './wiki';
import { isComplete, parseManual, unitKey, unitSentence, volumesFromNames, type Unit } from './units';

type Log = { info: (m: string) => void; warn: (m: string) => void };

export type VolumeSource = 'wikipedia' | 'names' | 'manual' | 'none';

interface Row {
  series_id: string;
  source: string;
  page: string | null;
  volumes: Unit[];
  manual: string | null;
  seeded: boolean;
  checked_at: string | null;
}

/** A list older than this is read again. */
export const VOLUMES_MAX_AGE_MS = 14 * 24 * 60 * 60_000;
/** The most series one background round reads from Wikipedia. */
const MAX_PER_ROUND = 60;

export interface SeriesVolumes {
  source: VolumeSource;
  /** The Wikipedia page the volumes came from, when they did. */
  page: string | null;
  volumes: Unit[];
  arcs: Unit[];
  /** The admin's text as stored, null when there is none. */
  manual: string | null;
  checkedAt: string | null;
}

/** What the series page groups by: the admin's units where there are any, the automatic volumes otherwise. */
export function effective(row: Pick<Row, 'source' | 'page' | 'volumes' | 'manual' | 'checked_at'> | null): SeriesVolumes {
  if (!row) return { source: 'none', page: null, volumes: [], arcs: [], manual: null, checkedAt: null };
  const own = parseManual(row.manual).units;
  const ownVolumes = own.filter((u) => u.kind === 'volume');
  const auto = Array.isArray(row.volumes) ? row.volumes.map((u) => ({ ...u, kind: 'volume' as const })) : [];
  return {
    source: ownVolumes.length ? 'manual' : (['wikipedia', 'names'].includes(row.source) ? row.source as VolumeSource : 'none'),
    page: ownVolumes.length ? null : row.page,
    volumes: ownVolumes.length ? ownVolumes : auto,
    arcs: own.filter((u) => u.kind === 'arc'),
    manual: row.manual,
    checkedAt: row.checked_at,
  };
}

const ROW_COLS = 'series_id, source, page, volumes, manual, seeded, checked_at';

export async function volumesFor(seriesId: string): Promise<SeriesVolumes> {
  return effective(await one<Row>(`SELECT ${ROW_COLS} FROM series_volumes WHERE series_id = $1`, [seriesId]));
}

/** The AniList entry a series is matched to: the official-count match, else a tracker link. */
async function aniListIdOf(seriesId: string): Promise<string | null> {
  const r = await one<{ id: string | null }>(
    `SELECT COALESCE(
       (SELECT anilist_id FROM series_official WHERE series_id = $1 AND anilist_id IS NOT NULL),
       (SELECT external_id FROM series_trackers WHERE series_id = $1 AND provider = 'anilist' LIMIT 1)) AS id`, [seriesId]);
  return r?.id ?? null;
}

/** The chapter names the sources list and the library holds, for the volume tags in them. */
async function chapterNames(seriesId: string): Promise<Array<{ number: number; name: string | null }>> {
  return q<{ number: number; name: string | null }>(
    `SELECT number::float8 AS number, title AS name FROM series_listing WHERE series_id = $1
     UNION ALL
     SELECT number::float8, title FROM lib_books WHERE series_id = $1`, [seriesId]);
}

async function store(seriesId: string, source: VolumeSource, page: string | null, volumes: Unit[]): Promise<void> {
  await q(
    `INSERT INTO series_volumes (series_id, source, page, volumes, checked_at, updated_at) VALUES ($1, $2, $3, $4::jsonb, now(), now())
     ON CONFLICT (series_id) DO UPDATE SET source = EXCLUDED.source, page = EXCLUDED.page, volumes = EXCLUDED.volumes,
       checked_at = now(), updated_at = CASE WHEN series_volumes.volumes IS DISTINCT FROM EXCLUDED.volumes THEN now() ELSE series_volumes.updated_at END`,
    [seriesId, source, page, JSON.stringify(volumes)]);
}

/**
 * Read one series' volumes again, now: Wikipedia when its AniList entry has an article with a list that fits, the
 * chapter names otherwise. `article` skips the Wikidata lookup when the caller already did it for many series at once
 * (undefined: look it up; null: there is none).
 */
export async function refreshVolumes(seriesId: string, article?: string | null): Promise<SeriesVolumes> {
  const held = new Set(await haveNumbers(seriesId));
  let found: { page: string; volumes: Unit[] } | null = null;
  if (article === undefined) {
    const al = await aniListIdOf(seriesId);
    article = al ? (await articlesForAniList([al])).get(al) ?? null : null;
  }
  if (article) {
    const w = await findVolumes(article, held).catch(() => null);
    if (w) found = { page: w.page, volumes: w.volumes.map((v) => ({ kind: 'volume' as const, label: v.label, chapters: v.chapters, released: v.released })) };
  }
  if (found) await store(seriesId, 'wikipedia', found.page, found.volumes);
  else {
    const named = volumesFromNames(await chapterNames(seriesId));
    await store(seriesId, named.length ? 'names' : 'none', null, named);
  }
  await checkCompletions([seriesId]);
  return volumesFor(seriesId);
}

/** The admin's text for a series; null or blank clears it. Units it makes complete are recorded, not announced. */
export async function setManual(seriesId: string, text: string | null): Promise<SeriesVolumes> {
  const clean = text && text.trim() ? text.replace(/\r\n?/g, '\n').slice(0, 50_000) : null;
  await q(
    `INSERT INTO series_volumes (series_id, manual, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (series_id) DO UPDATE SET manual = EXCLUDED.manual, updated_at = now()`, [seriesId, clean]);
  await checkCompletions([seriesId], { quiet: true });
  return volumesFor(seriesId);
}

/** One background round: the series whose list is missing or old, a batch of them. */
export async function refreshDueVolumes(max = MAX_PER_ROUND): Promise<{ asked: number; wikipedia: number; names: number }> {
  const due = await q<{ id: string; al: string | null }>(
    `SELECT s.id,
            COALESCE(o.anilist_id, (SELECT t.external_id FROM series_trackers t WHERE t.series_id = s.id AND t.provider = 'anilist' LIMIT 1)) AS al
       FROM lib_series s
       LEFT JOIN series_official o ON o.series_id = s.id
       LEFT JOIN series_volumes v ON v.series_id = s.id
      WHERE s.books_count > 0
        AND (v.checked_at IS NULL OR v.checked_at < now() - make_interval(secs => $1))
      ORDER BY v.checked_at NULLS FIRST, s.id
      LIMIT $2`, [VOLUMES_MAX_AGE_MS / 1000, max]);
  if (!due.length) return { asked: 0, wikipedia: 0, names: 0 };
  const articles = await articlesForAniList(due.map((d) => d.al).filter((x): x is string => !!x)).catch(() => new Map<string, string>());
  let wikipedia = 0;
  let names = 0;
  for (const d of due) {
    if (runtime.stopping) break;
    try {
      const r = await refreshVolumes(d.id, d.al ? articles.get(d.al) ?? null : null);
      if (r.source === 'wikipedia') wikipedia++;
      else if (r.source === 'names') names++;
    } catch { /* the next round asks again */ }
  }
  return { asked: due.length, wikipedia, names };
}

export function scheduleVolumes(log: Log, delayMs = 6 * 60_000, everyMs = 6 * 60 * 60_000): void {
  const tick = async () => {
    if (!runtime.stopping) {
      try {
        const r = await refreshDueVolumes();
        if (r.asked) log.info(`volumes: ${r.asked} series read, ${r.wikipedia} from Wikipedia, ${r.names} from chapter names`);
      } catch (e) {
        log.warn(`volumes: the refresh failed: ${(e as Error)?.message || e}`);
      }
    }
    // Chapters that landed some other way -- Fill missing chapters, an upload, the slow archive -- complete volumes
    // too, and no sweep saw them land: every series someone waits on is checked on this tick as well.
    if (!runtime.stopping) {
      const watched = await q<{ series_id: string }>('SELECT DISTINCT series_id FROM volume_watch').catch(() => []);
      await checkCompletions(watched.map((w) => w.series_id));
    }
    setTimeout(tick, everyMs).unref?.();
  };
  setTimeout(tick, delayMs).unref?.();
}

export interface Completed { seriesId: string; title: string; units: Unit[] }

/**
 * The units of these series that are complete and were never announced: recorded, and announced unless `quiet` (or
 * the series' list is being read for the first time). Never throws.
 */
export async function checkCompletions(seriesIds: readonly string[], opts: { quiet?: boolean } = {}): Promise<Completed[]> {
  const out: Completed[] = [];
  try {
    const ids = [...new Set(seriesIds)];
    if (!ids.length) return out;
    const rows = await q<Row & { title: string }>(
      `SELECT ${ROW_COLS.split(', ').map((c) => `v.${c}`).join(', ')}, s.title FROM series_volumes v JOIN lib_series s ON s.id = v.series_id
        WHERE v.series_id = ANY($1)`, [ids]);
    for (const row of rows) {
      const eff = effective(row);
      const units = [...eff.volumes, ...eff.arcs];
      if (!units.length) continue;
      const held = new Set(await haveNumbers(row.series_id));
      const done = units.filter((u) => isComplete(u, held));
      const quiet = opts.quiet || !row.seeded;
      if (!row.seeded) await q('UPDATE series_volumes SET seeded = true WHERE series_id = $1', [row.series_id]);
      if (!done.length) continue;
      const fresh = await q<{ unit: string }>(
        `INSERT INTO volume_announced (series_id, unit) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING RETURNING unit`,
        [row.series_id, done.map(unitKey)]);
      if (quiet || !fresh.length) continue;
      const keys = new Set(fresh.map((f) => f.unit));
      out.push({ seriesId: row.series_id, title: row.title, units: done.filter((u) => keys.has(unitKey(u))) });
    }
    if (out.length) await announce(out);
  } catch { /* an announcement is never what a sweep waits on */ }
  return out;
}

/** "Volume 14 (chapters 128–133) is complete" / "Volumes 13 and 14 are complete". */
export function completeSentence(units: readonly Unit[]): string {
  if (units.length === 1) return `${unitSentence(units[0])} is complete`;
  const names = units.map(unitSentence);
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} are complete`;
}

/** Web push to each account waiting on the series, and the notification targets that asked for it. */
async function announce(done: readonly Completed[]): Promise<void> {
  for (const c of done) {
    const watchers = await q<{ user_id: string; role: string }>(
      `SELECT w.user_id, u.role FROM volume_watch w JOIN users u ON u.id = w.user_id WHERE w.series_id = $1 AND NOT u.disabled`, [c.seriesId]);
    for (const w of watchers) {
      const ok = await viewCtxFor(w.user_id, w.role).then((ctx) => seriesVisible(c.seriesId, ctx)).catch(() => false);
      if (!ok) continue;
      await notifyUser(w.user_id, c.title, `${completeSentence(c.units)} — ready to binge`, `/series/?id=${encodeURIComponent(c.seriesId)}&view=volumes`, `volumes-${c.seriesId}`).catch(() => false);
    }
  }
  await sendVolumeNews(done.map((c) => ({ id: c.seriesId, title: c.title, message: completeSentence(c.units) }))).catch(() => {});
}
