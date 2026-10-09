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
