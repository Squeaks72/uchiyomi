// Fork: the series page's Volumes view (lib/volumes.ts) -- which chapters a volume holds, and what it says about them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupByUnits, spanText } from '../lib/volumes';

const vol = (label: string, chapters: number[]) => ({ kind: 'volume' as const, label, chapters, released: null });
const book = (number: number, read = false, numberEnd: number | null = null) => ({ id: `b${number}`, number, numberEnd, readProgress: read ? { completed: true } : null });

test('chapters land in their volume; a half chapter sits with its whole one; the rest is "not in a volume yet"', () => {
  const g = groupByUnits([vol('1', [1, 2, 3]), vol('2', [4, 5, 6])], [book(1, true), book(2, true), book(3), book(3.5), book(4), book(7), book(8)]);
  assert.deepEqual(g.map((x) => [x.unit?.label ?? x.group, x.books.map((b) => b.number)]), [['1', [1, 2, 3, 3.5]], ['2', [4]], ['tail', [7, 8]]]);
  assert.equal(g[0].complete, true);
  assert.equal(g[0].read, 2);
  assert.equal(g[0].next?.number, 3);
  assert.equal(g[1].complete, false);
  assert.equal(g[1].have, 1);
});

test('a file holding a range of chapters completes the volume it covers', () => {
  const [v] = groupByUnits([vol('1', [1, 2, 3, 4, 5, 6, 7])], [book(1, false, 7)]);
  assert.equal(v.complete, true);
  assert.equal(v.have, 7);
});

test('a volume of extras alone is never complete; the span names the whole chapters', () => {
  const [v] = groupByUnits([vol('0', [0.5])], [book(0.5)]);
  assert.equal(v.complete, false);
  assert.equal(spanText([128, 129, 130]), '128–130');
  assert.equal(spanText([7]), '7');
});
