// A reader's request is answered only with a series that reader can see: one in somebody's private library must neither answer it
// nor tell the reader (by push, email, link or /api/requests/mine) that it exists. Skipped unless TEST_DATABASE_URL is set.
import test from 'node:test';
import assert from 'node:assert/strict';

const DSN = process.env.TEST_DATABASE_URL;
if (DSN) {
  process.env.DATABASE_URL = DSN;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';
  process.env.CONFIG_DIR = process.env.CONFIG_DIR || '/tmp/uchiyomi-test-config';
  process.env.LIBRARY_BACKEND = 'owned';
}
const skip = DSN ? false : 'set TEST_DATABASE_URL to run';

test('requests are answered only with series the reader can see', { skip }, async (t) => {
  const { migrate } = await import('../src/lib/migrate');
  const { q, pool } = await import('../src/lib/db');
  const routes = (await import('../src/routes/requests')).default;
  const Fastify = (await import('fastify')).default;
  const jwt = (await import('@fastify/jwt')).default;
  await migrate();
  await q(`DELETE FROM series_requests WHERE title IN ('Secret Series','Public Series')`);
  await q(`DELETE FROM lib_series WHERE id IN ('s_rq_priv','s_rq_pub')`);
  await q(`DELETE FROM users WHERE username LIKE 'rq-%'`);
  const mk = async (n: string) => (await q<{ id: string }>(
    `INSERT INTO users (username, display_name, password_hash, role, auth_kind) VALUES ($1,$1,'x','user','password') RETURNING id`, [n]))[0].id;
  const me = await mk('rq-me'); const other = await mk('rq-other');
  await q(`INSERT INTO lib_series (id, source, title, folder, books_count, is_private, owner_user_id) VALUES ('s_rq_priv','T!rq','Secret Series','s_rq_priv',1,true,$1)`, [other]);
  const app = Fastify();
  await app.register(jwt, { secret: process.env.JWT_SECRET! });
  await app.register(routes);
  await app.ready();
  const auth = { authorization: `Bearer ${app.jwt.sign({ sub: me, role: 'user' })}` };
  const ask = (title: string) => app.inject({ method: 'POST', url: '/api/requests', headers: auth, payload: { title } });
  const mine = async () => (await app.inject({ method: 'GET', url: '/api/requests/mine', headers: auth })).json();
  try {
    await t.test("a title that exists only in someone else's private library stays open and unrevealed", async () => {
      assert.equal((await ask('Secret Series')).statusCode, 200);
      const body = JSON.stringify(await mine());
      assert.ok(!body.includes('s_rq_priv'), 'the private series id is not in the answer');
      assert.match(body, /"status":"open"/);
    });
    await t.test('a title the reader can see answers the request', async () => {
      await q(`INSERT INTO lib_series (id, source, title, folder, books_count) VALUES ('s_rq_pub','T!rq','Public Series','s_rq_pub',1)`);
      await ask('Public Series');
      const r = (await mine()).requests ?? (await mine());
      assert.ok(JSON.stringify(r).includes('s_rq_pub'), JSON.stringify(r));
    });
  } finally {
    await app.close();
    await q(`DELETE FROM series_requests WHERE user_id = ANY($1)`, [[me, other]]).catch(() => {});
    await q(`DELETE FROM lib_series WHERE id IN ('s_rq_priv','s_rq_pub')`).catch(() => {});
    await q(`DELETE FROM users WHERE username LIKE 'rq-%'`).catch(() => {});
    await pool.end().catch(() => {});
  }
});
