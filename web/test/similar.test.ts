// Find similar (fork): the panel's small pure parts in lib/similar.ts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultTags, effectiveMin, matchNote, searchUrl } from '../lib/similar';

test('the default tags are the strongest few', () => {
  const tags = Array.from({ length: 10 }, (_, i) => ({ name: `T${i}`, rank: 90 - i }));
  assert.deepEqual(defaultTags({ lookups: true, genres: [], tags }), ['T0', 'T1', 'T2', 'T3', 'T4', 'T5']);
  assert.deepEqual(defaultTags(undefined), []);
});

test('the number to match defaults to most of what is chosen and stays inside 1..chosen', () => {
  assert.equal(effectiveMin(6, null), 4);
  assert.equal(effectiveMin(1, null), 1);
  assert.equal(effectiveMin(0, null), 1);
  assert.equal(effectiveMin(5, 9), 5);
  assert.equal(effectiveMin(5, 0), 1);
  assert.equal(effectiveMin(5, 2), 2);
});

test('the same choice is one address, whatever order it was picked in', () => {
  assert.equal(searchUrl('a b', ['Comedy', 'Action'], ['Ghost', 'Aliens'], 3),
    searchUrl('a b', ['Action', 'Comedy'], ['Aliens', 'Ghost'], 3));
  assert.equal(searchUrl('x', [], ['Youkai'], 1), '/api/series/x/similar/search?tags=Youkai&min=1');
});

test('a card says how many chips it shares, then which', () => {
  assert.equal(matchNote({ anilistId: 1, matched: ['Youkai', 'Ghost'], hits: 2, score: 1 }, 4), '2/4 · Youkai, Ghost');
});
