// The sync's rules, pure: which side to copy, and what must never happen (a finished chapter marked unread).
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://unused@localhost:1/unused';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-at-least-16-chars';

const side = (page: number, done = false, at = 1000) => ({ page, done, at });
const snap = (uiPage: number, uiDone: boolean, boPage: number, boDone: boolean) => ({ uiPage, uiDone, boPage, boDone });
const load = () => import('../src/lib/bookorbitSync');

test('only the side that moved is copied, and a copy does not echo back', async () => {
  const { decide } = await load();
  const s = snap(5, false, 5, false);
  assert.deepEqual(decide(side(9), side(5), s), { action: 'push', page: 9, done: false });
  assert.deepEqual(decide(side(5), side(12), s), { action: 'pull', page: 12, done: false });
  assert.deepEqual(decide(side(5), side(5), s), { action: 'none' });
  // after a push the snapshot holds the new page on both sides
  assert.deepEqual(decide(side(9), side(9), snap(9, false, 9, false)), { action: 'none' });
});

test('both moved: the newer wins; finished beats unfinished whatever the clocks say', async () => {
  const { decide } = await load();
  const s = snap(5, false, 5, false);
  assert.deepEqual(decide(side(8, false, 2000), side(11, false, 3000), s), { action: 'pull', page: 11, done: false });
  assert.deepEqual(decide(side(8, false, 4000), side(11, false, 3000), s), { action: 'push', page: 8, done: false });
  assert.deepEqual(decide(side(20, true, 1000), side(11, false, 9000), s), { action: 'push', page: 20, done: true });
  assert.deepEqual(decide(side(8, false, 9000), side(30, true, 1000), s), { action: 'pull', page: 30, done: true });
});

test('the sync never marks anything unread or empty', async () => {
  const { decide } = await load();
  // Uchiyomi marked unread; BookOrbit still has it finished: nothing is lowered
  assert.deepEqual(decide(side(0, false, 5000), side(30, true, 1000), snap(30, true, 30, true)), { action: 'none' });
  // an empty place is not worth copying
  assert.deepEqual(decide(side(0, false), null, null), { action: 'none' });
  assert.deepEqual(decide(null, side(0, false), null), { action: 'none' });
  // BookOrbit rewound a finished chapter: Uchiyomi keeps it finished
  assert.deepEqual(decide(side(30, true), side(3, false, 9000), snap(30, true, 30, true)), { action: 'none' });
});

test('the first look: a place on one side is copied to the other; equal places are just remembered', async () => {
  const { decide } = await load();
  assert.deepEqual(decide(side(7), null, null), { action: 'push', page: 7, done: false });
  assert.deepEqual(decide(null, side(7), null), { action: 'pull', page: 7, done: false });
  assert.deepEqual(decide(side(7), side(7), null), { action: 'none' });
});

test('BookOrbit counts a chapter finished at 100%', async () => {
  const { boDone } = await load();
  assert.equal(boDone(100), true);
  assert.equal(boDone(99.99), true);
  assert.equal(boDone(96.4), false);
  assert.equal(boDone(null), false);
});
