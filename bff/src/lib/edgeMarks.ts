import { stat } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import { pool, q, one } from './db';
import { cbzPageAt, LIBRARY_ROOT } from './library';

/**
 * Strips a source stamps onto every page (2026-11-18): a banner along the bottom ("This image is hosted at mangafox…", Dorohedoro
 * chapter 0) or a logo in a corner (mangareader.net on Dragon Ball). Found by what they are -- the same pixels at the same edge of
 * every page of a chapter, while the art under them changes -- and confirmed as writing, so a plain white margin or a 4-koma border,
 * which are as constant, are not taken for one.
 *
 * How: every sampled page is scaled to W wide in grey, and the edge band of each read from the page edge inward. Row by row, the
 * pages' spread from their median (70th percentile, so a few odd pages do not count) stays near zero through a stamped strip and
 * jumps where the art starts. The strip's own median rows must carry glyphs: many dark/light flips across a row. Measured on 300
 * random chapters of this library: Dorohedoro's banner and Dragon Ball's corner logo found, no margin or border taken for one.
 *
 * A mark is a finding only. Cutting it off is a per-source choice (source_trim), applied as pages are served (trimPage) and undone
 * by turning it off: nothing on disk changes.
 */
const W = 512;
/** How deep into a page a strip is looked for, in rows of the W-wide page (~60% of a page width). */
const BAND = 320;
/** The most pages of a chapter looked at, spread across it. */
const SAMPLE = 16;
/** Rows whose pages differ less than this (grey levels, of 255) are the same strip. */
const SAME = 6;

export interface EdgeMark {
  edge: 'top' | 'bottom';
  /** The width of the pages it is on, in pixels: pages of another width (a spread, a cover) are left alone. */
  width: number;
  /** How deep it is, in pixels of those pages, with a little to spare. */
  depth: number;
  /** Rows of it that read as writing, and how sharply the art starts under it -- what made it a mark. */
  text: number;
  step: number;
}

/** Rows of the band from the page edge inward. */
function bandRows(px: Buffer, height: number, edge: 'top' | 'bottom'): Uint8Array[] {
  const rows: Uint8Array[] = [];
  const n = Math.min(BAND, height);
  for (let i = 0; i < n; i++) {
    const y = edge === 'bottom' ? height - 1 - i : i;
    rows.push(px.subarray(y * W, y * W + W));
  }
  return rows;
}

/** The strip at one edge of pages of one width, if there is one. Exported for the tests. */
export function stripOf(pages: Uint8Array[][]): { k: number; text: number; step: number } | null {
  if (pages.length < 4) return null;
  const depth = Math.min(...pages.map((p) => p.length));
  const dev: number[] = [];
  const med: Uint8Array[] = [];
  const v = new Array<number>(pages.length);
  const d = new Array<number>(pages.length);
  for (let i = 0; i < depth; i++) {
    let s = 0;
    const mrow = new Uint8Array(W);
    for (let x = 0; x < W; x++) {
      for (let p = 0; p < pages.length; p++) v[p] = pages[p][i][x];
      v.sort((a, b) => a - b);
      const m = v[v.length >> 1];
      mrow[x] = m;
      for (let p = 0; p < pages.length; p++) d[p] = Math.abs(pages[p][i][x] - m);
      d.sort((a, b) => a - b);
      s += d[Math.floor(d.length * 0.7)];
    }
    dev.push(s / W);
    med.push(mrow);
    // Past the strip and well into the art: nothing more to learn, and the rest of the band is the slow part.
    if (i > 16 && dev[i] > SAME && dev[i - 8] > SAME) break;
  }
  let k = 0;
  while (k < dev.length && dev[k] <= SAME) k++;
  if (k < 8 || k >= depth - 8) return null;
  let text = 0;
  for (let i = 0; i < k; i++) {
    const r = med[i];
    let lo = 255, hi = 0;
    for (const x of r) { if (x < lo) lo = x; if (x > hi) hi = x; }
    if (hi - lo < 60) continue;
    const t = (lo + hi) / 2;
    let flips = 0;
    for (let x = 1; x < W; x++) if ((r[x] < t) !== (r[x - 1] < t)) flips++;
    if (flips >= 30) text++;
  }
  const after = dev.slice(k, k + 8);
  const step = after.reduce((a, b) => a + b, 0) / Math.max(1, after.length);
  return { k, text, step: Math.round(step * 10) / 10 };
}

/** A strip counts as a source's stamp when it carries writing and the art changes sharply under it. */
export const isStamp = (s: { text: number; step: number }) => s.text >= 3 && s.step >= 15;

/** The marks on one chapter file: null when it could not be read (missing, not an archive) -- it is then not recorded. */
export async function marksOf(abs: string): Promise<EdgeMark[] | null> {
  let first: Awaited<ReturnType<typeof cbzPageAt>>;
  try { first = await cbzPageAt(abs, 0); } catch { return null; }
  if (!first) return [];
  const total = first.total;
  const idx = total <= SAMPLE ? [...Array(total).keys()] : [...new Set(Array.from({ length: SAMPLE }, (_, i) => Math.round((i * (total - 1)) / (SAMPLE - 1))))];
  const byWidth = new Map<number, Array<{ px: Buffer; h: number }>>();
  for (const i of idx) {
    let page = i === 0 ? first : null;
    if (!page) { try { page = await cbzPageAt(abs, i); } catch { page = null; } }
    if (!page) continue;
    try {
      const img = sharp(page.bytes, { limitInputPixels: 120_000_000, animated: false });
      const m = await img.metadata();
      if (!m.width || !m.height || m.height < 300) continue;
      const { data, info } = await img.greyscale().resize({ width: W }).raw().toBuffer({ resolveWithObject: true });
      if (info.channels !== 1) continue;
      const g = byWidth.get(m.width) ?? [];
      g.push({ px: data, h: info.height });
      byWidth.set(m.width, g);
    } catch { /* an image sharp cannot read is skipped */ }
  }
  const out: EdgeMark[] = [];
  for (const [width, g] of byWidth) {
    if (g.length < 4) continue;
    for (const edge of ['bottom', 'top'] as const) {
      const s = stripOf(g.map((p) => bandRows(p.px, p.h, edge)));
      if (s && isStamp(s)) out.push({ edge, width, depth: Math.ceil(((s.k + 2) * width) / W), text: s.text, step: s.step });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------
// The pass over the library: shaped after pageHashJob.ts (an advisory lock, batches, progress, re-armed every six hours).

const LOCK = 0x65646765; // 'edge'
const BATCH = 20;

export interface EdgeMarkProgress { running: boolean; chapters: number; marked: number; remaining: number | null; startedAt: number | null; finishedAt: number | null }
export const emState: EdgeMarkProgress = { running: false, chapters: 0, marked: 0, remaining: null, startedAt: null, finishedAt: null };

interface Todo { path: string; book_id: string; source_id: string | null; is_version: boolean }

/** Every chapter file there is: each endorsed copy (with its mtime, ms) and every other source's kept copy. */
const FILES = `
    SELECT COALESCE(b.root, $1) || '/' || b.file AS path, b.id AS book_id, b.source_id, false AS is_version, b.mtime
      FROM lib_books b WHERE b.pruned_at IS NULL AND b.file IS NOT NULL
    UNION ALL
    SELECT v.root || '/' || v.file, v.book_id, v.source_id, true, NULL::bigint FROM lib_book_versions v WHERE v.file IS NOT NULL AND v.root IS NOT NULL`;
/**
 * The files not looked at yet -- or replaced since: an endorse or a refetch writes a new file at the same path, and the catalog's mtime
 * for it then differs from the one recorded.
 */
const TODO = `
  WITH f AS (${FILES})
  SELECT f.path, f.book_id, f.source_id, f.is_version FROM f
   WHERE NOT EXISTS (SELECT 1 FROM edge_marks e WHERE e.path = f.path AND (f.mtime IS NULL OR e.mtime IS NULL OR abs(e.mtime - f.mtime) < 2000))`;

export async function edgeMarksRemaining(): Promise<number> {
  const r = await one<{ n: string }>(`SELECT count(*)::text n FROM (${TODO}) t`, [LIBRARY_ROOT]).catch(() => null);
  return Number(r?.n ?? 0);
}

/** Look at one file and record what was found. A file that cannot be read is not recorded, so a later pass tries it again. */
export async function checkFile(t: Todo): Promise<EdgeMark[] | null> {
  const st = await stat(t.path).catch(() => null);
  if (!st) return null;
  const marks = await marksOf(t.path);
  if (!marks) return null;
  await q(
    `INSERT INTO edge_marks (path, book_id, source_id, is_version, mtime, marks, checked_at) VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (path) DO UPDATE SET book_id = $2, source_id = $3, is_version = $4, mtime = $5, marks = $6, checked_at = now()`,
    [t.path, t.book_id, t.source_id, t.is_version, Math.round(st.mtimeMs), JSON.stringify(marks)]);
  return marks;
}

export async function runEdgeMarks(opts: { max?: number } = {}): Promise<EdgeMarkProgress> {
  const client = await pool.connect();
  let held = false;
  try {
    held = !!(await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK])).rows[0]?.ok;
    if (!held) return emState;
  } finally { if (!held) client.release(); }
  Object.assign(emState, { running: true, chapters: 0, marked: 0, startedAt: Date.now(), finishedAt: null });
  const limit = opts.max ?? Infinity;
  // Files handled this pass: not asked for again until the next one.
  const skip: string[] = [];
  try {
    for (;;) {
      const batch = await q<Todo>(`SELECT * FROM (${TODO}) t WHERE NOT (t.path = ANY($3::text[])) ORDER BY t.path LIMIT $2`,
        [LIBRARY_ROOT, Math.min(BATCH, Math.max(0, limit - emState.chapters)), skip]);
      if (!batch.length) break;
      for (const t of batch) {
        // Never twice in one pass, read or not: a file replaced moments ago may not have its new mtime in the catalog yet.
        skip.push(t.path);
        const m = await checkFile(t).catch(() => null);
        if (!m) continue;
        emState.chapters++;
        if (m.length) emState.marked++;
        // A breath between files: this decodes pages, and the server is answering readers at the same time.
        await new Promise((r) => setTimeout(r, 50));
      }
      emState.remaining = await edgeMarksRemaining();
      if (emState.chapters >= limit) break;
    }
    // Rows for files that are gone (a kept copy deleted, a chapter pruned) would keep counting in the report.
    await q(`DELETE FROM edge_marks e WHERE NOT EXISTS (SELECT 1 FROM (${FILES}) f WHERE f.path = e.path)`, [LIBRARY_ROOT]).catch(() => {});
    return emState;
  } finally {
    emState.running = false;
    emState.finishedAt = Date.now();
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK]).catch(() => {});
    client.release();
    if (emState.chapters) console.log(`[edgemarks] ${emState.chapters} chapters looked at, ${emState.marked} with a stamped strip`);
  }
}

/** Twenty minutes after boot (after the page-hash pass has had its start), then every six hours for what has arrived since. */
export function scheduleEdgeMarks(delayMs = 20 * 60_000, everyMs = 6 * 60 * 60_000, run = runEdgeMarks): void {
  const tick = async () => {
    try { await run(); } catch (e) { console.warn('[edgemarks] pass failed', (e as Error)?.message); }
    setTimeout(tick, everyMs).unref?.();
  };
  setTimeout(tick, delayMs).unref?.();
}

// ---------------------------------------------------------------------------------------------------------------------------
// Cutting a strip off as a page is served, for the sources the admin turned it on for.

let trimSources: { at: number; set: Set<string> } | null = null;
export function forgetTrimSources(): void { trimSources = null; forgetTrimRows(); }
async function trimOn(sourceId: string): Promise<boolean> {
  if (!trimSources || Date.now() - trimSources.at > 60_000) {
    const rows = await q<{ source_id: string }>('SELECT source_id FROM source_trim').catch(() => []);
    trimSources = { at: Date.now(), set: new Set(rows.map((r) => r.source_id)) };
  }
  return trimSources.set.has(sourceId);
}

/**
 * The strips to cut off a file's pages as they are served, and a tag for the cache key: null when there are none -- the file is
 * clean, its source is not trimmed, or it changed since it was looked at.
 */
type TrimRow = { source_id: string | null; mtime: string | null; marks: EdgeMark[] } | null;
/**
 * The edge_marks row for a file, kept 30 seconds (including "there is none", which is nearly every file): this ran one query per PAGE
 * served, cached or not. A strip found by the pass shows up within the half minute, and marks are written by that pass alone.
 */
const trimRows = new Map<string, { at: number; row: TrimRow }>();
const TRIM_ROWS_TTL_MS = 30_000;
const TRIM_ROWS_MAX = 5000;
export function forgetTrimRows(): void { trimRows.clear(); }
async function trimRowOf(abs: string): Promise<TrimRow> {
  const hit = trimRows.get(abs);
  if (hit && Date.now() - hit.at < TRIM_ROWS_TTL_MS) return hit.row;
  const row = await one<NonNullable<TrimRow>>(
    `SELECT source_id, mtime::text, marks FROM edge_marks WHERE path = $1 AND marks <> '[]'::jsonb`, [abs]).catch(() => null);
  if (trimRows.size >= TRIM_ROWS_MAX) trimRows.delete(trimRows.keys().next().value as string);
  trimRows.set(abs, { at: Date.now(), row });
  return row;
}

export async function trimFor(abs: string, mtimeMs: number): Promise<{ marks: EdgeMark[]; tag: string } | null> {
  const row = await trimRowOf(abs);
  if (!row?.source_id || !row.marks.length) return null;
  if (row.mtime && Number(row.mtime) !== Math.round(mtimeMs)) return null;
  if (!(await trimOn(row.source_id))) return null;
  return { marks: row.marks, tag: `:trim${row.marks.map((m) => `${m.edge[0]}${m.width}x${m.depth}`).join('')}` };
}

/** The page with the strips at its width cut off. A page of another width, or one that would lose most of itself, is unchanged. */
export async function trimPage(bytes: Buffer, marks: EdgeMark[]): Promise<{ buffer: Buffer; contentType: string } | null> {
  const m = await sharp(bytes).metadata().catch(() => null);
  if (!m?.width || !m.height) return null;
  const mine = marks.filter((x) => x.width === m.width);
  if (!mine.length) return null;
  const top = mine.filter((x) => x.edge === 'top').reduce((a, x) => Math.max(a, x.depth), 0);
  const bottom = mine.filter((x) => x.edge === 'bottom').reduce((a, x) => Math.max(a, x.depth), 0);
  const height = m.height - top - bottom;
  if (height < m.height * 0.6) return null;
  const buffer = await sharp(bytes).extract({ left: 0, top, width: m.width, height }).webp({ quality: 92 }).toBuffer();
  return { buffer, contentType: 'image/webp' };
}
