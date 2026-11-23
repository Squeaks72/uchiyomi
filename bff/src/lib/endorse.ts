// Which source's copy is a chapter's file -- its ENDORSED copy (lib/bookVersionsRead.ts says what that is).
//
// The rule: the series' main source, for every chapter it lists, unless an admin endorsed another source's copy of that chapter
// (series_chapter_endorse, the version rows' "Endorse this version"). Applied:
//  - to one chapter at once, when an admin endorses a copy (or puts it back to the main source);
//  - to a whole series when its main source changes (lib_series.endorse_pending, set by lib/mainSource.ts) or an admin asks;
//  - to new chapters, by the pass below, so the library does not drift as the updater lands copies from other sources.
// Files that arrived with no source (imports) are left alone unless an admin endorses a copy of that chapter by hand.
//
// Endorsing re-downloads the chosen source's copy onto the chapter's own row through the refetch job (routes/admin.ts
// refetchChapters) -- the set-aside-and-restore path, so progress stays and a failed download costs nothing. The copy that was
// endorsed is kept beside it as a version first (a hard link, so no bytes are copied), readable and endorsable again.
import { copyFile, link, mkdir, rm, stat } from 'node:fs/promises';
import { join, posix, resolve } from 'node:path';
import { q, one } from './db';
import { DL_ROOT } from './library';
import { runtime } from './runtime';
import { versionsFolder } from './bookVersionsRead';
import { refetchChapters } from './refetch';

type Log = { info: (m: string) => void; warn: (m: string) => void };

/** The version key a file with no source (an import) is kept under when another copy is endorsed over it. */
export const IMPORTED_KEY = '@imported';
/** How many chapters one endorse job takes; a long series is several passes. */
const JOB_MAX = 100;

export interface EndorseStep { bookId: string; number: number; source: string; sourceId: string; from: string | null }

interface ListingCopy { source: string; sourceId: string }

/**
 * The chapters whose file is not the copy the rule endorses, each with the copy to put there. `numbers` limits it to those chapters
 * (and then imports count: the admin named them); `since` to chapters added after a moment (the pass's new chapters).
 */
export async function endorsePlan(seriesId: string, o: { numbers?: number[]; since?: Date } = {}): Promise<EndorseStep[]> {
  const s = await one<{ source_id: string | null }>('SELECT source_id FROM lib_series WHERE id = $1 AND deleted_at IS NULL', [seriesId]).catch(() => null);
  if (!s) return [];
  const manual = new Map((await q<{ number: number; source_id: string }>(
    'SELECT number::float8 AS number, source_id FROM series_chapter_endorse WHERE series_id = $1', [seriesId])).map((r) => [Number(r.number), r.source_id]));
  if (!s.source_id && !manual.size) return [];
  const books = await q<{ id: string; number: number; source_id: string | null }>(
    `SELECT id, number::float8 AS number, source_id FROM lib_books
      WHERE series_id = $1 AND pruned_at IS NULL AND number_end IS NULL
        ${o.numbers ? 'AND number = ANY($2::real[])' : o.since ? 'AND created_at > $2' : ''}
      ORDER BY number`, o.numbers ? [seriesId, o.numbers] : o.since ? [seriesId, o.since] : [seriesId]);
  if (!books.length) return [];
  const listing = new Map((await q<{ number: number; source_id: string; chosen: { sourceId?: string } | null; copies: ListingCopy[] | null }>(
    'SELECT number::float8 AS number, source_id, chosen, copies FROM series_listing WHERE series_id = $1 AND number = ANY($2::real[])',
    [seriesId, books.map((b) => b.number)])).map((r) => [Number(r.number), r]));
  const out: EndorseStep[] = [];
  for (const b of books) {
    const n = Number(b.number);
    const want = manual.get(n) ?? s.source_id;
    if (!want || b.source_id === want) continue;
    // An import is nobody's copy: replaced only when an admin names the chapter, or endorsed a copy of it by hand.
    if (!b.source_id && !o.numbers && !manual.has(n)) continue;
    const l = listing.get(n);
    const copies = (l?.copies ?? []).filter((c) => c.source === want);
    const copy = copies.find((c) => l?.source_id === want && c.sourceId === l?.chosen?.sourceId) ?? copies[0];
    if (!copy) continue;
    out.push({ bookId: b.id, number: n, source: want, sourceId: copy.sourceId, from: b.source_id });
  }
  return out;
}

/** Remove one kept copy: its file (only ever inside a `.versions` folder) and its row. */
export async function dropVersion(bookId: string, sourceId: string): Promise<boolean> {
  const v = await one<{ file: string; root: string }>('SELECT file, root FROM lib_book_versions WHERE book_id = $1 AND source_id = $2', [bookId, sourceId]);
  if (!v) return false;
  const abs = resolve(v.root || DL_ROOT, v.file);
  if (abs.startsWith(resolve(v.root || DL_ROOT) + '/') && v.file.split('/').includes('.versions')) await rm(abs, { force: true }).catch(() => {});
  await q('DELETE FROM lib_book_versions WHERE book_id = $1 AND source_id = $2', [bookId, sourceId]);
  return true;
}

/** Keep the file a chapter has now as a version under its source (or IMPORTED_KEY), before another copy is endorsed over it. */
async function keepCurrent(bookId: string, abs: string): Promise<void> {
  const b = await one<{ source_id: string | null; scanlator: string | null; pages: number; file: string; folder: string }>(
    `SELECT b.source_id, b.scanlator, b.pages, b.file, s.folder FROM lib_books b JOIN lib_series s ON s.id = b.series_id WHERE b.id = $1`, [bookId]);
  if (!b) return;
  const key = b.source_id ?? IMPORTED_KEY;
  if (await one('SELECT 1 FROM lib_book_versions WHERE book_id = $1 AND source_id = $2', [bookId, key])) return;
  const st = await stat(abs).catch(() => null);
  if (!st?.isFile()) return;
  const rel = posix.join(versionsFolder(b.folder, key), posix.basename(b.file));
  const dest = join(DL_ROOT, rel);
  await mkdir(join(dest, '..'), { recursive: true });
  await rm(dest, { force: true });
  // A hard link: the refetch renames the original aside and deletes it once the new copy lands, and the link keeps the bytes.
  await link(abs, dest).catch(() => copyFile(abs, dest));
  await q(
    `INSERT INTO lib_book_versions (book_id, source_id, file, root, pages, scanlator, size) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (book_id, source_id) DO NOTHING`,
    [bookId, key, rel, DL_ROOT, b.pages, b.scanlator, st.size]);
}

export type EndorseRun = { started: number; skipped: Array<{ id: string; reason: string }>; busy?: boolean };

/** Put the planned copies on their chapters' rows (one refetch job), keeping each current file as a version first. */
export async function runEndorse(seriesId: string, steps: EndorseStep[], by: string | null): Promise<EndorseRun> {
  const take = steps.slice(0, JOB_MAX);
  if (!take.length) return { started: 0, skipped: [] };
  const target = new Map(take.map((t) => [t.bookId, t.source]));
  const r = await refetchChapters(seriesId, { picks: take.map((t) => ({ bookId: t.bookId, source: t.source, sourceId: t.sourceId })) }, {
    by,
    beforeSetAside: async (rows) => { for (const row of rows) await keepCurrent(row.id, row.abs).catch(() => {}); },
    // The source just endorsed may have had a kept copy of this chapter: it IS the endorsed file now, so the kept one goes.
    onLanded: async (bookId) => { const src = target.get(bookId); if (src) await dropVersion(bookId, src).catch(() => false); },
    // The refetch job runs detached, so `skipped` only covers what was refused up front. A chapter that fails LATER lands here, and
    // gets the same one-day back-off; without it the 2-minute pending pass redid it forever (set aside, tombstoned, downloaded again).
    onFailed: (bookId) => { const src = target.get(bookId); if (src) failedAt.set(`${bookId}|${src}`, Date.now()); },
  });
  if (r.code === 200) return { started: r.body.total ?? take.length, skipped: r.body.skipped ?? [] };
  return { started: 0, skipped: r.body?.skipped ?? [], busy: r.body?.error === 'busy' };
}

/** An admin's endorsement of one chapter's copy (null: the main source's again), applied at once. */
export async function endorseChapter(seriesId: string, number: number, sourceId: string | null, by: string): Promise<EndorseRun & { already?: boolean }> {
  if (sourceId) {
    await q(`INSERT INTO series_chapter_endorse (series_id, number, source_id, set_by) VALUES ($1, $2, $3, $4)
             ON CONFLICT (series_id, number) DO UPDATE SET source_id = EXCLUDED.source_id, set_by = EXCLUDED.set_by, set_at = now()`,
      [seriesId, number, sourceId, by]);
  } else {
    await q('DELETE FROM series_chapter_endorse WHERE series_id = $1 AND number = $2', [seriesId, number]);
  }
  const plan = await endorsePlan(seriesId, { numbers: [number] });
  if (!plan.length) return { started: 0, skipped: [], already: true };
  return runEndorse(seriesId, plan, by);
}

/** Chapters whose endorse failed recently are left alone for a day, so a copy that will not download is not asked for every pass. */
const failedAt = new Map<string, number>();
const RETRY_MS = 24 * 3600_000;

/** The scheduler's pending pass, once scheduleEndorser has run: kickEndorser calls it. */
let pendingNow: (() => Promise<void>) | null = null;

/**
 * Start a main-source switch's endorse NOW rather than at the next pass (2026-11-20: Tim switched Chainsaw Man's main source and saw
 * nothing change -- the first pass was up to 30 minutes away). A no-op until the scheduler is running; a pass already in flight
 * simply makes this one find the series busy, and the next tick takes it.
 */
export function kickEndorser(): void {
  if (pendingNow) setTimeout(() => { void pendingNow?.(); }, 1500).unref?.();
}

/**
 * Two passes. Every 2 minutes: the series whose main source changed (endorse_pending), one job (JOB_MAX chapters) at a time until
 * done -- a series busy with the previous job is a 409 and waits for the next tick, so the jobs follow each other closely without
 * overlapping. Every 30 minutes: the chapters added in the last three days across the library. Idle when everything already matches.
 */
export function scheduleEndorser(log: Log, delayMs = 12 * 60_000, everyMs = 30 * 60_000, pendingEveryMs = 2 * 60_000): void {
  const fresh = (steps: EndorseStep[]) => {
    // The map only ever needs the entries still inside the back-off window.
    const cutoff = Date.now() - RETRY_MS;
    for (const [k, t] of failedAt) if (t < cutoff) failedAt.delete(k);
    return freshOf(steps);
  };
  const freshOf = (steps: EndorseStep[]) => steps.filter((t) => (failedAt.get(`${t.bookId}|${t.source}`) ?? 0) < Date.now() - RETRY_MS);
  const run = async (id: string, steps: EndorseStep[]) => {
    const r = await runEndorse(id, steps, null);
    for (const sk of r.skipped) { const t = steps.find((x) => x.bookId === sk.id); if (t) failedAt.set(`${t.bookId}|${t.source}`, Date.now()); }
    if (r.started) log.info(`endorse: ${id}: putting the endorsed copy on ${r.started} chapter${r.started === 1 ? '' : 's'}`);
    else if (r.busy) log.info(`endorse: ${id}: a download for the series is running; next pass`);
    return r;
  };
  let pendingBusy = false;
  const pending = async () => {
    if (pendingBusy) return;
    pendingBusy = true;
    try {
      for (const { id } of await q<{ id: string }>('SELECT id FROM lib_series WHERE endorse_pending AND deleted_at IS NULL')) {
        if (runtime.stopping) break;
        const steps = fresh(await endorsePlan(id));
        if (!steps.length) { await q('UPDATE lib_series SET endorse_pending = false WHERE id = $1', [id]); continue; }
        await run(id, steps);
      }
    } catch (e) { log.warn(`endorse: ${(e as Error)?.message || e}`); }
    finally { pendingBusy = false; }
  };
  pendingNow = pending;
  const pendingTick = async () => { await pending(); setTimeout(pendingTick, pendingEveryMs).unref?.(); };
  const tick = async () => {
    try {
      const since = new Date(Date.now() - 3 * 24 * 3600_000);
      for (const { id } of await q<{ id: string }>(
        `SELECT DISTINCT b.series_id AS id FROM lib_books b WHERE b.created_at > $1 AND b.pruned_at IS NULL`, [since])) {
        if (runtime.stopping) break;
        const steps = fresh(await endorsePlan(id, { since }));
        if (steps.length) await run(id, steps);
      }
    } catch (e) { log.warn(`endorse: ${(e as Error)?.message || e}`); }
    setTimeout(tick, everyMs).unref?.();
  };
  // A switch left pending across a restart is picked up within a minute; the library-wide sweep keeps its long start delay.
  setTimeout(pendingTick, Math.min(delayMs, 60_000)).unref?.();
  setTimeout(tick, delayMs).unref?.();
}
