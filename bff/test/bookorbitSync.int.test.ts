// The sync end to end against a real Uchiyomi database, a stand-in BookOrbit database and a stand-in BookOrbit API.
// Skipped unless TEST_DATABASE_URL is set; the stand-in database is `bo_test` on the same server.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Pool } from 'pg';

const DSN = process.env.TEST_DATABASE_URL;
const DL = '/tmp/uchiyomi-bo-sync-dl';
if (DSN) {
  process.env.DATABASE_URL = DSN;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';
  process.env.CONFIG_DIR = process.env.CONFIG_DIR || '/tmp/uchiyomi-test-config';
  process.env.DL_ROOT = DL;
  process.env.LIBRARY_ROOT = '/tmp/uchiyomi-bo-sync-lib';
}
const skip = DSN ? false : 'set TEST_DATABASE_URL to run';
const BO_DSN = DSN?.replace(/\/[^/]+$/, '/bo_test');

let q: <T = any>(sql: string, p?: any[]) => Promise<T[]>;
let S: typeof import('../src/lib/bookorbitSync');
let bo: Pool;
let api: http.Server;
let url = '';
let writes: any[] = [];
let supersede = false;
const U = '00000000-0000-4000-8000-0000000000b0';

before(async () => {
  if (!DSN) return;
  const { migrate } = await import('../src/lib/migrate');
  ({ q } = (await import('../src/lib/db')) as any);
  S = await import('../src/lib/bookorbitSync');
  await migrate();
  bo = new Pool({ connectionString: BO_DSN });
  await bo.query(`DROP TABLE IF EXISTS reading_progress, book_files, users`);
  await bo.query(`CREATE TABLE users (id int PRIMARY KEY, username text);
    CREATE TABLE book_files (id int PRIMARY KEY, absolute_path text UNIQUE, role text DEFAULT 'content');
    CREATE TABLE reading_progress (book_file_id int, user_id int, percentage real, page_number int, last_read_at timestamptz, PRIMARY KEY (book_file_id, user_id))`);
  await bo.query(`INSERT INTO users VALUES (1, 'tim')`);
  api = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/v1/auth/login') return res.end(JSON.stringify({ accessToken: 't' }));
      if (req.url === '/api/v1/auth/me') return res.end('{}');
      if (req.url === '/api/v1/reading-progress' && req.method === 'PUT') {
        const w = JSON.parse(body).writes;
        writes.push(...w);
        return res.end(JSON.stringify({ results: w.map((x: any) => ({ fileId: x.fileId, status: supersede ? 'superseded' : 'saved' })) }));
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${(api.address() as any).port}`;
});
after(async () => {
  if (!DSN) return;
  await q('DELETE FROM users WHERE id = $1', [U]).catch(() => {});
  await q(`DELETE FROM lib_series WHERE id = 's_bo1'`).catch(() => {});
  await bo?.end().catch(() => {});
  api?.close();
});
beforeEach(async () => {
  if (!DSN) return;
  writes = []; supersede = false;
  await q('DELETE FROM users WHERE id = $1', [U]);
  await q(`INSERT INTO users (id, username, password_hash, role) VALUES ($1,'bosync','x','admin')`, [U]).catch(async () => {
    await q(`INSERT INTO users (id, username, password_hash) VALUES ($1,'bosync','x')`, [U]);
  });
  await q(`INSERT INTO lib_series (id, source, title, folder, books_count) VALUES ('s_bo1','manga','Berserk','manga/Berserk',2) ON CONFLICT (id) DO NOTHING`);
  for (const [id, n] of [['b_bo1', 1], ['b_bo2', 2]] as const) {
    await q(`INSERT INTO lib_books (id, series_id, source, file, number, title, root, pages) VALUES ($1,'s_bo1','manga',$2,$3,$4,$5,20) ON CONFLICT (id) DO UPDATE SET pages = 20`,
      [id, `manga/Berserk/Chapter ${n}.cbz`, n, `Chapter ${n}`, DL]);
  }
  await bo.query('DELETE FROM reading_progress; DELETE FROM book_files');
  await bo.query(`INSERT INTO book_files VALUES (101, '/books/m/manga/Berserk/Chapter 1.cbz'), (102, '/books/m/manga/Berserk/Chapter 2.cbz')`);
  await S.saveLink(U, { enabled: true, url, username: 'tim', password: 'pw', dbUrl: BO_DSN!, pathPrefix: '/books/m' });
});

test('reading in Uchiyomi reaches BookOrbit; reading in BookOrbit reaches Uchiyomi; a repeat pass changes nothing', { skip }, async () => {
  const { writeProgress } = await import('../src/lib/progress');
  await writeProgress({ userId: U, bookId: 'b_bo1', seriesId: 's_bo1', page: 5, completed: false });
  let r = await S.runSync({ full: true });
  assert.equal(r?.error, undefined);
  assert.equal(r?.pushed, 1);
  assert.deepEqual(writes.map((w) => [w.fileId, w.percentage, w.text.page]), [[101, 25, 5]]);

  // the same thing again: nothing moves
  writes = [];
  r = await S.runSync({ full: true });
  assert.deepEqual([r?.pushed, r?.pulled], [0, 0]);

  // BookOrbit: chapter 2 finished, chapter 1 on page 9 (newer than anything in Uchiyomi)
  await bo.query(`INSERT INTO reading_progress VALUES (102, 1, 100, 20, now()), (101, 1, 45, 9, now() + interval '1 minute')`);
  r = await S.runSync({ full: true });
  assert.equal(r?.pulled, 2);
  const rows = await q('SELECT book_id, page, completed FROM read_progress WHERE user_id = $1 ORDER BY book_id', [U]);
  assert.deepEqual(rows.map((x: any) => [x.book_id, x.page, x.completed]), [['b_bo1', 9, false], ['b_bo2', 20, true]]);
  assert.deepEqual(writes, []);

  // and it settles
  r = await S.runSync({ full: true });
  assert.deepEqual([r?.pushed, r?.pulled], [0, 0]);
});

test('a chapter BookOrbit does not hold is skipped, and an unfinished chapter never lowers a finished one', { skip }, async () => {
  const { writeProgress } = await import('../src/lib/progress');
  await q(`INSERT INTO lib_books (id, series_id, source, file, number, title, root, pages) VALUES ('b_bo3','s_bo1','manga','manga/Berserk/Chapter 3.cbz',3,'Chapter 3',$1,20) ON CONFLICT (id) DO NOTHING`, [DL]);
  await writeProgress({ userId: U, bookId: 'b_bo3', seriesId: 's_bo1', page: 4, completed: false });
  await bo.query(`INSERT INTO reading_progress VALUES (101, 1, 100, 20, now())`);
  await writeProgress({ userId: U, bookId: 'b_bo1', seriesId: 's_bo1', page: 2, completed: false });
  const r = await S.runSync({ full: true });
  assert.ok((r?.skipped ?? 0) >= 1);
  const p = await q('SELECT page, completed FROM read_progress WHERE user_id = $1 AND book_id = $2', [U, 'b_bo1']);
  assert.equal(p[0].completed, true, 'a finished BookOrbit chapter was lowered');
  assert.equal(writes.length, 0);
});

test('a write BookOrbit says is superseded is not counted as pushed', { skip }, async () => {
  const { writeProgress } = await import('../src/lib/progress');
  supersede = true;
  await writeProgress({ userId: U, bookId: 'b_bo2', seriesId: 's_bo1', page: 3, completed: false });
  const r = await S.runSync({ full: true });
  assert.deepEqual([r?.pushed, r?.superseded], [0, 1]);
});

test('wrong BookOrbit credentials are reported, not thrown', { skip }, async () => {
  await S.saveLink(U, { dbUrl: 'postgres://nobody:x@127.0.0.1:1/none' });
  const r = await S.runSync({ full: true });
  assert.ok(r?.error, 'no error recorded');
});
