// A reader's own un-joining of a spread the detector got wrong (lib/spreadMarks.ts): applied to the flow, and offered per page.
import test from 'node:test';
import assert from 'node:assert/strict';
import { applySplits, spreadChoice } from '../lib/spreadMarks';
import { pairSlides } from '../lib/readerSpread';

interface P { ci: number; number: number; width: number; height: number; join?: 'rtl' | 'ltr'; firstOfChapter: boolean }
const page = (number: number, extra: Partial<P> = {}): P => ({ ci: 0, number, width: 800, height: 1200, firstOfChapter: number === 1, ...extra });
const flat = [page(1), page(2, { join: 'rtl' }), page(3), page(4, { join: 'rtl' }), page(5)];

test('nothing un-joined leaves the flow as it is, the very array', () => {
  assert.equal(applySplits(flat, [undefined]), flat);
  assert.equal(applySplits(flat, [[]]), flat);
});

test('an un-joined pair loses the detector\'s join; the others keep theirs; the input is not changed', () => {
  const out = applySplits(flat, [[2]]);
  assert.deepEqual(out.map((p) => p.join), [undefined, undefined, undefined, 'rtl', undefined]);
  assert.equal(flat[1].join, 'rtl');
});

test('an un-join belongs to its chapter', () => {
  const two = [page(1), page(2, { join: 'rtl' }), page(1, { ci: 1 }), page(2, { ci: 1, join: 'rtl' })];
  assert.deepEqual(applySplits(two, [undefined, [2]]).map((p) => p.join), [undefined, 'rtl', undefined, undefined]);
});

test('the reader then shows the two pages as two slides', () => {
  assert.deepEqual(pairSlides(flat, false, { joinSplit: true }).slides, [[0], [1, 2], [3, 4]]);
  assert.deepEqual(pairSlides(applySplits(flat, [[2]]), false, { joinSplit: true }).slides, [[0], [1], [2], [3, 4]]);
});

test('the sheet offers an un-join on either half of a joined pair, and a give-back once it is un-joined', () => {
  assert.deepEqual(spreadChoice(flat, 1, undefined), { first: 2, split: false });
  assert.deepEqual(spreadChoice(flat, 2, undefined), { first: 2, split: false });
  assert.deepEqual(spreadChoice(flat, 1, [2]), { first: 2, split: true });
  assert.equal(spreadChoice(flat, 0, undefined), null, 'a page in no spread has nothing to say');
  assert.deepEqual(spreadChoice(flat, 4, undefined), { first: 4, split: false }, 'the second half of the later pair');
});

test('pages in two chapters are not a pair', () => {
  const across = [page(5, { join: 'rtl' }), page(1, { ci: 1 })];
  assert.equal(spreadChoice(across, 0, undefined), null);
});
