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

test('Edit details: the banner menu offers Refresh banner, and the server remakes an automatic banner when the art changes', () => {
  assert.match(read('components/SeriesEditor.tsx'), /label: tr\('Refresh banner'\)[\s\S]{0,120}disabled: ov\?\.banner === 'upload'/);
  const images = readFileSync(new URL('../../bff/src/routes/images.ts', import.meta.url), 'utf8');
  assert.match(images, /\$\{artVer\}/);
  assert.match(images, /const ownCover = !art\.banner && ovr\?\.cover/);
});

test('the client title key folds the way the server does', () => {
  assert.equal(titleKey('Éclair: The  Series!'), titleKey('eclair the series'));
  assert.equal(titleKey('...'), '');
});
