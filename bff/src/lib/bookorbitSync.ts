// Two-way reading-state sync between Uchiyomi and BookOrbit (Admin → Settings → BookOrbit sync).
//
// A chapter is the same file in both apps, so chapters are matched by PATH, never by title: Uchiyomi's `lib_books.file`
// (relative to the downloads folder) is BookOrbit's `book_files.absolute_path` minus `path_prefix` (`/books/manga` when
// the downloads folder is mounted there). Both apps number pages from 1 and show a finished chapter as 100%.
//
// WHAT TRAVELS: the page, and "finished". Uchiyomi → BookOrbit goes through BookOrbit's API (PUT /reading-progress), so its
// read status and statistics stay its own business. BookOrbit → Uchiyomi is READ from BookOrbit's database through a
// read-only role (BookOrbit has no "what changed since" endpoint, and a poll of its lists can miss a chapter finished
// between two looks), and written through `writeProgress`, so a chapter read in BookOrbit counts in Uchiyomi's history,
// streaks and trackers exactly like one read there.
//
// THE RULES (`decide`, pure, tested):
//   - each side is compared with what it looked like at the last sync (`bookorbit_sync_state`), so only a side that MOVED
//     is copied, and a copy never echoes back;
//   - both moved: the newer one wins, except that finished beats unfinished -- the sync never marks anything unread, and
//     never lowers a finished chapter on the other side;
//   - a chapter with no counterpart (a series BookOrbit does not hold) is skipped, and picked up when it appears.
import { Pool } from 'pg';
import { posix } from 'path';
import { q, one } from './db';
import { DL_ROOT, cbzPages } from './library';
import { open as unseal, seal } from './secretbox';
import { writeProgress } from './progress';
import { reachedEnd } from './progressRules';

export interface Side { page: number; done: boolean; at: number }
export interface Snap { uiPage: number; uiDone: boolean; boPage: number; boDone: boolean }
export type Decision = { action: 'none' } | { action: 'push'; page: number; done: boolean } | { action: 'pull'; page: number; done: boolean };

/** Is a BookOrbit percentage a finished chapter? Its reader writes exactly 100 on the last page. */
export const boDone = (pct: number | null | undefined): boolean => (pct ?? 0) >= 99.99;

/**
 * What to do with one chapter, given each side's state (null: no progress there) and the state both had at the last sync.
 * `at` is each side's own timestamp, ms.
 */
export function decide(ui: Side | null, bo: Side | null, snap: Snap | null): Decision {
  if (!ui && !bo) return { action: 'none' };
  const uiChanged = !!ui && (!snap || ui.page !== snap.uiPage || ui.done !== snap.uiDone);
  const boChanged = !!bo && (!snap || bo.page !== snap.boPage || bo.done !== snap.boDone);
  if (!uiChanged && !boChanged) return { action: 'none' };

  const push = (): Decision => {
    // Never lowers a finished chapter, and never pushes an empty place.
    if (!ui || (bo?.done && !ui.done) || (ui.page <= 0 && !ui.done)) return { action: 'none' };
    if (bo && bo.page === ui.page && bo.done === ui.done) return { action: 'none' };
    return { action: 'push', page: ui.page, done: ui.done };
  };
  const pull = (): Decision => {
    if (!bo || (ui?.done && !bo.done) || (bo.page <= 0 && !bo.done)) return { action: 'none' };
    if (ui && ui.page === bo.page && ui.done === bo.done) return { action: 'none' };
    return { action: 'pull', page: bo.page, done: bo.done };
  };

  if (uiChanged && !boChanged) return push();
  if (boChanged && !uiChanged) return pull();
  // Both moved since the last look (or this is the first look and both have a place).
  if (ui!.done !== bo!.done) return ui!.done ? push() : pull();
  return bo!.at > ui!.at ? pull() : push();
}

// ---- settings -------------------------------------------------------------------------------------------------------

export interface Link {
  user_id: string;
  enabled: boolean;
  url: string;
  username: string;
  password: string;      // opened
  db_url: string;        // opened
  path_prefix: string;
  last_run: string | null;
  last_result: any;
  full_at: string | null;
}

export async function getLink(): Promise<Link | null> {
  const r = await one<any>('SELECT * FROM bookorbit_link LIMIT 1').catch(() => null);
  if (!r) return null;
  return { ...r, password: r.password_enc ? unseal(r.password_enc, 'bookorbit') ?? '' : '', db_url: r.db_url_enc ? unseal(r.db_url_enc, 'bookorbit') ?? '' : '' };
}

export async function saveLink(userId: string, f: {
  enabled?: boolean; url?: string; username?: string; password?: string; dbUrl?: string; pathPrefix?: string;
}): Promise<void> {
  const cur = await one<{ user_id: string }>('SELECT user_id FROM bookorbit_link LIMIT 1');
  if (!cur) await q('INSERT INTO bookorbit_link (user_id) VALUES ($1)', [userId]);
  const set: string[] = [];
  const vals: any[] = [];
  const add = (col: string, v: any) => { vals.push(v); set.push(`${col} = $${vals.length}`); };
  if (f.enabled !== undefined) add('enabled', f.enabled);
  if (f.url !== undefined) add('url', f.url.trim().replace(/\/+$/, ''));
  if (f.username !== undefined) add('username', f.username.trim());
  if (f.password) add('password_enc', seal(f.password, 'bookorbit'));
  if (f.dbUrl) add('db_url_enc', seal(f.dbUrl, 'bookorbit'));
  if (f.pathPrefix !== undefined) add('path_prefix', '/' + f.pathPrefix.trim().replace(/^\/+|\/+$/g, ''));
  if (f.enabled === true || f.url !== undefined || f.username !== undefined || f.password || f.dbUrl || f.pathPrefix !== undefined) set.push('full_at = NULL');
  if (!set.length) return;
  await q(`UPDATE bookorbit_link SET ${set.join(', ')}, user_id = COALESCE(user_id, $${vals.length + 1})`, [...vals, userId]);
}

// ---- BookOrbit ------------------------------------------------------------------------------------------------------

let pool: { key: string; p: Pool } | null = null;
function boDb(dbUrl: string): Pool {
  if (pool?.key === dbUrl) return pool.p;
  void pool?.p.end().catch(() => {});
  const p = new Pool({ connectionString: dbUrl, max: 2, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
  p.on('error', () => {});
  pool = { key: dbUrl, p };
  return p;
}

let token: { key: string; value: string } | null = null;
async function boFetch(link: Link, path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const key = `${link.url}|${link.username}|${link.password}`;
  if (token?.key !== key) {
    const r = await fetch(`${link.url}/api/v1/auth/login`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: link.username, password: link.password, clientKind: 'native', deviceLabel: 'Uchiyomi sync' }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(r.status === 401 ? 'BookOrbit refused that username and password' : `BookOrbit sign-in answered ${r.status}`);
    const b: any = await r.json();
    const t = b.accessToken ?? b.access_token ?? b.token;
    if (!t) throw new Error('BookOrbit sign-in gave no token');
    token = { key, value: t };
  }
  const res = await fetch(`${link.url}/api/v1${path}`, {
    ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token.value}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(20000),
  });
  if (res.status === 401 && retry) { token = null; return boFetch(link, path, init, false); }
  return res;
}

interface BoRow { file_id: number; path: string; pct: number; page: number | null; at: Date }

/** BookOrbit's progress rows under the prefix for this BookOrbit user, optionally only those touched since `since`. */
async function boRows(link: Link, boUserId: number, since: Date | null): Promise<BoRow[]> {
  const r = await boDb(link.db_url).query(
    `SELECT rp.book_file_id AS file_id, bf.absolute_path AS path, rp.percentage AS pct, rp.page_number AS page, rp.last_read_at AS at
       FROM reading_progress rp JOIN book_files bf ON bf.id = rp.book_file_id
      WHERE rp.user_id = $1 AND bf.role = 'content' AND bf.absolute_path LIKE $2 ${since ? 'AND rp.last_read_at >= $3' : ''}`,
    since ? [boUserId, `${link.path_prefix}/%`, since] : [boUserId, `${link.path_prefix}/%`]);
  return r.rows;
}

async function boFileIds(link: Link, paths: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < paths.length; i += 500) {
    const r = await boDb(link.db_url).query(
      `SELECT id, absolute_path FROM book_files WHERE role = 'content' AND absolute_path = ANY($1)`, [paths.slice(i, i + 500)]);
    for (const row of r.rows) out.set(row.absolute_path, row.id);
  }
  return out;
}

async function boUserId(link: Link): Promise<number> {
  const r = await boDb(link.db_url).query('SELECT id FROM users WHERE lower(username) = lower($1)', [link.username]);
  if (!r.rows[0]) throw new Error(`BookOrbit has no user "${link.username}"`);
  return r.rows[0].id;
}

// ---- the pass -------------------------------------------------------------------------------------------------------

export interface Result { pushed: number; pulled: number; skipped: number; superseded: number; ms: number; full: boolean; error?: string }
let running = false;
export const syncRunning = () => running;

interface Row { rel: string; bookId: string; seriesId: string; pages: number; ui?: Side; bo?: Side & { fileId: number }; snap: Snap | null }

/** One pass. `full` looks at every chapter either side has a place in; otherwise only what moved since the last pass. */
export async function runSync(opts: { full?: boolean } = {}): Promise<Result | null> {
  if (running) return null;
  const link = await getLink();
  if (!link?.enabled || !link.url || !link.username || !link.password || !link.db_url) return null;
  running = true;
  const t0 = Date.now();
  const res: Result = { pushed: 0, pulled: 0, skipped: 0, superseded: 0, ms: 0, full: false };
  try {
    const lastFull = link.full_at ? new Date(link.full_at).getTime() : 0;
    const full = !!opts.full || !lastFull || Date.now() - lastFull > 6 * 3600_000;
    res.full = full;
    const since = full ? null : new Date((link.last_run ? new Date(link.last_run).getTime() : t0) - 20_000);
    const userId = link.user_id;
    const prefix = link.path_prefix;
    const boUid = await boUserId(link);

    const rows = new Map<string, Row>();
    const ensure = (rel: string): Row => {
      let r = rows.get(rel);
      if (!r) rows.set(rel, (r = { rel, bookId: '', seriesId: '', pages: 0, snap: null }));
      return r;
    };

    // Uchiyomi's side.
    const ui = await q<{ file: string; id: string; series_id: string; pages: number; page: number; completed: boolean; at: Date }>(
      `SELECT b.file, b.id, b.series_id, b.pages, p.page, p.completed, p.updated_at AS at
         FROM read_progress p JOIN lib_books b ON b.id = p.book_id
        WHERE p.user_id = $1 AND b.root = $2 AND NOT p.incognito ${since ? 'AND p.updated_at >= $3' : ''}`,
      since ? [userId, DL_ROOT, since] : [userId, DL_ROOT]);
    for (const r of ui) {
      const row = ensure(r.file);
      Object.assign(row, { bookId: r.id, seriesId: r.series_id, pages: r.pages });
      row.ui = { page: r.page, done: r.completed, at: new Date(r.at).getTime() };
    }
    // BookOrbit's side.
    for (const r of await boRows(link, boUid, since)) {
      const rel = r.path.slice(prefix.length + 1);
      const row = ensure(rel);
      row.bo = { fileId: r.file_id, page: r.page ?? 0, done: boDone(r.pct), at: new Date(r.at).getTime() };
      (row as any)._pct = r.pct;
    }

    // Fill in what each row lacks: the chapter on Uchiyomi's side, the file on BookOrbit's, the last look.
    const rels = [...rows.keys()];
    for (let i = 0; i < rels.length; i += 500) {
      const part = rels.slice(i, i + 500);
      const books = await q<{ file: string; id: string; series_id: string; pages: number }>(
        'SELECT file, id, series_id, pages FROM lib_books WHERE root = $1 AND file = ANY($2)', [DL_ROOT, part]);
      for (const b of books) Object.assign(rows.get(b.file)!, { bookId: b.id, seriesId: b.series_id, pages: b.pages });
      const snaps = await q<any>('SELECT b.file, s.* FROM bookorbit_sync_state s JOIN lib_books b ON b.id = s.book_id WHERE s.user_id = $1 AND b.file = ANY($2)', [userId, part]);
      for (const s of snaps) rows.get(s.file)!.snap = { uiPage: s.ui_page, uiDone: s.ui_done, boPage: s.bo_page, boDone: s.bo_done };
    }
    const needIds = [...rows.values()].filter((r) => r.bookId && !r.bo).map((r) => posix.join(prefix, r.rel));
    const ids = needIds.length ? await boFileIds(link, needIds) : new Map<string, number>();

    const pushes: Array<{ row: Row; page: number; done: boolean; fileId: number }> = [];
    const remember = (row: Row, uiS: Snap['uiPage'], uiD: boolean, boP: number, boD: boolean) =>
      q(`INSERT INTO bookorbit_sync_state (user_id, book_id, ui_page, ui_done, bo_page, bo_done) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (user_id, book_id) DO UPDATE SET ui_page=$3, ui_done=$4, bo_page=$5, bo_done=$6, synced_at=now()`,
        [userId, row.bookId, uiS, uiD, boP, boD]);

    for (const row of rows.values()) {
      if (!row.bookId) { res.skipped++; continue; }                               // BookOrbit holds it, Uchiyomi does not
      const fileId = row.bo?.fileId ?? ids.get(posix.join(prefix, row.rel));
      if (!fileId) { res.skipped++; continue; }                                    // Uchiyomi holds it, BookOrbit does not (yet)
      // The side that was not part of this pass's slice: read it now, so the comparison is between two real places.
      if (!row.bo) {
        const r = await boDb(link.db_url).query('SELECT percentage AS pct, page_number AS page, last_read_at AS at FROM reading_progress WHERE book_file_id = $1 AND user_id = $2', [fileId, boUid]);
        if (r.rows[0]) { row.bo = { fileId, page: r.rows[0].page ?? 0, done: boDone(r.rows[0].pct), at: new Date(r.rows[0].at).getTime() }; (row as any)._pct = r.rows[0].pct; }
      }
      if (!row.ui) {
        const r = await one<{ page: number; completed: boolean; at: Date; incognito: boolean }>('SELECT page, completed, updated_at AS at, incognito FROM read_progress WHERE user_id = $1 AND book_id = $2', [userId, row.bookId]);
        if (r && !r.incognito) row.ui = { page: r.page, done: r.completed, at: new Date(r.at).getTime() };
      }
      if (row.bo && !row.pages) row.pages = (await cbzPages(posix.join(DL_ROOT, row.rel)).catch(() => [] as string[])).length;
      // A BookOrbit place with no page number: derive it from the percentage.
      if (row.bo && !row.bo.page && row.pages) row.bo.page = Math.round(((row as any)._pct ?? 0) / 100 * row.pages);

      const d = decide(row.ui ?? null, row.bo ?? null, row.snap);
      if (d.action === 'pull') {
        const page = d.done && row.pages ? Math.max(d.page, row.pages) : d.page;
        const completed = d.done || reachedEnd(page, row.pages);
        await writeProgress({ userId, bookId: row.bookId, seriesId: row.seriesId, page, completed, at: row.bo!.at, deviceId: 'bookorbit' });
        await remember(row, page, completed, row.bo!.page, row.bo!.done);
        res.pulled++;
      } else if (d.action === 'push') {
        pushes.push({ row, page: d.page, done: d.done, fileId });
      } else if (row.ui && row.bo) {
        await remember(row, row.ui.page, row.ui.done, row.bo.page, row.bo.done);
      }
    }

    for (let i = 0; i < pushes.length; i += 50) {
      const part = pushes.slice(i, i + 50);
      const r = await boFetch(link, '/reading-progress', {
        method: 'PUT',
        body: JSON.stringify({
          writes: part.map((p) => {
            const pages = p.row.pages || 0;
            const page = p.done && pages ? pages : p.page;
            return {
              fileId: p.fileId, kind: 'text',
              percentage: p.done ? 100 : pages ? Math.min(99.9, Math.max(0, (page / pages) * 100)) : 0,
              editedAt: new Date(p.row.ui!.at).toISOString(), text: { page },
            };
          }),
        }),
      });
      if (!r.ok) throw new Error(`BookOrbit refused the progress write (${r.status})`);
      const out: any = await r.json().catch(() => ({}));
      const results: any[] = out.results ?? [];
      for (const [j, p] of part.entries()) {
        if (results[j]?.status === 'superseded') { res.superseded++; continue; }
        const pages = p.row.pages || 0;
        await remember(p.row, p.row.ui!.page, p.row.ui!.done, p.done && pages ? pages : p.page, p.done);
        res.pushed++;
      }
    }

    res.ms = Date.now() - t0;
    await q('UPDATE bookorbit_link SET last_run = $1, last_result = $2, ' + (full ? 'full_at = now(), ' : '') + 'last_error = NULL WHERE user_id = $3',
      [new Date(t0), JSON.stringify(res), link.user_id]);
    return res;
  } catch (e) {
    res.error = (e as Error).message;
    res.ms = Date.now() - t0;
    await q('UPDATE bookorbit_link SET last_error = $1, last_result = $2 WHERE user_id = $3', [res.error, JSON.stringify(res), link.user_id]).catch(() => {});
    return res;
  } finally {
    running = false;
  }
}

/** Tries the saved credentials and the database role; says what is wrong in words. */
export async function testLink(link: Link): Promise<{ ok: boolean; message: string }> {
  try {
    await boFetch(link, '/auth/me').then(async (r) => { if (!r.ok) throw new Error(`BookOrbit answered ${r.status} for the signed-in user`); });
  } catch (e) { return { ok: false, message: `BookOrbit: ${(e as Error).message}` }; }
  try {
    const uid = await boUserId(link);
    const n = (await boDb(link.db_url).query(`SELECT count(*)::int AS n FROM book_files WHERE absolute_path LIKE $1`, [`${link.path_prefix}/%`])).rows[0].n;
    if (!n) return { ok: false, message: `Connected, but BookOrbit holds no files under ${link.path_prefix}. Check the path prefix.` };
    return { ok: true, message: `Connected as BookOrbit user #${uid}; ${n} files under ${link.path_prefix}.` };
  } catch (e) { return { ok: false, message: `BookOrbit database: ${(e as Error).message}` }; }
}
