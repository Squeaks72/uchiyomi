// The admin's per-source age rating: what it makes of a source's permission and of its extension's adult flag.
process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';
import test, { before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let R: typeof import('../src/lib/sourceRatings');
let V: typeof import('../src/lib/visibility');
let S: typeof import('../src/lib/searchAll');
before(async () => {
  R = await import('../src/lib/sourceRatings');
  V = await import('../src/lib/visibility');
  S = await import('../src/lib/searchAll');
});
beforeEach(() => R.applySourceRatings({}));

test('cleanSourceRatings keeps whole ages 0-18 on real ids and lowercases them', () => {
  assert.deepEqual(R.cleanSourceRatings({ 'SW:1': 13, a: 0, b: 18, c: 19, d: -1, e: 1.5, f: '13', 'bad id': 5 }), { 'sw:1': 13, a: 0, b: 18 });
  for (const v of [null, undefined, [], 'x', 4]) assert.deepEqual(R.cleanSourceRatings(v), {});
});

test('without a rating the extension flag decides, as before', () => {
  assert.equal(V.sourceAllowedFor({ id: 'sw:1', isNsfw: true }, 16), false);
  assert.equal(V.sourceAllowedFor({ id: 'sw:1', isNsfw: true }, null), true);
  assert.equal(V.sourceAllowedFor({ id: 'sw:1' }, 6), true);
  assert.equal(V.sourceAllowedFor({ isNsfw: true }, 17), false, 'an adapter without an id still works');
});

test('a rating below 18 lets a capped account in once its cap reaches it', () => {
  R.applySourceRatings({ 'sw:1': 13 });
  assert.equal(V.sourceAllowedFor({ id: 'SW:1' }, 10), false);
  assert.equal(V.sourceAllowedFor({ id: 'sw:1' }, 13), true);
  assert.equal(V.sourceAllowedFor({ id: 'sw:1', isNsfw: true }, 13), true, 'it replaces the extension flag');
});

test('all ages clears an adult flag; 18 makes an unflagged source adult', () => {
  R.applySourceRatings({ 'sw:1': 0, 'sw:2': 18 });
  assert.equal(V.sourceAllowedFor({ id: 'sw:1', isNsfw: true }, 6), true);
  assert.equal(R.isAdultSource({ id: 'sw:1', isNsfw: true }), false);
  assert.equal(V.sourceAllowedFor({ id: 'sw:2' }, 17), false);
  assert.equal(R.isAdultSource({ id: 'sw:2' }), true);
});

test('ratedAdultIds and clearedIds split the overrides at 18', () => {
  R.applySourceRatings({ a: 18, b: 17, c: 0 });
  assert.deepEqual(R.ratedAdultIds(), ['a']);
  assert.deepEqual(R.clearedIds().sort(), ['b', 'c']);
});

test('a cleared source is not condemned by its extension flag when ratings are judged', () => {
  const item = { genres: [], contentRating: undefined } as never;
  const lists = { genres: [], sources: [], cleared: ['sw:1'] };
  assert.equal(S.ratingOf(item, { id: 'sw:1', isNsfw: true }, lists), undefined);
  assert.equal(S.ratingOf(item, { id: 'sw:2', isNsfw: true }, lists), 'flagged');
  assert.equal(S.ratingOf(item, { id: 'sw:1', isNsfw: true }, { ...lists, sources: ['sw:1'] }), 'adult', 'rated 18 is adult whatever else');
});

test('foldAdultSources moves the retired adult_sources list into ratings as 18, without overriding an entry', () => {
  assert.deepEqual(R.foldAdultSources(['SW:1', ' sw:2 ', 'sw:3'], { 'sw:2': 13, 'sw:9': 0 }), { 'sw:1': 18, 'sw:2': 13, 'sw:3': 18, 'sw:9': 0 });
  assert.deepEqual(R.foldAdultSources(['sw:1'], { 'sw:1': 0 }), { 'sw:1': 0 }, 'an explicit all-ages rating wins over the old list');
  assert.deepEqual(R.foldAdultSources([], { a: 17 }), { a: 17 });
  assert.deepEqual(R.foldAdultSources(null, null), {});
  assert.deepEqual(R.foldAdultSources(['ok', 4, null, 'bad id'], {}), { ok: 18 }, 'junk entries are dropped');
});

test('foldAdultSources is idempotent: folding its own output with an emptied list changes nothing', () => {
  const once = R.foldAdultSources(['a', 'b'], { c: 13 });
  assert.deepEqual(R.foldAdultSources([], once), once);
  assert.deepEqual(R.foldAdultSources(['a', 'b'], once), once);
});
