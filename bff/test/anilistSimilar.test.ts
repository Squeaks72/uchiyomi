// Find similar (fork): the pure matching in lib/anilistSimilar.ts scorePool -- how many of the chosen genres and tags an
// AniList entry shares with the series, and in what order the ones that share enough come.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';
let scorePool: typeof import('../src/lib/anilistSimilar').scorePool;
before(async () => { ({ scorePool } = await import('../src/lib/anilistSimilar')); });

const item = (id: number, genres: string[], tags: Array<[string, number]>, score: number | null = null) => ({
  id, title: `T${id}`, titles: [`T${id}`], synonyms: [], cover: null, format: 'MANGA', status: null, adult: false, genres,
  country: 'JP', score, tags: tags.map(([name, rank]) => ({ name, rank, spoiler: false })),
});
const target = {
  genres: ['Action', 'Comedy', 'Supernatural'],
  tags: [{ name: 'Youkai', rank: 93, spoiler: false }, { name: 'Aliens', rank: 91, spoiler: false }, { name: 'Ghost', rank: 91, spoiler: false }],
};

test('only entries sharing at least min of the chosen chips are kept, most shared first', () => {
  const pool = [
    item(1, ['Action'], [['Youkai', 90]]),
    item(2, ['Action', 'Comedy'], [['Youkai', 80], ['Aliens', 70], ['Ghost', 60]]),
    item(3, ['Comedy'], [['Aliens', 90]]),
  ];
  const sel = { genres: ['Action', 'Comedy'], tags: ['Youkai', 'Aliens', 'Ghost'] };
  const out = scorePool(target, sel, pool, 3, 0);
  assert.deepEqual(out.map((s) => s.item.id), [2]);
  assert.equal(out[0].hits, 5);
  const two = scorePool(target, sel, pool, 2, 0);
  assert.equal(two[0].item.id, 2);
  assert.deepEqual(two.map((s) => s.item.id).sort(), [1, 2, 3]);
});

test('min is clamped to 1..chosen and the series itself is never an answer', () => {
  const pool = [item(7, [], [['Ghost', 70]]), item(8, [], [['Ghost', 70]])];
  const sel = { genres: [], tags: ['Ghost'] };
  assert.deepEqual(scorePool(target, sel, pool, 99, 7).map((s) => s.item.id), [8]);
  assert.deepEqual(scorePool(target, sel, pool, 0, 7).map((s) => s.item.id), [8]);
  assert.deepEqual(scorePool(target, { genres: [], tags: [] }, pool, 1, 0), []);
});

test('matching is case-blind, a pool entry is counted once, and a weak tag counts for less', () => {
  const pool = [item(1, ['ACTION'], [['youkai', 55]]), item(1, ['ACTION'], [['youkai', 55]]), item(2, ['ACTION'], [['Youkai', 95]])];
  const out = scorePool(target, { genres: ['Action'], tags: ['Youkai'] }, pool, 2, 0);
  assert.deepEqual(out.map((s) => s.item.id), [2, 1]);
  assert.ok(out[0].score > out[1].score);
});

test('ties on score fall to the community score, then the id', () => {
  const pool = [item(5, [], [['Aliens', 80]], 70), item(4, [], [['Aliens', 80]], 90), item(3, [], [['Aliens', 80]], 90)];
  const out = scorePool(target, { genres: [], tags: ['Aliens'] }, pool, 1, 0);
  assert.deepEqual(out.map((s) => s.item.id), [3, 4, 5]);
});

test('the library’s own genres are offered after AniList’s, once each, any case', async () => {
  const { withOwn } = await import('../src/lib/anilistSimilar');
  assert.deepEqual(withOwn(['Action', 'Comedy'], ['action', 'Shounen', ' shounen ', 'Slice of Life', '']), ['Action', 'Comedy', 'Shounen', 'Slice of Life']);
});

test('a genre chip is also met by a tag of that name', () => {
  const out = scorePool(target, { genres: ['Shounen'], tags: [] }, [item(1, [], [['Shounen', 80]]), item(2, [], [['Ghost', 80]])], 1, 0);
  assert.deepEqual(out.map((s) => s.item.id), [1]);
});
