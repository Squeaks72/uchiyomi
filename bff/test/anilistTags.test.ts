// Discover by tags: the tag list is read once and kept, a search sends exactly the filters asked for, and a title with
// no cover or a missing field is handled. A fake AniList stands in for the real one.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';
process.env.ANILIST_API_URL = 'http://anilist.example/graphql';

const reply = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });

test('the tag list is fetched once and kept', async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return reply({ MediaTagCollection: [{ name: 'Time Loop', category: 'Theme', isAdult: false }, { name: 'Gore', category: 'Content', isAdult: true }], GenreCollection: ['Action', 'Romance'] }); }) as typeof fetch;
  try {
    const al = await import('../src/lib/anilist');
    const a = await al.fetchTagCollection();
    const b = await al.fetchTagCollection();
    assert.equal(calls, 1);
    assert.deepEqual(a.genres, ['Action', 'Romance']);
    assert.deepEqual(b.tags.map((t) => [t.name, t.adult]), [['Time Loop', false], ['Gore', true]]);
  } finally { globalThis.fetch = real; }
});

test('a search sends every filter asked for, and nothing it was not asked for', async () => {
  const real = globalThis.fetch;
  let sent: any = null;
  globalThis.fetch = (async (_u: any, init: any) => {
    sent = JSON.parse(init.body);
    return reply({ Page: { pageInfo: { hasNextPage: true }, media: [
      { id: 1, isAdult: false, title: { english: 'Loop Girl', romaji: 'Rupu' }, coverImage: { large: 'c.jpg' }, description: 'A<br>b', genres: ['Action'], averageScore: 80, chapters: 10, status: 'RELEASING' },
      { id: 2, isAdult: true, title: { romaji: 'No Cover' }, coverImage: {}, genres: [] },
    ] } });
  }) as typeof fetch;
  try {
    const al = await import('../src/lib/anilist');
    const r = await al.searchByTags({ tags: ['Time Loop'], genres: ['Action'], notTags: [], country: 'KR', sort: 'SCORE_DESC', page: 2, safeOnly: true });
    assert.deepEqual(sent.variables, { page: 2, sort: ['SCORE_DESC'], tags: ['Time Loop'], genres: ['Action'], country: 'KR', adult: false });
    assert.equal(r.hasNext, true);
    assert.deepEqual(r.items.map((i) => [i.id, i.title, i.adult, i.score]), [[1, 'Loop Girl', false, 80]]);
    await al.searchByTags({ tags: [], genres: ['Action'], notTags: ['Gore'], country: null, sort: 'POPULARITY_DESC', page: 1, safeOnly: false });
    assert.deepEqual(sent.variables, { page: 1, sort: ['POPULARITY_DESC'], genres: ['Action'], notTags: ['Gore'] });
  } finally { globalThis.fetch = real; }
});
