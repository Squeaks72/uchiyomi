import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { titleKey } from '../lib/ignoredTitles';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('Ignore is offered only for a title the library does not hold', () => {
  const menu = read('components/DiscoverMenu.tsx');
  assert.match(menu, /!libraryHref && !librarySeriesId \? \[\{\s*label: tr\('Ignore'\)/);
});

test('an ignored title leaves every card that is not a library series', () => {
  const hidden = read('lib/ignoredTitles.ts');
  assert.match(hidden, /!seriesId && ignored\.has\(titleKey\(title\)\)/);
});

test('library: sources sit below genres', () => {
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
  // v0.62: the sort is the toolbar's key + sheet (components/LibraryToolbar.tsx), the filters sections (FilterSection).
  assert.match(read('components/LibraryToolbar.tsx'), /data-library-sort=/);
  const filters = read('components/LibraryFilters.tsx');
  assert.match(filters, /const GENRE_HEAD = 10;/);
  assert.match(filters, /<FilterSection id="read" fold=\{fold\} title=\{tr\('Read state'\)\}/);
  assert.match(filters, /<FilterSection id="status" fold=\{fold\} title=\{tr\('Status'\)\}/);
  assert.match(filters, /onLibs\(on \? libSel\.filter/);
  assert.match(read('app/admin/page.tsx'), /data-library-default-visible/);
});

test('the client title key folds the way the server does', () => {
  assert.equal(titleKey('Éclair: The  Series!'), titleKey('eclair the series'));
  assert.equal(titleKey('...'), '');
});
