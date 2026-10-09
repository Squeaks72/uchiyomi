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

test('Edit details: the banner menu offers Refresh banner, and the server remakes an automatic banner when the art changes', () => {
  assert.match(read('components/SeriesEditor.tsx'), /label: tr\('Refresh banner'\)[\s\S]{0,120}disabled: ov\?\.banner === 'upload'/);
  const images = readFileSync(new URL('../../bff/src/routes/images.ts', import.meta.url), 'utf8');
  assert.match(images, /\$\{artVer\}/);
  assert.match(images, /const ownCover = !art\.banner && ovr\?\.cover/);
});

test('library view: libraries start from the default-visible ones and multiselect; single-choice filters and the sort are dropdowns', () => {
  const page = read('app/library/page.tsx');
  assert.match(page, /if \(libParam === null\) return defaultsNarrow \? defaultLibs : \[\];/);
  assert.match(page, /anyOf: libSel\.map/);
  assert.match(page, /data-library-sort/);
  const filters = read('components/LibraryFilters.tsx');
  assert.match(filters, /const GENRE_HEAD = 10;/);
  assert.match(filters, /<ChoiceSelect title=\{tr\('Read state'\)\}/);
  assert.match(filters, /<ChoiceSelect title=\{tr\('Status'\)\}/);
  assert.match(filters, /onLibs\(on \? libSel\.filter/);
  assert.match(read('app/admin/page.tsx'), /data-library-default-visible/);
});
