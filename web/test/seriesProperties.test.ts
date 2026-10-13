// "Properties…" on the series menu: where it is, and who sees which half. Source checks, like the repo's other
// UI-shape tests: the sheet is a component, and what must not drift is what it offers and to whom.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8');

test('the series menu has a Properties item that opens the sheet', () => {
  const menu = read('components/SeriesMenu.tsx');
  assert.match(menu, /tr\('Properties…'\)/);
  assert.match(menu, /SeriesPropertiesSheet/);
});

test('the content rating, library and source fields are the admin half; the reader reset is everyone\'s', () => {
  const sheet = read('components/SeriesPropertiesSheet.tsx');
  assert.match(sheet, /isAdmin && data && <AdminFields/);
  assert.match(sheet, /<Mine /);
  for (const f of ['Age rating', 'Always show', 'Reading direction', 'Series type']) assert.ok(sheet.includes(`tr('${f}')`), f);
  assert.match(sheet, /LibraryRow/);
  assert.match(sheet, /MigrateSourceSheet/);
  assert.match(sheet, /\/api\/admin\/series\/\$\{id\}\/meta/);
});

test('the sheet scrolls under Lenis\' hands-off marker', () => {
  assert.match(read('components/SeriesPropertiesSheet.tsx'), /data-lenis-prevent/);
});
