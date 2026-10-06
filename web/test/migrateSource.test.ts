import { test } from 'node:test';
import assert from 'node:assert/strict';
import { migrateTerms, attachButtons } from '../lib/migrateSource';

test('terms: the title first, other names once each, spacing and case ignored', () => {
  assert.deepEqual(migrateTerms('  One  Piece ', ['one piece', 'ワンピース', '', 'ONE PIECE']), ['One Piece', 'ワンピース']);
});

test('terms: capped', () => {
  assert.equal(migrateTerms('a', ['b', 'c', 'd', 'e', 'f', 'g', 'h']).length, 6);
});

test('a series with a main source can follow or move; one without can only take it as main', () => {
  assert.deepEqual(attachButtons('sw:1'), { follower: true, main: true });
  assert.deepEqual(attachButtons(null), { follower: false, main: true });
});
