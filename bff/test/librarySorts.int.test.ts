// The Library's rating / recently-read / chapter-count sorts. The rating and the last read are PER USER, so the
// property worth testing is that one member's stars never order another member's shelf.
// Skipped automatically unless TEST_DATABASE_URL is set (CI provides a throwaway Postgres service).
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

const DSN = process.env.TEST_DATABASE_URL;
if (DSN) {
  process.env.DATABASE_URL = DSN;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';
  process.env.CONFIG_DIR = process.env.CONFIG_DIR || '/tmp/uchiyomi-test-config';
  process.env.LIBRARY_BACKEND = 'owned';
}
const skip = DSN ? false : 'set TEST_DATABASE_URL to run';

const S = ['s_ls_alpha', 's_ls_bravo', 's_ls_charlie', 's_ls_delta'] as const;
const CHAPTERS: Record<string, number> = { s_ls_alpha: 3, s_ls_bravo: 12, s_ls_charlie: 7, s_ls_delta: 1 };
let q: any, pool: any, owned: any, viewCtxFor: any;
let alice = '', bob = '';

const clean = async () => {
  await q(`DELETE FROM ratings WHERE series_id = ANY($1)`, [S]);
  await q(`DELETE FROM read_progress WHERE series_id = ANY($1)`, [S]);
  await q(`DELETE FROM lib_books WHERE series_id = ANY($1)`, [S]);
  await q(`DELETE FROM lib_series WHERE id = ANY($1)`, [S]);
  await q(`DELETE FROM users WHERE username LIKE 'ls-%'`);
};

before(async () => {
  if (!DSN) return;
  ({ q, pool } = await import('../src/lib/db'));
  await (await import('../src/lib/migrate')).migrate();
  ({ owned } = await import('../src/lib/ownedCatalog'));
  ({ viewCtxFor } = await import('../src/lib/visibility'));
  await clean();
  for (const id of S) {
    await q(`INSERT INTO lib_series (id, source, title, folder, books_count) VALUES ($1,'T!ls',$2,$1,$3)`, [id, id.slice(5), CHAPTERS[id]]);
    for (let n = 1; n <= CHAPTERS[id]; n++) {
      await q(`INSERT INTO lib_books (id, series_id, source, file, number, title) VALUES ($1,$2,'T!ls',$3,$4,$5)`,
        [`b_${id}_${n}`, id, `T!ls/${id}/${n}.cbz`, n, `Chapter ${n}`]);
    }
  }
  const mk = async (name: string) => (await q(
    `INSERT INTO users (username, display_name, password_hash, role, auth_kind) VALUES ($1,$1,'x','user','password') RETURNING id`, [name]))[0].id;
  alice = await mk('ls-alice'); bob = await mk('ls-bob');
  // Alice: charlie 5 stars, alpha 2 stars; Bob: bravo 4 stars. Alice read delta, then (later) bravo.
  await q(`INSERT INTO ratings (user_id, series_id, stars) VALUES ($1,'s_ls_charlie',5),($1,'s_ls_alpha',2),($2,'s_ls_bravo',4)`, [alice, bob]);
  await q(`INSERT INTO read_progress (user_id, book_id, series_id, page, completed, updated_at) VALUES ($1,'b_s_ls_delta_1','s_ls_delta',1,true, now() - interval '2 days')`, [alice]);
  await q(`INSERT INTO read_progress (user_id, book_id, series_id, page, completed, updated_at) VALUES ($1,'b_s_ls_bravo_1','s_ls_bravo',1,true, now() - interval '1 day')`, [alice]);
});
after(async () => {
  if (!DSN) return;
  await clean();
  await pool.end();
});

const order = async (userId: string | null, sort: string, collapse = false) => {
  const ctx = userId ? await viewCtxFor(userId, 'user') : await viewCtxFor(null);
  const res = await owned.searchSeries(ctx, { fullTextSearch: 'ls_', ...(collapse ? { collapseEditions: true } : {}) }, 0, 40, sort);
  return res.content.map((s: any) => s.id.slice(5));
};

for (const collapse of [false, true]) {
  const how = collapse ? 'one card per work' : 'plain';
  test(`rating: Alice's stars order Alice's shelf, unrated last (${how})`, { skip }, async () => {
    assert.deepEqual(await order(alice, 'rating,desc', collapse), ['charlie', 'alpha', 'bravo', 'delta']);
  });
  test(`rating: Bob's shelf is ordered by Bob's stars, not Alice's (${how})`, { skip }, async () => {
    // Reintroduce by joining ratings without the user_id predicate: charlie (Alice's 5) leads Bob's shelf.
    assert.deepEqual(await order(bob, 'rating,desc', collapse), ['bravo', 'alpha', 'charlie', 'delta']);
  });
  test(`recently read: latest first, never-read last (${how})`, { skip }, async () => {
    assert.deepEqual(await order(alice, 'lastRead,desc', collapse), ['bravo', 'delta', 'alpha', 'charlie']);
  });
}

test('most chapters', { skip }, async () => {
  assert.deepEqual(await order(alice, 'chapters,desc'), ['bravo', 'charlie', 'alpha', 'delta']);
});

test('without a user the per-user sorts list in title order instead of failing', { skip }, async () => {
  assert.deepEqual(await order(null, 'rating,desc'), ['delta', 'charlie', 'bravo', 'alpha']);
});
