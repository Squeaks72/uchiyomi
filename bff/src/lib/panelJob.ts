import { join } from 'path';
import { pool, q } from './db';
import { cbzPageAt, LIBRARY_ROOT, onScanDone } from './library';
import { catalogRootUnavailable } from './catalogRootGuard';
import { detectPanels, PANEL_VERSION, releaseModels, TIER_ORDER, type Box, type Tier } from './panelDetect';

/**
 * Panel detection over the library (Reader → Panel view; Admin → Panel detection), shaped after `pageHashJob.ts`: an advisory lock so
 * two processes cannot both walk the library, a breath between chapters, progress the Tasks panel reads, and a schedule that
 * keeps checking. Three ways in, all through `detectBook`:
 *   - a pass over every chapter not yet looked at, nightly (Admin → Panel detection → Nightly)
 *   - the same pass shortly after a scan landed new chapters (an import, an upload, a download) -- "On import"
 *   - a person asking, for a series, a chapter, or the pages they rejected -- including "Try harder", which runs the next tier
 *     up and ADDS its answer beside the earlier ones (page_panels.candidates), so nothing is lost and the right one can be chosen
 *
 * The detector is WebAssembly on one thread, so everything here runs one chapter at a time: `exclusive` serialises the on-demand
 * work with the passes. Nothing is detected unless an admin switched a pass on or someone asked.
 */
const LOCK = 0x70616e6c; // 'panl'
/** Chapters per batch of the backfill. */
const BATCH = 10;

export interface PanelProgress {
  running: boolean;
  /** What is running: a pass over the library, or someone's request. */
  mode: 'pass' | 'request' | null;
  tier: Tier | null;
  chapters: number;
  pages: number;
  failed: number;
  remaining: number | null;
  /** The chapter being worked on, for the status line. */
  current: string | null;
  queued: number;
  startedAt: number | null;
  finishedAt: number | null;
  ms: number | null;
  lastError: string | null;
}

export const panelState: PanelProgress = {
  running: false, mode: null, tier: null, chapters: 0, pages: 0, failed: 0, remaining: null, current: null, queued: 0,
  startedAt: null, finishedAt: null, ms: null, lastError: null,
};

// ---- settings ----

export interface PanelSettings { nightly: boolean; onImport: boolean; tier: Tier; hour: number; lastRun: Date | null }

export async function panelSettings(): Promise<PanelSettings> {
  const r = await q<{ n: boolean; i: boolean; t: string; h: number; l: Date | null }>(
    'SELECT panels_nightly AS n, panels_on_import AS i, panels_tier AS t, panels_hour AS h, panels_last_run AS l FROM server_settings WHERE id = 1',
  ).catch(() => []);
  const s = r[0];
  return {
    nightly: !!s?.n, onImport: !!s?.i,
    tier: (TIER_ORDER as readonly string[]).includes(s?.t ?? '') ? (s!.t as Tier) : 'fast',
    hour: Number.isInteger(s?.h) ? s!.h : 5,
    lastRun: s?.l ?? null,
  };
}

// ---- storage ----

/** A box as it is stored and sent: four page fractions to four places, [x, y, w, h]. */
export type StoredBox = [number, number, number, number];
const store = (b: Box): StoredBox => [+b.x.toFixed(4), +b.y.toFixed(4), +b.w.toFixed(4), +b.h.toFixed(4)];

export interface PageRow {
  page: number;
  width: number | null;
  height: number | null;
  candidates: Partial<Record<Tier, { boxes: StoredBox[] }>>;
  chosen: Tier | null;
  rejected: boolean;
  textH: number | null;
}

export async function panelRows(bookId: string): Promise<PageRow[]> {
  const rows = await q<{ page: number; width: number | null; height: number | null; candidates: PageRow['candidates']; chosen: string | null; rejected: boolean; text_h: number | null }>(
    'SELECT page, width, height, candidates, chosen, rejected, text_h FROM page_panels WHERE book_id = $1 AND page >= 1 ORDER BY page', [bookId],
  );
  return rows.map((r) => ({
    page: r.page, width: r.width, height: r.height, candidates: r.candidates ?? {},
    chosen: (TIER_ORDER as readonly string[]).includes(r.chosen ?? '') ? (r.chosen as Tier) : null,
    rejected: r.rejected, textH: r.text_h,
  }));
}

/** What a reader gets for each page of a chapter: the chosen candidate's boxes, unless there is none or it was rejected. */
export async function panelsFor(bookId: string): Promise<Map<number, { boxes: StoredBox[]; textH: number | null }>> {
  const out = new Map<number, { boxes: StoredBox[]; textH: number | null }>();
  for (const r of await panelRows(bookId)) {
    if (r.rejected || !r.chosen) continue;
    const boxes = r.candidates[r.chosen]?.boxes;
    if (boxes && boxes.length > 1) out.set(r.page, { boxes, textH: r.textH });
    else if (r.textH != null) out.set(r.page, { boxes: [], textH: r.textH });
  }
  return out;
}

/** The tier above the highest one a page has, or null at the top: what "try harder" runs. */
export function nextTier(have: Partial<Record<Tier, unknown>>): Tier | null {
  const tried = TIER_ORDER.filter((t) => have[t]);
  const top = tried.length ? TIER_ORDER.indexOf(tried[tried.length - 1]) : -1;
  return TIER_ORDER[top + 1] ?? null;
}

// ---- running ----

/** One thing at a time: the detector is single-threaded WebAssembly, and two chapters at once would only take twice as long each. */
let chain: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  panelState.queued++;
  const run = chain.then(() => { panelState.queued--; return fn(); });
  chain = run.catch(() => {});
  return run;
}

interface BookRow { id: string; root: string | null; file: string; number: number; title: string | null }

export interface DetectOptions {
  tier: Tier;
  /** Only these pages (1-based); all of them when absent. */
  pages?: number[];
  /** Detect again even where this tier already has an answer. */
  force?: boolean;
  /** Make this tier's answer the one readers get, and un-reject the page (a person asked for it). */
  choose?: boolean;
}

/** Detect the pages of one chapter. Returns how many pages were read and how many could not be. */
async function detectBookNow(b: BookRow, opts: DetectOptions): Promise<{ ok: number; bad: number }> {
  const abs = join(b.root || LIBRARY_ROOT, b.file);
  const want = opts.pages ? new Set(opts.pages) : null;
  const have = new Map((await panelRows(b.id)).map((r) => [r.page, r]));
  let ok = 0, bad = 0;
  for (let i = 0; ; i++) {
    const page = i + 1;
    if (want && !want.has(page)) { if (page >= Math.max(...want)) break; continue; }
    let img: Awaited<ReturnType<typeof cbzPageAt>> = null;
    try { img = await cbzPageAt(abs, i); } catch { break; }
    if (!img) break;
    const last = i + 1 >= img.total;
    const row = have.get(page);
    if (!opts.force && row?.candidates[opts.tier]) { if (last) break; continue; }
    try {
      const d = await detectPanels(img.bytes, opts.tier);
      const found = JSON.stringify({ [opts.tier]: { boxes: d.boxes.map(store) } });
      // Chosen: what a person asked for, or -- on a page with no answer yet -- this tier. Their rejection stands against a pass.
      await q(
        `INSERT INTO page_panels (book_id, page, width, height, candidates, chosen, rejected, text_h, ver, detected_at)
              VALUES ($1, $2, $3, $4, $5::jsonb, $6, false, $7, $8, now())
         ON CONFLICT (book_id, page) DO UPDATE SET
              width = EXCLUDED.width, height = EXCLUDED.height,
              candidates = page_panels.candidates || EXCLUDED.candidates,
              chosen = CASE WHEN $9::boolean OR page_panels.chosen IS NULL THEN EXCLUDED.chosen ELSE page_panels.chosen END,
              rejected = CASE WHEN $9::boolean THEN false ELSE page_panels.rejected END,
              text_h = COALESCE(EXCLUDED.text_h, page_panels.text_h), ver = EXCLUDED.ver, detected_at = now()`,
        [b.id, page, d.width, d.height, found, opts.tier, d.textH, PANEL_VERSION, !!opts.choose],
      );
      ok++;
      panelState.pages++;
    } catch (e) {
      bad++;
      panelState.failed++;
      panelState.lastError = (e as Error)?.message ?? String(e);
      // A model that cannot be downloaded or loaded fails every page: stop at the first, with the reason on the status line.
      if (/model|download|wasm|session/i.test(panelState.lastError)) throw e;
    }
    if (last) break;
    await new Promise((r) => setImmediate(r)); // a breath: the server is also answering requests
  }
  // The chapter's "looked at" mark, whether or not anything was found.
  await q(
    `INSERT INTO page_panels (book_id, page, ver, detected_at) VALUES ($1, 0, $2, now())
     ON CONFLICT (book_id, page) DO UPDATE SET ver = EXCLUDED.ver, detected_at = now()`,
    [b.id, PANEL_VERSION],
  ).catch(() => {});
  return { ok, bad };
}

async function bookRow(id: string): Promise<BookRow | null> {
  return (await q<BookRow>('SELECT id, root, file, number, title FROM lib_books WHERE id = $1 AND pruned_at IS NULL', [id]))[0] ?? null;
}

function beginRun(mode: 'pass' | 'request', tier: Tier) {
  panelState.running = true; panelState.mode = mode; panelState.tier = tier;
  panelState.startedAt = Date.now(); panelState.finishedAt = null;
  panelState.chapters = 0; panelState.pages = 0; panelState.failed = 0; panelState.lastError = null;
}
function endRun() {
  panelState.running = false; panelState.mode = null; panelState.current = null;
  panelState.finishedAt = Date.now();
  panelState.ms = panelState.finishedAt - (panelState.startedAt ?? panelState.finishedAt);
}

/** Detect chapters by id, for a person's request. Returns at once; the work is queued and its progress is `panelState`. */
export function requestDetect(bookIds: string[], opts: DetectOptions): void {
  void exclusive(async () => {
    beginRun('request', opts.tier);
    try {
      for (const id of bookIds) {
        const b = await bookRow(id);
        if (!b) continue;
        panelState.current = b.title || `Chapter ${b.number}`;
        await detectBookNow(b, { ...opts, choose: opts.choose ?? true });
        panelState.chapters++;
      }
    } catch (e) {
      panelState.lastError = (e as Error)?.message ?? String(e);
      console.warn('[panels] request failed:', panelState.lastError);
    } finally {
      endRun();
      // A model is tens of MB of memory: only a nightly pass that goes on to the next chapter should keep it loaded.
      releaseModels();
    }
  });
}

/** "Try harder" for some pages of a chapter: each runs the next tier above what it has. Groups pages by that tier. */
export async function requestHarder(bookId: string, pages?: number[]): Promise<{ queued: Record<string, number>; atTop: number }> {
  const rows = (await panelRows(bookId)).filter((r) => !pages || pages.includes(r.page));
  const byTier = new Map<Tier, number[]>();
  let atTop = 0;
  for (const r of rows) {
    const t = nextTier(r.candidates);
    if (!t) { atTop++; continue; }
    byTier.set(t, [...(byTier.get(t) ?? []), r.page]);
  }
  for (const [tier, ps] of byTier) requestDetect([bookId], { tier, pages: ps, choose: true });
  return { queued: Object.fromEntries([...byTier].map(([t, p]) => [t, p.length])), atTop };
}

// ---- the pass over the library ----

/** Chapters never looked at, or looked at under another PANEL_VERSION. */
export async function panelsRemaining(): Promise<number> {
  const rows = await q<{ n: string }>(
    `SELECT count(*)::text n FROM lib_books b
      WHERE b.pruned_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM page_panels p WHERE p.book_id = b.id AND p.page = 0 AND p.ver = $1)`, [PANEL_VERSION],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Detect every chapter not yet looked at, at the settings' tier. Safe to call repeatedly, and to interrupt. */
export async function runPanelBackfill(opts: { max?: number; tier?: Tier } = {}): Promise<PanelProgress> {
  const client = await pool.connect();
  let held = false;
  try {
    held = !!(await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [LOCK])).rows[0]?.ok;
  } finally {
    if (!held) client.release();
  }
  if (!held) return panelState;
  try {
    const tier = opts.tier ?? (await panelSettings()).tier;
    await exclusive(async () => {
      beginRun('pass', tier);
      const limit = opts.max ?? Infinity;
      try {
        // ⚠️ Not from a root that is not there: a chapter is marked looked-at whether or not it could be read, so a pass over an
        // unmounted share would retire every chapter on it for good (lib/catalogRootGuard.ts; the same note as pageHashJob.ts).
        const down: string[] = [];
        for (const { root } of await q<{ root: string }>(
          `SELECT DISTINCT COALESCE(b.root, $1) AS root FROM lib_books b WHERE b.pruned_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM page_panels p WHERE p.book_id = b.id AND p.page = 0 AND p.ver = $2)`, [LIBRARY_ROOT, PANEL_VERSION],
        )) {
          const why = await catalogRootUnavailable(root, LIBRARY_ROOT);
          if (why) { down.push(root); console.warn(`[panels] ${root} cannot be read (${why}) -- left for a later pass`); }
        }
        for (;;) {
          const batch = await q<BookRow>(
            `SELECT b.id, b.root, b.file, b.number, b.title FROM lib_books b
              WHERE b.pruned_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM page_panels p WHERE p.book_id = b.id AND p.page = 0 AND p.ver = $4)
                AND COALESCE(b.root, $2) <> ALL($3::text[])
              ORDER BY b.id LIMIT $1`,
            [Math.min(BATCH, Math.max(0, limit - panelState.chapters)), LIBRARY_ROOT, down, PANEL_VERSION],
          );
          if (!batch.length) break;
          for (const b of batch) {
            panelState.current = b.title || `Chapter ${b.number}`;
            await detectBookNow(b, { tier });
            panelState.chapters++;
          }
          panelState.remaining = await panelsRemaining().catch(() => null);
          if (panelState.chapters >= limit) break;
        }
      } catch (e) {
        panelState.lastError = (e as Error)?.message ?? String(e);
        console.warn('[panels] pass stopped:', panelState.lastError);
      } finally {
        endRun();
        releaseModels();
      }
    });
    await q('UPDATE server_settings SET panels_last_run = now() WHERE id = 1').catch(() => {});
    if (panelState.chapters) console.log(`[panels] ${panelState.chapters} chapters, ${panelState.pages} pages, ${panelState.failed} unreadable, ${panelState.ms}ms (${tier})`);
    return panelState;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK]).catch(() => {});
    client.release();
  }
}

// ---- when ----

/** How long after a scan landed to look for new chapters: a download arrives as a burst of scans, and one pass can cover them. */
const IMPORT_DELAY_MS = 90_000;
let importTimer: ReturnType<typeof setTimeout> | null = null;

/** After a scan: if "On import" is on, a pass over what is new, once the burst has settled. */
export function armPanelPass(delayMs = IMPORT_DELAY_MS): void {
  if (importTimer) clearTimeout(importTimer);
  importTimer = setTimeout(async () => {
    importTimer = null;
    try {
      const s = await panelSettings();
      if (s.onImport && !panelState.running) await runPanelBackfill({ tier: s.tier });
    } catch (e) { console.warn('[panels] import pass failed:', (e as Error)?.message); }
  }, delayMs);
  importTimer.unref?.();
}

/** Whether the nightly pass is due now: switched on, in its hour, and not already run today. */
export function nightlyDue(s: PanelSettings, now = new Date()): boolean {
  if (!s.nightly || now.getHours() !== s.hour) return false;
  const l = s.lastRun;
  return !l || l.getFullYear() !== now.getFullYear() || l.getMonth() !== now.getMonth() || l.getDate() !== now.getDate();
}

/** Start the schedule: new chapters after a scan ("On import"), and the nightly pass, checked every ten minutes. Returns a stopper. */
export function schedulePanelJobs(): () => void {
  onScanDone(() => armPanelPass());
  const tick = async () => {
    try {
      const s = await panelSettings();
      if (nightlyDue(s) && !panelState.running) await runPanelBackfill({ tier: s.tier });
    } catch (e) { console.warn('[panels] nightly check failed:', (e as Error)?.message); }
  };
  const timer = setInterval(tick, 10 * 60_000);
  timer.unref?.();
  return () => { clearInterval(timer); if (importTimer) clearTimeout(importTimer); };
}
