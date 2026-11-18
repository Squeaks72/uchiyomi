import test from 'node:test';
import assert from 'node:assert/strict';
import { chapterNumberMatcher } from '../lib/chapterNumberFilter';

const keep = (typed: string, ns: number[]) => { const m = chapterNumberMatcher(typed); return m ? ns.filter(m) : ns; };
const ns = [1, 2, 2.5, 12, 20, 21, 29, 200, 213, 213.5, 214, 1213];

test('a whole number narrows as it is typed, parts included', () => {
  assert.deepEqual(keep('2', ns), [2, 2.5, 20, 21, 29, 200, 213, 213.5, 214]);
  assert.deepEqual(keep('21', ns), [21, 213, 213.5, 214]);
  assert.deepEqual(keep('213', ns), [213, 213.5]);
  assert.deepEqual(keep('ch 213', ns), [213, 213.5]);
  assert.deepEqual(keep('#213', ns), [213, 213.5]);
});

test('a decimal is exact; nothing a number cannot be filters nothing', () => {
  assert.deepEqual(keep('213.5', ns), [213.5]);
  assert.deepEqual(keep('213.', ns), [213, 213.5]);
  for (const t of ['', '  ', 'abc', '2a', '-1']) assert.equal(chapterNumberMatcher(t), null, t);
});
