import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const menu = readFileSync(new URL('../components/SeriesMenu.tsx', import.meta.url), 'utf8');
const cards = readFileSync(new URL('../components/cards.tsx', import.meta.url), 'utf8');

test('only the Keep reading card offers "Remove from Keep reading"', () => {
  assert.match(menu, /opts\?\.keepReading \? \[\{ label: tr\('Remove from Keep reading'\)/);
  assert.match(menu, /\/api\/keep-reading\/\$\{encodeURIComponent\(series\.id\)\}[\s\S]{0,80}hidden: true/);
  assert.match(cards, /undefined, \{ keepReading \}\)/);
  const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
  assert.equal((page.match(/<ContinueCard[^>]*keepReading/g) ?? []).length, 1, 'only the Keep reading row passes it');
});
