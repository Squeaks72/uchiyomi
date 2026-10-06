import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { cullPlan, foreignSources, type CullBook } from '../lib/cullPlan';
import type { VersionCopy } from '../lib/types';

const copy = (source: string): VersionCopy => ({ key: `${source}:c1`, source } as VersionCopy);
const b = (id: string, number: number, sourceId: string, extra: Partial<CullBook> = {}): CullBook => ({ id, number, sourceId, owned: true, ...extra });

test('foreignSources counts every source but the main one, biggest first', () => {
  const books = [b('1', 1, 'main'), b('2', 2, 'x'), b('3', 3, 'x'), b('4', 4, 'y')];
  assert.deepEqual(foreignSources(books, 'main'), [{ id: 'x', count: 2 }, { id: 'y', count: 1 }]);
});

test('a number only a foreign source holds is removed by number; one the main source also lists is swapped, not hidden', () => {
  const books = [b('1', 11, 'x'), b('2', 12, 'x'), b('3', 13, 'main')];
  const p = cullPlan({ books, primary: 'main', sources: new Set(['x']), swap: true, mainCopy: (n) => (n === 12 ? copy('main') : undefined) });
  assert.deepEqual(p.remove, [11]);
  assert.deepEqual(p.swaps.map((s) => s.bookId), ['2']);
  assert.deepEqual(p.deleteIds, []);
});

test('with the swap off every foreign-only number is removed', () => {
  const p = cullPlan({ books: [b('1', 12, 'x')], primary: 'main', sources: new Set(['x']), swap: false, mainCopy: () => copy('main') });
  assert.deepEqual(p.remove, [12]);
  assert.equal(p.swaps.length, 0);
});

test('a number a kept copy shares is never put on the removal list: only the foreign file goes', () => {
  const books = [b('1', 5, 'x'), b('2', 5, 'main')];
  const p = cullPlan({ books, primary: 'main', sources: new Set(['x']), swap: true, mainCopy: () => copy('main') });
  assert.deepEqual(p.remove, []);
  assert.deepEqual(p.swaps, []);
  assert.deepEqual(p.deleteIds, ['1']);
});

test('only the sources left ticked are culled, and files the server did not download are counted, not touched', () => {
  const books = [b('1', 1, 'x'), b('2', 2, 'y'), b('3', 3, 'x', { owned: false })];
  const p = cullPlan({ books, primary: 'main', sources: new Set(['x']), swap: false, mainCopy: () => undefined });
  assert.deepEqual(p.remove, [1]);
  assert.equal(p.notOurs, 1);
});

test('the series page offers shift-click ranges, select by source, remove from series, and the cull dialog', () => {
  const page = readFileSync(new URL('../app/series/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /onToggle\?\.\(e\.shiftKey\)/, 'rows pass shiftKey');
  assert.match(page, /const pickRow = \(key: string, shift: boolean\)/);
  assert.match(page, /data-select-source=/);
  assert.match(page, /data-remove-from-series/);
  assert.match(page, /chapters\/remove`/);
  assert.match(page, /<CullSourcesDialog /);
  assert.match(page, /data-cull-sources-open/);
});
