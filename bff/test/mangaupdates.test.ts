// The MangaUpdates adapter against a stubbed api.mangaupdates.com: the password login, the list read and the
// progress write. No database; a real account is a person's, so nothing here can run against the service.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused@localhost:1/unused';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';
const mod = () => import('../src/lib/trackerProviders');

type Call = { method: string; path: string; body: any; auth: string | null };
const calls: Call[] = [];
const realFetch = globalThis.fetch;
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
const answer = (route: (c: Call) => Response) => {
  calls.length = 0;
  globalThis.fetch = (async (u: any, init: any) => {
    const url = new URL(String(u));
    const c: Call = {
      method: String(init?.method ?? 'GET'), path: url.pathname.replace(/^\/v1/, ''),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      auth: init?.headers?.authorization ?? null,
    };
    calls.push(c);
    return route(c);
  }) as typeof fetch;
};
test.afterEach(() => { globalThis.fetch = realFetch; });

const LISTS = [
  { list_id: 0, type: 'read' }, { list_id: 1, type: 'wish' }, { list_id: 2, type: 'complete' },
  { list_id: 3, type: 'unfinished' }, { list_id: 4, type: 'hold' }, { list_id: 9, title: 'Favourites', custom: true },
];

test('login: the credentials go to the login call once and the session token comes back', async () => {
  const { mangaupdatesLogin } = await mod();
  answer(() => json({ status: 'success', reason: 'ok', context: { session_token: 'sess_abcdefghij', uid: 5 } }));
  assert.deepEqual(await mangaupdatesLogin('me', 'hunter2'), { token: 'sess_abcdefghij' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PUT');
  assert.equal(calls[0].path, '/account/login');
  assert.deepEqual(calls[0].body, { username: 'me', password: 'hunter2' });
});

test('login: a refusal is a rejection that carries the service\'s own reason', async () => {
  const { mangaupdatesLogin } = await mod();
  answer(() => json({ status: 'exception', reason: 'No user found or the password was incorrect. Try again.' }, 401));
  await assert.rejects(() => mangaupdatesLogin('me', 'bad'), (e: any) => e.rejected === true && /password was incorrect/.test(e.message));
  answer(() => json({ status: 'success', context: {} }));
  await assert.rejects(() => mangaupdatesLogin('me', 'x'), /did not give a token/);
});

test('whoAmI names the account; a 401 is the token\'s verdict', async () => {
  const { mangaupdatesAdapter: a } = await mod();
  answer(() => json({ user_id: 77, username: 'reader' }));
  assert.deepEqual(await a.whoAmI('tok'), { id: '77', name: 'reader' });
  assert.equal(calls[0].auth, 'Bearer tok');
  answer(() => json({ status: 'exception', reason: 'This action requires a user account' }, 401));
  await assert.rejects(() => a.whoAmI('tok'), (e: any) => e.authFailed === true);
});

test('listLibrary reads one list per bucket, pages by its own number, and skips repeats', async () => {
  const { mangaupdatesAdapter: a } = await mod();
  const row = (id: number, title: string, chapter: number, type = 'Manga', rating?: number) => ({
    record: { series: { id, title }, status: { chapter } }, metadata: { series: { series_id: id, title, type }, ...(rating ? { user_rating: rating } : {}) },
  });
  answer((c) => {
    if (c.path === '/lists') return json(LISTS);
    if (c.path === '/lists/0/search') {
      return c.body.page === 1
        ? json({ total_hits: 101, results: Array.from({ length: 100 }, (_, i) => row(1000 + i, `Title ${i}`, i)) })
        : json({ total_hits: 101, results: [row(2000, 'Berserk', 12, 'Manga', 9.5)] });
    }
    if (c.path === '/lists/1/search') return json({ total_hits: 2, results: [row(1000, 'Title 0', 0), row(3000, 'Some Novel', 0, 'Novel')] });
    return json({ total_hits: 0, results: [] });
  });
  const out = await a.listLibrary('tok', { statuses: ['reading', 'plan_to_read'], max: 500 });
  assert.equal(out.length, 102, 'a series on two lists is read once');
  assert.deepEqual(out.find((e) => e.externalId === '2000'), { externalId: '2000', title: 'Berserk', altTitles: [], status: 'reading', progress: 12, format: 'manga', score: 9.5 });
  assert.equal(out.find((e) => e.externalId === '3000')?.format, 'novel');
  assert.equal(out.find((e) => e.externalId === '3000')?.status, 'plan_to_read');
  assert.deepEqual(calls.filter((c) => c.path.endsWith('/search')).map((c) => `${c.path}#${c.body.page}`), ['/lists/0/search#1', '/lists/0/search#2', '/lists/1/search#1']);
});

test('listLibrary asks for nothing when nothing is wanted, and stops at the cap', async () => {
  const { mangaupdatesAdapter: a } = await mod();
  answer(() => json({}, 500));
  assert.deepEqual(await a.listLibrary('tok', { statuses: [], max: 10 }), []);
  assert.equal(calls.length, 0);
  answer((c) => c.path === '/lists' ? json(LISTS) : json({ total_hits: 500, results: Array.from({ length: 100 }, (_, i) => ({ record: { series: { id: i + 1, title: `T${i}` }, status: { chapter: 1 } }, metadata: {} })) }));
  assert.equal((await a.listLibrary('tok', { statuses: ['reading'], max: 5 })).length, 5);
});

test('setProgress adds a series that is not on any list, to the reading list', async () => {
  const { mangaupdatesAdapter: a } = await mod();
  answer((c) => c.path === '/lists' ? json(LISTS) : c.path === '/lists/series/55' ? json({ status: 'exception' }, 404) : json({ status: 'success' }));
  await a.setProgress('tok', '55', 12, false);
  const w = calls.at(-1)!;
  assert.equal(w.path, '/lists/series');
  assert.deepEqual(w.body, [{ series: { id: 55 }, list_id: 0, status: { chapter: 12 } }]);
});

test('setProgress updates an entry in place, and finishing moves it to the complete list', async () => {
  const { mangaupdatesAdapter: a } = await mod();
  answer((c) => c.path === '/lists' ? json(LISTS) : c.path === '/lists/series/55' ? json({ list_id: 4, status: { chapter: 3 } }) : json({ status: 'success' }));
  await a.setProgress('tok', '55', 12, false);
  assert.deepEqual(calls.at(-1)!.body, [{ series: { id: 55 }, list_id: 0, status: { chapter: 12 } }], 'a series being read leaves hold');
  assert.equal(calls.at(-1)!.path, '/lists/series/update');
  await a.setProgress('tok', '55', 40, true);
  assert.deepEqual(calls.at(-1)!.body, [{ series: { id: 55 }, list_id: 2, status: { chapter: 40 } }]);
});

test('setProgress leaves an entry on a custom list where the person put it', async () => {
  const { mangaupdatesAdapter: a } = await mod();
  answer((c) => c.path === '/lists' ? json(LISTS) : c.path === '/lists/series/55' ? json({ list_id: 9, status: { chapter: 3 } }) : json({ status: 'success' }));
  await a.setProgress('tok', '55', 12, false);
  assert.equal(calls.at(-1)!.body[0].list_id, 9);
});

test('setProgress: a 401 is an auth failure, a 400 is a plain error that keeps the connection', async () => {
  const { mangaupdatesAdapter: a } = await mod();
  answer(() => json({ status: 'exception' }, 401));
  await assert.rejects(() => a.setProgress('tok', '55', 1, false), (e: any) => e.authFailed === true);
  answer((c) => c.path === '/lists' ? json(LISTS) : c.path.startsWith('/lists/series/') && c.method === 'GET' ? json({ status: 'x' }, 404) : json({ status: 'exception' }, 400));
  await assert.rejects(() => a.setProgress('tok', '55', 1, false), (e: any) => !e.authFailed && /mangaupdates 400/.test(e.message));
});
