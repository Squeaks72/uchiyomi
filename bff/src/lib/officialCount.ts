// How many chapters a series officially has (the owner: "Attack on Titan only has 139 official chapters, so a failure
// for chapter 140 should never have been an error").
//
// Some sites list chapters the work does not have: a placeholder, a locked extra, a finale numbered past the end. The
// updater tried those, the source refused them, and the refusal sat on Health as a failure nobody could fix. MangaDex and AniList know
// how many chapters a finished work has, so that count is kept per series (series_official) and used for one thing:
//   * a chapter numbered above it is never a failure while the series holds every official chapter already
//     (beyondOfficial, and the cleanup below for rows already there).
// It is deliberately NOT used to warn that a series holds FEWER: both numbers are of the original publication, not of an
// English release, and a library of English chapters would be told about every series whose translation lags it.
//
// The total is MangaDex's last chapter for a completed work when it has one (Attack on Titan: 139, the numbered chapters
// alone), else AniList's chapter count for a FINISHED one (141: it also counts two extras).
//
// Only WHOLE chapters count, on both sides: AniList's count is of numbered chapters, so a held 139.5 (an extra) is not
// one of them, and a series is never "complete" because it holds extras.
//
// The entry is taken only when one of its names IS one of the series' names (lib/onlineMatch.ts namesMatch, the rule
// every title search here is held to), and the total only when AniList calls the work FINISHED: an ongoing work's
// `chapters` is null, and a number that grows is no ceiling. Refreshed in the background beside the scores
// (lib/anilistScores.ts), a few series a round, each asked again after a month.
import { q } from './db';
import { runtime } from './runtime';
import { visibleToAll } from './visibility';
import { searchAniListOfficial } from './anilist';
import { searchMangaDexOfficial } from './sources/mangadex';
import { namesOfMany } from './altTitles';
import { namesMatch } from './onlineMatch';

/** A row older than this is asked again: a finished work's count does not move, an ongoing one finishes rarely. */
export const OFFICIAL_MAX_AGE_MS = 30 * 24 * 60 * 60_000;
/** The most series one round asks about: one search each, paced by the AniList quota. */
const MAX_PER_ROUND = 40;

/**
 * SQL: how many whole chapters series `alias`.id holds (distinct whole numbers from 1, files not pruned). A half chapter
 * is not one of them.
 */
export const wholeHeld = (alias: string): string =>
  `(SELECT count(DISTINCT b.number)::int FROM lib_books b
     WHERE b.series_id = ${alias}.id AND b.pruned_at IS NULL AND b.number >= 1 AND b.number = floor(b.number))`;

/**
 * Chapters of series whose failure is moot: numbered above the official total, in a series that already holds every
 * official chapter. Deleted, and the same rule keeps new ones from being written. How many went.
 */
export async function clearBeyondOfficial(): Promise<number> {
  const rows = await q<{ series_id: string }>(
    `DELETE FROM chapter_failures f USING series_official o, lib_series s
      WHERE o.series_id = f.series_id AND s.id = f.series_id AND o.total IS NOT NULL AND f.number > o.total
        AND ${wholeHeld('s')} >= o.total
      RETURNING f.series_id`,
  );
  return rows.length;
}

/** Whether chapter `number` of the series is past its official end, in a series that holds all of it. Best effort: false on any failure. */
export async function beyondOfficial(seriesId: string, number: number): Promise<boolean> {
  const r = await q<{ x: number }>(
    `SELECT 1 AS x FROM series_official o JOIN lib_series s ON s.id = o.series_id
      WHERE o.series_id = $1 AND o.total IS NOT NULL AND $2::real > o.total AND ${wholeHeld('s')} >= o.total`,
    [seriesId, number],
  ).catch(() => []);
  return r.length > 0;
}

export interface OfficialOutcome { asked: number; counted: number; cleared: number }

/**
 * One round: visible series in libraries with AniList lookups on whose row is missing or old, each searched by title; the
 * entry that IS the series gives its total (FINISHED only), none gives a row with no total. Throws when AniList fails:
 * the next round tries again. Then the failures it makes moot are cleared.
 */
export async function refreshOfficialCounts(o: { max?: number; maxAgeMs?: number } = {}): Promise<OfficialOutcome> {
  const rows = await q<{ id: string; title: string }>(
    `SELECT s.id, s.title FROM lib_series s
       JOIN libraries l ON l.id = s.library_id AND l.anilist_lookup
       LEFT JOIN series_official o ON o.series_id = s.id
      WHERE ${visibleToAll('s')}
        AND (o.series_id IS NULL OR o.source IS NULL OR o.checked_at < now() - ($1::bigint * interval '1 millisecond'))
      ORDER BY o.checked_at NULLS FIRST, s.title
      LIMIT $2`,
    [o.maxAgeMs ?? OFFICIAL_MAX_AGE_MS, o.max ?? MAX_PER_ROUND],
  );
  const names = await namesOfMany(rows.map((r) => r.id)).catch(() => new Map<string, string[]>());
  let counted = 0;
  for (const r of rows) {
    if (runtime.stopping) break;
    const mine = [r.title, ...(names.get(r.id) ?? [])];
    // MangaDex first: its last chapter is the numbered chapters alone (Attack on Titan: 139), where AniList's count also
    // takes in extras (141). Best effort -- MangaDex failing leaves AniList's, which throws if it fails too.
    const md = (await searchMangaDexOfficial(r.title).catch(() => [])).find((e) => namesMatch(mine, e.names));
    const mdTotal = md && md.status === 'completed' ? md.lastChapter : null;
    const hit = (await searchAniListOfficial(r.title)).find((e) => namesMatch(mine, e.titles));
    const alTotal = hit && hit.status === 'FINISHED' ? hit.chapters : null;
    const total = mdTotal ?? alTotal;
    if (total) counted++;
    await q(
      `INSERT INTO series_official (series_id, anilist_id, total, status, source, checked_at) VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (series_id) DO UPDATE SET anilist_id = EXCLUDED.anilist_id, total = EXCLUDED.total,
         status = EXCLUDED.status, source = EXCLUDED.source, checked_at = now()`,
      [r.id, hit ? String(hit.id) : null, total, hit?.status ?? md?.status ?? null, mdTotal ? 'mangadex' : 'anilist'],
    );
  }
  return { asked: rows.length, counted, cleared: await clearBeyondOfficial() };
}
