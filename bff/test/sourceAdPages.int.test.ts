// A source's own inserted page -- the same advert at the edge of chapters of several different series of ONE source -- is skipped even
// where it appears once per series (lib/junkPages.ts sourceAdHashes). And only there: not mid-chapter, not for another source's chapter,
// not on evidence from fewer series.
//
// Skipped automatically unless TEST_DATABASE_URL is set (CI provides a throwaway Postgres service).
import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const DSN = process.env.TEST_DATABASE_URL;
if (DSN) {
  process.env.DATABASE_URL = DSN;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';
  process.env.CONFIG_DIR = process.env.CONFIG_DIR || '/tmp/uchiyomi-test-config';
}
const skip = DSN ? false : 'set TEST_DATABASE_URL to run';

const AD = 'a5a5c3c30f0f9696';
let q: typeof import('../src/lib/db').q;
let junkPagesFor: typeof import('../src/lib/junkPages').junkPagesFor;

before(async () => {
  if (!DSN) return;
  ({ q } = await import('../src/lib/db'));
  await (await import('../src/lib/migrate')).migrate();
  ({ junkPagesFor } = await import('../src/lib/junkPages'));
});

/** One chapter of its own series: story pages with hashes of their own, and the advert at `adAt` when given. */
async function chapter(n: number, source: string, adAt: number | null) {
  const s = `s_srcad${n}`;
  const b = `b_srcad${n}`;
  await q(`INSERT INTO lib_series (id, source, title, folder) VALUES ($1, 'owned', $2, $3)`, [s, `Ad Test ${n}`, `/srcad${n}`]);
  await q(`INSERT INTO lib_books (id, series_id, source, file, number, pages, source_id) VALUES ($1, $2, 'owned', $3, 1, 12, $4)`, [b, s, `/srcad${n}/ch1.cbz`, source]);
  for (let p = 1; p <= 12; p++) {
    const hash = p === adAt ? AD : (n * 100 + p).toString(16).padStart(4, '0') + '3c3c5a5a0f0f';
    await q('INSERT INTO page_hashes (book_id, page, hash) VALUES ($1, $2, $3)', [b, p, hash]);
  }
}

beforeEach(async () => {
  if (!DSN) return;
  await q(`DELETE FROM page_hashes WHERE book_id LIKE 'b_srcad%'`);
  await q(`DELETE FROM lib_books WHERE id LIKE 'b_srcad%'`);
  await q(`DELETE FROM lib_series WHERE id LIKE 's_srcad%'`);
});

test('the same page closing a chapter of three different series of one source is skipped in each', { skip }, async () => {
  for (const n of [1, 2, 3]) await chapter(n, 'sw:ad-src-a', 12);
  for (const n of [1, 2, 3]) assert.deepEqual([...(await junkPagesFor(`b_srcad${n}`))], [12]);
});

test('not mid-chapter, not for another source, not from two series', { skip }, async () => {
  await chapter(4, 'sw:ad-src-b', 12);
  await chapter(5, 'sw:ad-src-b', 12);
  await chapter(6, 'sw:ad-src-b', 6);   // mid-chapter: does not count toward, and is not skipped
  await chapter(7, 'sw:ad-src-c', 12);  // another source
  for (const n of [4, 5, 6, 7]) assert.deepEqual([...(await junkPagesFor(`b_srcad${n}`))], [], `chapter ${n}`);
});
