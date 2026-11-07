// Fork: volumes and arcs (lib/volumes) through the real database -- the routes, the first read of a list recorded without
// a word, a volume announced once when its last chapter lands (web push to the account waiting on it, and a target that
// asked for volume_complete), and that account no longer told about single chapters. Skipped unless TEST_DATABASE_URL.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DSN = process.env.TEST_DATABASE_URL;
const TMP = mkdtempSync(join(tmpdir(), 'uy-volumes-'));
if (DSN) {
  process.env.DATABASE_URL = DSN;
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';
  process.env.CONFIG_DIR = join(TMP, 'config');
  process.env.LIBRARY_BACKEND = 'owned';
}
const skip = DSN ? false : 'set TEST_DATABASE_URL to run';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const webpush = require('web-push');
const realSend = webpush.sendNotification;
let sent: Array<{ endpoint: string; body: string }> = [];
const KEYS = { p256dh: 'BOtgYHT5o5gH3bVJx0bY8Ul0O3YQe1lEw7xT7X5Ch6S8vT2H1x0l1Ywq4bU0pQ3j8y0ZbVQwvV2K9Jq4Y8p6Q0E', auth: 'c2VjcmV0LWF1dGgtMTIzNA' };

const LIB = 'lib_vol', SID = 's_vol_a';
let q: any, app: any;
const U: Record<'reader' | 'admin', { id: string; h: { authorization: string } }> = {} as any;
let hook: { server: Server; hits: string[]; base: string };

const addBook = (n: number) => q(`INSERT INTO lib_books (id, series_id, source, file, number, title, root) VALUES ($1, $2, 'T!vol', $3, $4, $5, '/library')`,
  [`b_vol_${n}`, SID, `T!vol/a/ch${n}.cbz`, n, `Chapter ${n}`]);

before(async () => {
  if (!DSN) return;
  ({ q } = (await import('../src/lib/db')) as any);
  await (await import('../src/lib/migrate')).migrate();
  webpush.sendNotification = async (sub: { endpoint: string }, body: string) => { sent.push({ endpoint: sub.endpoint, body }); };
  await q(`DELETE FROM users WHERE username LIKE 'vol-%'`);
  await q(`DELETE FROM lib_series WHERE id = $1`, [SID]);
  await q(`DELETE FROM series_volumes WHERE series_id = $1`, [SID]);
  await q(`DELETE FROM volume_announced WHERE series_id = $1`, [SID]);
  await q(`INSERT INTO libraries (id, name, path) VALUES ($1, 'VOL', '/vol') ON CONFLICT (id) DO NOTHING`, [LIB]);
  await q(`INSERT INTO lib_series (id, source, title, folder, books_count, library_id) VALUES ($1, 'T!vol', 'Volume Title', 'T!vol/a', 5, $2)`, [SID, LIB]);
  for (const n of [1, 2, 3, 4, 5]) await addBook(n);
  for (const [k, role] of [['reader', 'user'], ['admin', 'admin']] as const) {
    const id = (await q(`INSERT INTO users (username, display_name, password_hash, role, auth_kind) VALUES ($1, $1, 'x', $2, 'password') RETURNING id`, [`vol-${k}`, role]))[0].id;
    U[k] = { id, h: { authorization: '' } };
  }
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  await app.register((await import('@fastify/jwt')).default, { secret: process.env.JWT_SECRET! });
  await app.register((await import('../src/routes/catalog')).default);
  await app.ready();
  for (const k of ['reader', 'admin'] as const) U[k].h.authorization = `Bearer ${app.jwt.sign({ sub: U[k].id, role: k === 'admin' ? 'admin' : 'user' })}`;
  await q(`INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth) VALUES ($1, 'https://93.184.216.34/wpush/vol', $2, $3)`, [U.reader.id, KEYS.p256dh, KEYS.auth]);
  await q(`INSERT INTO favorites (user_id, series_id) VALUES ($1, $2)`, [U.reader.id, SID]);
  hook = { hits: [] } as any;
  hook.server = createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { hook.hits.push(b); res.writeHead(200); res.end('{}'); }); });
  await new Promise<void>((r) => hook.server.listen(0, '127.0.0.1', r));
  hook.base = `http://127.0.0.1:${(hook.server.address() as { port: number }).port}`;
  const { sealSecret } = await import('../src/lib/notify');
  await q(`INSERT INTO notify_targets (kind, name, config, secret, events) VALUES ('webhook', 'vol-hook', '{"display":"x"}', $1, '{volume_complete}')`,
    [sealSecret({ url: hook.base })]);
});

after(async () => {
  webpush.sendNotification = realSend;
  await new Promise<void>((r) => { hook?.server.closeAllConnections?.(); hook?.server.close(() => r()); });
  if (DSN) {
    await app?.close();
    await q(`DELETE FROM notify_targets WHERE name LIKE 'vol-%'`).catch(() => {});
    await q(`DELETE FROM users WHERE username LIKE 'vol-%'`).catch(() => {});
    await q(`DELETE FROM lib_series WHERE id = $1`, [SID]).catch(() => {});
    await q(`DELETE FROM series_volumes WHERE series_id = $1`, [SID]).catch(() => {});
    await q(`DELETE FROM volume_announced WHERE series_id = $1`, [SID]).catch(() => {});
    await q(`DELETE FROM libraries WHERE id = $1`, [LIB]).catch(() => {});
  }
  rmSync(TMP, { recursive: true, force: true });
});

const settle = () => new Promise((r) => setTimeout(r, 300));

test("only an admin writes the volumes; a bad line is refused by number; the reader never sees the admin's text", { skip }, async () => {
  const put = (who: 'reader' | 'admin', text: string | null) => app.inject({ method: 'PUT', url: `/api/series/${SID}/volumes/manual`, headers: U[who].h, payload: { text } });
  assert.equal((await put('reader', 'Volume 1: 1-3')).statusCode, 403);
  const bad = await put('admin', 'Volume 1: 1-3\nwhat');
  assert.equal(bad.statusCode, 400);
  assert.deepEqual(bad.json().lines, [2]);
  // Volume 1 is complete already: the first read of the list records it without a word.
  sent = []; hook.hits = [];
  const ok = await put('admin', 'Volume 1: 1-3\nVolume 2: 4-6\nArc Opening: 1-5');
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(ok.json().volumes.map((u: any) => u.label), ['1', '2']);
  assert.deepEqual(ok.json().arcs.map((u: any) => u.label), ['Opening']);
  const seen = await q(`SELECT unit FROM volume_announced WHERE series_id = $1 ORDER BY unit`, [SID]);
  assert.deepEqual(seen.map((r: any) => r.unit), ['arc:Opening', 'volume:1']);
  await settle();
  assert.equal(sent.length + hook.hits.length, 0, 'units already complete were announced');
  const asReader = (await app.inject({ method: 'GET', url: `/api/series/${SID}/volumes`, headers: U.reader.h })).json();
  assert.equal(asReader.manual, null);
  assert.equal(asReader.source, 'manual');
});

test('waiting for volumes: no chapter news, and one announcement when the last chapter of a volume lands', { skip }, async () => {
  const wait = await app.inject({ method: 'PUT', url: `/api/series/${SID}/volumes/wait`, headers: U.reader.h, payload: { on: true } });
  assert.equal(wait.statusCode, 200);
  const { wantsNews } = await import('../src/lib/nextUp');
  assert.equal(await wantsNews(U.reader.id, SID, [6]), false, 'an account waiting for volumes was told about a chapter');
  const push = await import('../src/lib/push');
  sent = [];
  await push.notifyNewChapter(SID, 'Volume Title', 1, [6]);
  assert.equal(sent.length, 0);

  const { checkCompletions } = await import('../src/lib/volumes');
  sent = []; hook.hits = [];
  assert.deepEqual(await checkCompletions([SID]), [], 'nothing new is complete yet');
  await addBook(6);
  const done = await checkCompletions([SID]);
  assert.deepEqual(done.map((d) => d.units.map((u) => u.label)), [['2']]);
  await settle();
  assert.equal(sent.length, 1);
  assert.match(sent[0].body, /Volume 2 \(chapters 4–6\) is complete/);
  assert.equal(hook.hits.length, 1);
  assert.equal(JSON.parse(hook.hits[0]).event, 'volume_complete');
  // Once only.
  sent = []; hook.hits = [];
  assert.deepEqual(await checkCompletions([SID]), []);
  await settle();
  assert.equal(sent.length + hook.hits.length, 0);
});

test('nobody waiting: the volume is recorded, and the targets hear nothing', { skip }, async () => {
  await app.inject({ method: 'PUT', url: `/api/series/${SID}/volumes/wait`, headers: U.reader.h, payload: { on: false } });
  await app.inject({ method: 'PUT', url: `/api/series/${SID}/volumes/manual`, headers: U.admin.h, payload: { text: 'Volume 1: 1-3\nVolume 2: 4-6\nVolume 3: 7' } });
  const { checkCompletions } = await import('../src/lib/volumes');
  hook.hits = []; sent = [];
  await addBook(7);
  assert.equal((await checkCompletions([SID]))[0]?.units[0].label, '3');
  await settle();
  assert.equal(hook.hits.length + sent.length, 0, 'a volume nobody waits on was announced');
});
