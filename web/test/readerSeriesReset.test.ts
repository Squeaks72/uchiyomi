// "Reset this series to my defaults" (reader sheet): clears the title's own look and tells the account.
//
// The per-series memory is pushed as `readerSeries`, and the server replaces that key whole, so a reset has to
// leave the id out of the next push (or leave it with only what it still holds) for the account to forget it.
// These tests drive the real module against a stubbed server, like readerSourcePrefs.test.ts.
import test, { before, mock } from 'node:test';
import assert from 'node:assert/strict';

process.env.NEXT_PUBLIC_API_BASE = '';

const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  get length() { return mem.size; },
  key: (i: number) => [...mem.keys()][i] ?? null,
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
};
(globalThis as any).window = globalThis;

const putBodies: any[] = [];
globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
  if ((init?.method ?? 'GET') === 'PUT') {
    putBodies.push(JSON.parse(String(init?.body ?? '{}')));
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
}) as any;

let prefs: typeof import('../lib/readerPrefs');
before(async () => {
  prefs = await import('../lib/readerPrefs');
  await import('../lib/api');
});

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
async function flush() {
  const before = putBodies.length;
  mock.timers.tick(1500);
  for (let i = 0; i < 200 && putBodies.length === before; i++) await settle();
  await settle();
}

test('a reset clears the series look, keeps the zoom, and the account hears of it', async (t) => {
  // Reintroduce by making resetSeriesLook skip the removal: the series still reports a look, and the push
  // still carries it.
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => { mock.timers.reset(); mem.clear(); putBodies.length = 0; });
  mem.clear(); putBodies.length = 0;

  prefs.savePrefs({ ...prefs.DEFAULT_PREFS, mode: 'vertical', theme: 'amoled', brightness: 0.7 });
  prefs.saveSeriesPrefs('s1', { mode: 'paged', theme: 'sepia', spread: true, pagedDirection: 'rtl', directionChosen: true, zoom: 2 });
  prefs.saveSeriesPrefs('s2', { mode: 'paged' });
  await flush();
  assert.equal(prefs.hasSeriesLook('s1'), true);

  const cur = { ...prefs.DEFAULT_PREFS, brightness: 0.7, mode: 'paged' as const, theme: 'sepia' as const, spread: true, pagedDirection: 'rtl' as const };
  const next = prefs.resetSeriesLook('s1', cur);

  assert.equal(prefs.hasSeriesLook('s1'), false, 'the series still holds a look of its own');
  assert.deepEqual(prefs.loadSeriesPrefs('s1'), { zoom: 2 }, 'the zoom was cleared with the look');
  assert.deepEqual([next.mode, next.theme, next.spread, next.pagedDirection], ['vertical', 'amoled', false, 'series'],
    'the live settings did not return to the profile defaults');
  assert.equal(next.brightness, 0.7, 'a global setting was reset along with the look');

  await flush();
  assert.deepEqual(putBodies.at(-1).readerSeries, { s1: { zoom: 2 }, s2: { mode: 'paged' } }, 'the account was not told');
});

test('a series with nothing left is removed, and its source default shows through', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => { mock.timers.reset(); mem.clear(); putBodies.length = 0; });
  mem.clear(); putBodies.length = 0;

  prefs.saveSourcePrefs('manga-src', { mode: 'paged', pagedDirection: 'rtl' });
  prefs.saveSeriesPrefs('s1', { mode: 'vertical', theme: 'gray' });
  await flush();

  const next = prefs.resetSeriesLook('s1', { ...prefs.DEFAULT_PREFS, mode: 'vertical', theme: 'gray' }, 'manga-src');
  assert.equal(mem.has('yomi_rs_s1'), false, 'an empty series entry was kept');
  assert.equal(next.mode, 'paged', "the source's default did not show through after the reset");
  assert.equal(next.pagedDirection, 'rtl');
  assert.equal(next.theme, 'amoled', 'the series theme survived the reset');

  await flush();
  assert.deepEqual(putBodies.at(-1).readerSeries, {}, 'the removed series was pushed again');
});
