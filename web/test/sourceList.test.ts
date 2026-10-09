import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { arrangeSources, filterSources, sortSources, SOURCE_TOOLS_MIN } from '../lib/sourceList';

const rows = [
  { id: 'c', name: 'Zeta Scans' },
  { id: 'a', name: 'alpha manga' },
  { id: 'b', name: 'Émile Reads' },
  { id: 'd', name: 'Site 10' },
  { id: 'e', name: 'Site 2' },
];
const ids = (l: { id: string }[]) => l.map((x) => x.id).join('');
const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

test('default keeps the caller order, and does not copy-sort it', () => {
  assert.equal(ids(sortSources(rows, 'default')), 'cabde');
});
test('A-Z ignores case and accents and sorts numbers as numbers; Z-A reverses', () => {

  assert.deepEqual(sortSources(rows, 'az').map((x) => x.name), ['alpha manga', 'Émile Reads', 'Site 2', 'Site 10', 'Zeta Scans']);
  assert.deepEqual(sortSources(rows, 'za').map((x) => x.name), ['Zeta Scans', 'Site 10', 'Site 2', 'Émile Reads', 'alpha manga']);
});
test('sorting never mutates the input', () => {
  const copy = [...rows];
  sortSources(rows, 'az');
  assert.deepEqual(rows, copy);
});
test('filter matches every word, ignoring case and accents', () => {
  assert.equal(ids(filterSources(rows, 'emile')), 'b');
  assert.equal(ids(filterSources(rows, 'SITE')), 'de');
  assert.equal(ids(filterSources(rows, 'site 1')), 'd');
  assert.equal(ids(filterSources(rows, 'nothing')), '');
});
test('a blank filter keeps the whole list in order', () => {
  assert.equal(ids(filterSources(rows, '   ')), 'cabde');
});
test('arrange filters then sorts', () => {
  assert.equal(ids(arrangeSources(rows, 'site', 'za')), 'de');
  assert.equal(ids(arrangeSources(rows, 'site', 'az')), 'ed');
});

test('Discover sheet says the order is priority, and offers the filter and sort', () => {
  const s = src('components/SourceListSheet.tsx');
  assert.match(s, /Listed by priority: the best sources come first/);
  assert.match(s, /<SourceTools /);
  assert.match(s, /arrangeSources\(sources, query, sort\)/);
  assert.match(s, /SOURCE_TOOLS_MIN/);
});
test('every source picker uses the shared tools', () => {
  for (const f of ['components/SourceListSheet.tsx', 'components/MigrateSourceSheet.tsx', 'components/AdminSettings.tsx']) {
    assert.match(src(f), /<SourceTools /, f);
    assert.match(src(f), /arrangeSources\(/, f);
  }
  assert.ok(SOURCE_TOOLS_MIN > 1);
});
test('the search box does not steal focus when a sheet opens', () => {
  assert.match(src('components/SourceTools.tsx'), /data-no-autofocus/);
  assert.match(src('components/ui.tsx'), /input:not\(\[data-no-autofocus\]\)/);
});

test('admins get a link from the source sheet to the Source order setting', () => {
  const s = src('components/SourceListSheet.tsx');
  assert.match(s, /isAdmin &&/);
  assert.match(s, /\/admin\/\?tab=Settings&section=source-order/);
});
