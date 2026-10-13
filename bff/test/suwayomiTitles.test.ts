// A title the engine hands over with HTML entities is saved as its text: "Nana &amp; Kaoru" read "Nana &amp; Kaoru" on the
// library and in Health, because ComicInfo escapes the & once more on the way back (&amp;amp;).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';
process.env.DATABASE_URL ||= 'postgres://unused/unused';
process.env.CONFIG_DIR ||= '/tmp/uchiyomi-test-config';

test('a search result\'s title has its entities decoded', async () => {
  // Reintroduce `title: m.title.trim()` in suwayomi/sources.ts toSeries: the title reads Nana &amp; Kaoru.
  const { makeSuwayomiAdapter } = await import('../src/lib/sources/suwayomi/sources');
  const run = (async () => ({ fetchSourceManga: { mangas: [{ id: 1, title: 'Nana &amp; Kaoru ' }, { id: 2, title: 'Plain' }] } })) as any;
  const adapter = makeSuwayomiAdapter({ id: 'x', name: 'X', displayName: 'X', lang: 'en', isNsfw: false } as any, run);
  const found = await adapter.search('nana');
  assert.deepEqual(found.map((s) => s.title), ['Nana & Kaoru', 'Plain']);
});
