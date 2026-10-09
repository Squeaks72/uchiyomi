import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('Ignore is offered only for a title the library does not hold', () => {
  const menu = read('components/DiscoverMenu.tsx');
  assert.match(menu, /!libraryHref && !librarySeriesId \? \[\{\s*label: tr\('Ignore'\)/);
});

test('an ignored title leaves every card that is not a library series', () => {
  const hidden = read('lib/hiddenTitles.ts');
  assert.match(hidden, /\(!seriesId && ignored\.has\(titleKey\(title\)\)\)/);
});

test('the series page has a notes section and calls its bookmarks link Series Bookmarks', () => {
  const page = read('app/series/page.tsx');
  assert.match(page, /<SeriesNotes seriesId=\{id\} \/>/);
  assert.doesNotMatch(page, /tr\('Add a note'\)/);
  assert.match(read('components/SeriesNotes.tsx'), /api\('\/api\/notes'|\/api\/notes\/\$\{encodeURIComponent\(d\.id\)\}/);
});

test('library: Shift+click selects the range from the last click, and sources sit below genres', () => {
  const page = read('app/library/page.tsx');
  assert.match(page, /onToggle=\{\(e\) => togglePick\(s\.id, e\.shiftKey\)\}/);
  assert.match(page, /ids\.slice\(lo, hi \+ 1\)/);
  const f = read('components/LibraryFilters.tsx');
  assert.ok(f.indexOf("tr('Genres')") < f.indexOf("tr('Main source')"), 'genres come before the source filters');
});
