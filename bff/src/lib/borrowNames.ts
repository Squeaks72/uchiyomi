import { q, one } from './db';
import { getSource, listSources, type SourceAdapter } from './sources';
import { searchAll } from './searchAll';
import { healthAll, isDisabled } from './sourceHealth';
import { assess, verdict, followable } from './fill';
import { chapterName } from './library';

/**
 * Give a chapter its name from ANOTHER source, when its own source only ever says "Chapter 12".
 *
 * Plenty of sources publish no chapter titles at all -- Weeb Central answers "Chapter 1", "Chapter 2" for
 * the whole of One Piece -- while another source has had "Romance Dawn" all along. The names are the same
 * work's names; only the source differs.
 *
 * ⚠️ THE HAZARD IS NUMBERING, NOT NAMES. Matching a name to a chapter by its number is only sound if both
 * sources number the work the same way, and they often do not: one counts a side story, another splits a
 * chapter, another starts after a prologue. Past the point where two sources diverge, EVERY borrowed name
 * is wrong -- and wrong in the worst possible way, because a plausible title is exactly what someone uses
 * to decide what to read next, and nothing on screen would look amiss.
 *
 * So this does not match by number. It reuses the one rule the app already applies before it will take
 * chapters from a second source (lib/fill.ts): at least 90 % of the numbers we hold are listed there, and
 * the verdict agrees the numbering lines up. A donor that fails is not used at all -- no names, rather
 * than names that might be shifted by one.
 *
 * Everything it writes is marked. `lib_books.title_source` records which source a borrowed name came from,
 * so a bad donor can be identified and cleared in bulk, and so nothing here can be mistaken for a name the
 * chapter's own source supplied. It never touches a chapter that already has a real name, and never one an
 * admin retitled.
 *
 * Off by default, per server and per series, because it is outbound traffic to a source that carries
 * nothing else for you.
 */

/** How many candidate donors are asked before giving up, per run. Outbound traffic to strangers. */
const MAX_DONORS = 4;
/** How long the discovery search may take. Generous: this runs on the nightly sweep, not in a request. */
const SEARCH_WAIT_MS = 20_000;

export interface BorrowResult {
  filled: number;
  donor?: string;
  /** Why nothing was written, when nothing was. Never swallowed: this ends up in the sweep's log. */
  why?: 'off' | 'nothing_to_do' | 'no_donor' | 'no_names';
}

interface SeriesRow {
  id: string; title: string;
  source_id: string | null; source_series_id: string | null;
  borrow_names: boolean | null;
  name_donor: { source?: string; sourceId?: string } | null;
}

/** A title that just restates its own number, in any of the usual spellings. */
const isBare = (title: string | null, number: number) => !chapterName(title, number);

async function enabledFor(s: SeriesRow): Promise<boolean> {
  if (s.borrow_names !== null) return s.borrow_names;
  const g = await one<{ borrow_names: boolean }>('SELECT borrow_names FROM server_settings WHERE id = 1')
    .catch(() => null);
  return !!g?.borrow_names;
}

/** Sources this viewer-less job may ask: everything registered, minus the series' own and anything disabled. */
async function donorPool(exclude: string | null): Promise<SourceAdapter[]> {
  const out: SourceAdapter[] = [];
  for (const src of listSources()) {
    if (src.id === exclude) continue;
    if (await isDisabled(src.id).catch(() => false)) continue;
    out.push(src);
  }
  return out;
}

/**
 * Does this candidate's numbering line up with ours closely enough to hang names off it?
 *
 * Returns the candidate's chapter list when it does, so the caller does not list it twice.
 */
async function aligned(src: SourceAdapter, theirSeriesId: string, have: number[]) {
  const theirs = await src.listChapters(theirSeriesId).catch(() => null);
  if (!theirs?.length) return null;
  const nums = theirs.map((c) => c.number).filter((n) => Number.isFinite(n));
  const a = assess(have, nums);
  if (!followable({ coverage: a.coverage, why: verdict(a, nums.length) })) return null;
  return theirs;
}

export async function borrowChapterNames(seriesId: string): Promise<BorrowResult> {
  const s = await one<SeriesRow>(
    `SELECT id, title, source_id, source_series_id, borrow_names, name_donor
       FROM lib_series WHERE id = $1 AND deleted_at IS NULL AND merged_into IS NULL`, [seriesId]).catch(() => null);
  if (!s) return { filled: 0, why: 'nothing_to_do' };
  if (!await enabledFor(s)) return { filled: 0, why: 'off' };

  // Only LIVE chapters, and only ones still named after their own number. A name already borrowed counts
  // as named: re-deciding it every night would let two donors fight over the same row forever.
  const books = await q<{ id: string; number: number; title: string | null }>(
    `SELECT id, number, title FROM lib_books WHERE series_id = $1 AND pruned_at IS NULL`, [seriesId]).catch(() => []);
  if (!books.length) return { filled: 0, why: 'nothing_to_do' };
  const nameless = books.filter((b) => isBare(b.title, b.number));
  if (!nameless.length) return { filled: 0, why: 'nothing_to_do' };
  const have = books.map((b) => Number(b.number)).filter((n) => Number.isFinite(n));

  // The donor remembered from last time, first: discovery is a cross-source search, and repeating it every
  // night for a series whose donor has not changed is the expensive way to get the same answer.
  const tried = new Set<string>();
  let donor: { src: SourceAdapter; theirSeriesId: string; chapters: Awaited<ReturnType<SourceAdapter['listChapters']>> } | null = null;
  const remembered = s.name_donor?.source ? getSource(s.name_donor.source) : null;
  if (remembered && s.name_donor?.sourceId) {
    tried.add(remembered.id);
    const chapters = await aligned(remembered, s.name_donor.sourceId, have);
    if (chapters) donor = { src: remembered, theirSeriesId: s.name_donor.sourceId, chapters };
  }

  if (!donor) {
    const pool = await donorPool(s.source_id);
    if (pool.length) {
      const health = new Map((await healthAll().catch(() => [])).map((h) => [h.source_id, h] as const));
      const answer = await searchAll(s.title, pool, { waitMs: SEARCH_WAIT_MS, health }).catch(() => null);
      // The hits whose title matches ours, in the order the search ranked them, capped.
      const cands: { source: string; sourceId: string }[] = [];
      for (const group of answer?.content ?? []) {
        for (const p of group.providers ?? []) {
          if (p.source && p.sourceId && !tried.has(p.source)) cands.push({ source: p.source, sourceId: p.sourceId });
        }
      }
      for (const c of cands.slice(0, MAX_DONORS)) {
        if (tried.has(c.source)) continue;
        tried.add(c.source);
        const src = getSource(c.source);
        if (!src) continue;
        const chapters = await aligned(src, c.sourceId, have);
        if (chapters) { donor = { src, theirSeriesId: c.sourceId, chapters }; break; }
      }
    }
  }
  if (!donor) return { filled: 0, why: 'no_donor' };

  // One name per number, only where the donor actually has one worth taking.
  const byNumber = new Map<number, string>();
  for (const c of donor.chapters) {
    if (!Number.isFinite(c.number)) continue;
    const name = chapterName(c.title, c.number);
    if (name && !byNumber.has(c.number)) byNumber.set(c.number, name);
  }
  const writes = nameless
    .map((b) => ({ id: b.id, name: byNumber.get(Number(b.number)) }))
    .filter((w): w is { id: string; name: string } => !!w.name);

  // Remember the donor even when it had no names for us: it is still the source whose numbering matched,
  // and re-searching every night to rediscover that would be the whole cost for none of the benefit.
  await q('UPDATE lib_series SET name_donor = $2::jsonb WHERE id = $1',
    [seriesId, JSON.stringify({ source: donor.src.id, sourceId: donor.theirSeriesId })]).catch(() => {});

  if (!writes.length) return { filled: 0, donor: donor.src.id, why: 'no_names' };

  const params: any[] = [donor.src.id];
  const tuples = writes.map((w) => {
    params.push(w.id, w.name);
    return `($${params.length - 1}, $${params.length})`;
  });
  await q(
    `UPDATE lib_books b SET title = v.name, title_source = $1, updated_at = now()
       FROM (VALUES ${tuples.join(',')}) AS v(id, name)
      WHERE b.id = v.id`,
    params,
  );
  console.log(`[names] "${s.title}": ${writes.length} chapter name(s) from ${donor.src.name}`);
  return { filled: writes.length, donor: donor.src.id };
}

/** Undo every borrowed name for a series (or all of them), back to the number-only title. */
export async function clearBorrowedNames(seriesId?: string): Promise<number> {
  const rows = seriesId
    ? await q<{ id: string }>(
        `UPDATE lib_books SET title = 'Chapter ' || trim(trailing '.' from trim(trailing '0' from number::text)),
                title_source = NULL, updated_at = now()
          WHERE series_id = $1 AND title_source IS NOT NULL RETURNING id`, [seriesId])
    : await q<{ id: string }>(
        `UPDATE lib_books SET title = 'Chapter ' || trim(trailing '.' from trim(trailing '0' from number::text)),
                title_source = NULL, updated_at = now()
          WHERE title_source IS NOT NULL RETURNING id`);
  return rows.length;
}
