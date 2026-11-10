// An extension's search filters: the engine's shapes become controls, and a change goes back as the engine's own input.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgres://unused:unused@127.0.0.1:1/unused';
process.env.JWT_SECRET ||= 'test-secret-at-least-16-chars';
process.env.SUWAYOMI_URL ||= 'http://suwayomi.test:4567';

const load = () => import('../src/lib/sources/suwayomi/filters');

test('controls keep their position among their siblings, headers and separators included', async () => {
  const { filtersOf } = await load();
  const out = filtersOf([
    { __typename: 'HeaderFilter', name: 'Note' },
    { __typename: 'SelectFilter', name: 'Sort', values: ['A', 'B'], selDefault: 1 },
    { __typename: 'SeparatorFilter', name: '' },
    { __typename: 'GroupFilter', name: 'Genres', filters: [
      { __typename: 'TriStateFilter', name: 'Action', triDefault: 'IGNORE' },
      { __typename: 'TriStateFilter', name: 'Romance', triDefault: 'INCLUDE' },
    ] },
    { __typename: 'GroupFilter', name: 'Empty', filters: [] },
    { __typename: 'TextFilter', name: 'Author', textDefault: '' },
    { __typename: 'SortFilter', name: 'Sort by', sortValues: ['x'], sortDefault: { index: 0, ascending: true } },
    { __typename: 'CheckBoxFilter', name: 'Has chapters', cbDefault: true },
  ]);
  assert.deepEqual(out.map((f) => [f.kind, f.pos, f.name]), [['select', 1, 'Sort'], ['group', 3, 'Genres'], ['text', 5, 'Author'], ['sort', 6, 'Sort by'], ['checkbox', 7, 'Has chapters']]);
  const g = out[1] as Extract<(typeof out)[number], { kind: 'group' }>;
  assert.deepEqual(g.filters.map((f) => [f.pos, (f as any).value]), [[0, 'IGNORE'], [1, 'INCLUDE']]);
});

test('a change goes back as the engine takes it; a group child is nested, and nonsense is dropped', async () => {
  const { toFilterChange } = await load();
  assert.deepEqual(toFilterChange({ path: [3, 1], tri: 'EXCLUDE' }), { position: 3, groupChange: { position: 1, triState: 'EXCLUDE' } });
  assert.deepEqual(toFilterChange({ path: [2], select: 4 }), { position: 2, selectState: 4 });
  assert.deepEqual(toFilterChange({ path: [0], checkbox: false }), { position: 0, checkBoxState: false });
  assert.deepEqual(toFilterChange({ path: [1], sort: { index: 2, ascending: false } }), { position: 1, sortState: { index: 2, ascending: false } });
  assert.deepEqual(toFilterChange({ path: [5], text: 'abc' }), { position: 5, textState: 'abc' });
  assert.equal(toFilterChange({ path: [], tri: 'INCLUDE' }), null);
  assert.equal(toFilterChange({ path: [1, 2, 3], tri: 'INCLUDE' }), null);
  assert.equal(toFilterChange({ path: [-1], checkbox: true }), null);
  assert.equal(toFilterChange({ path: [1], tri: 'MAYBE' as any }), null);
  assert.equal(toFilterChange({ path: [1] }), null);
});
