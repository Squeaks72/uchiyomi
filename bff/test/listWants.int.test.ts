// A list's "not in your library yet" titles (collection_wants) and a list import: a title is matched to a series the VIEWER can see,
// by the one rule wants are stored under (normTitle). The matching used to be SQL that folded to a-z0-9 -- so an accented or CJK title
// never matched -- and ran over every series, so a title in somebody's private library was matched, added to the list, and the want
// deleted (and the import's `added` count told the importer it existed).
// Skipped automatically unless TEST_DATABASE_URL is set.
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

test('list wants and import match what the viewer can see', { skip }, async (t) => {
  const { migrate } = await import('../src/lib/migrate');
  const { q, pool } = await import('../src/lib/db');
  const routes = (await import('../src/routes/personal')).default;
  const Fastify = (await import('fastify')).default;
  const jwt = (await import('@fastify/jwt')).default;
  await migrate();
  const IDS = ['s_lw_cafe', 's_lw_cjk', 's_lw_priv', 's_lw_plain'];
  await q('DELETE FROM lib_series WHERE id = ANY($1)', [IDS]);
  await q(`DELETE FROM users WHERE username LIKE 'lw-%'`);
  const mk = async (name: string) => (await q<{ id: string }>(
    `INSERT INTO users (username, display_name, password_hash, role, auth_kind) VALUES ($1,$1,'x','user','password') RETURNING id`, [name]))[0].id;
  const me = await mk('lw-me');
  const other = await mk('lw-other');
  for (const [id, title, priv] of [['s_lw_cafe', 'Café Réunion', false], ['s_lw_cjk', '呪術廻戦', false], ['s_lw_priv', 'Hidden Gem', true], ['s_lw_plain', 'Plain Title', false]] as const) {
    await q(`INSERT INTO lib_series (id, source, title, folder, books_count, is_private, owner_user_id) VALUES ($1,'T!lw',$2,$1,1,$3,$4)`,
      [id, title, priv, priv ? other : null]);
  }
  const app = Fastify();
  await app.register(jwt, { secret: process.env.JWT_SECRET! });
  await app.register(routes);
  await app.ready();
  const auth = { authorization: `Bearer ${app.jwt.sign({ sub: me, role: 'user' })}` };
  const listItems = async (id: string) => (await app.inject({ method: 'GET', url: `/api/collections/${id}`, headers: auth })).json();
  const imp = (name: string, titles: string[]) => app.inject({ method: 'POST', url: '/api/collections/import', headers: auth,
    payload: { list: { format: 'uchiyomi-list', version: 1, name, items: titles.map((title) => ({ title })) } } });

  try {
    await t.test('an import links accented and CJK titles, and saves what it cannot see as wants', async () => {
      const r = await imp('lw-list', ['Café Réunion', '呪術廻戦', 'Plain Title', 'Hidden Gem', 'Nobody Has This']);
      assert.equal(r.statusCode, 200, r.body);
      const out = r.json();
      assert.equal(out.added, 3, 'the three visible titles were linked');
      assert.equal(out.saved, 2, "the private title and the unknown one were saved for later");
      const l = await listItems(out.id);
      assert.deepEqual(l.items.map((s: any) => s.id).sort(), ['s_lw_cafe', 's_lw_cjk', 's_lw_plain']);
      assert.deepEqual(l.wants.map((w: any) => w.title).sort(), ['Hidden Gem', 'Nobody Has This']);
    });
    await t.test('a saved want for a private title is not turned into the private series', async () => {
      const r = await imp('lw-list2', ['Hidden Gem']);
      const l = await listItems(r.json().id);
      assert.equal(l.items.length, 0, 'the private series did not join the list');
      assert.equal(l.wants.length, 1, 'and the want is still there');
    });
    await t.test('a want becomes the series once the viewer can see it', async () => {
      const r = await imp('lw-list3', ['Not Yet Here']);
      const id = r.json().id;
      await q(`INSERT INTO lib_series (id, source, title, folder, books_count) VALUES ('s_lw_new','T!lw','Not Yet Here','s_lw_new',1)`);
      const l = await listItems(id);
      assert.equal(l.wants.length, 0, 'moved out of the wants');
      assert.ok((await listItems(id)).items.some((s: any) => s.id === 's_lw_new'));
    });
  } finally {
    await app.close();
    await q(`DELETE FROM collections WHERE user_id = ANY($1)`, [[me, other]]).catch(() => {});
    await q('DELETE FROM lib_series WHERE id = ANY($1)', [[...IDS, 's_lw_new']]).catch(() => {});
    await q(`DELETE FROM users WHERE username LIKE 'lw-%'`).catch(() => {});
    await pool.end().catch(() => {});
  }
});
