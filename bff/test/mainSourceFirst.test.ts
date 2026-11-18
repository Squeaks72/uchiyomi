// The main source goes first for a new chapter (lib/sourcePrefs.ts rankSources, 2026-11-18): it is the endorsed source, so a preferred
// source ahead of it would download a chapter that the endorse pass then downloads again from the main source.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rankSources, type SourcePriority } from '../src/lib/sourcePrefs';

const order = (ids: string[]): SourcePriority => ({ order: ids, rank: (id) => (id && ids.includes(id) ? ids.indexOf(id) : ids.length) });
const sorted = (rank: (id?: string) => number, ids: string[]) => [...ids].sort((a, b) => rank(a) - rank(b));

test('the main source ranks first, ahead of a preferred order', () => {
  assert.deepEqual(sorted(rankSources(order(['other']), ['main', 'other', 'third'], 'main'), ['third', 'other', 'main']), ['main', 'other', 'third']);
});

test('without a main to put first (it did not answer), the order and the follow order stand as before', () => {
  assert.deepEqual(sorted(rankSources(order(['other']), ['main', 'other', 'third'], null), ['third', 'other', 'main']), ['other', 'main', 'third']);
  assert.deepEqual(sorted(rankSources(null, ['main', 'other'], null), ['other', 'main']), ['main', 'other']);
});
