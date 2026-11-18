import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { toneRgb, toneOf } from '../src/lib/pageTone';

// The server draws the reader's themes into the pages (lib/pageTone.ts) as the web drew them with CSS (web lib/readerPrefs.ts
// THEME_FILTER, still used for downloaded chapters). The two must stay the same look.
const web = readFileSync(join(__dirname, '../../web/lib/readerPrefs.ts'), 'utf8');

test('the server tones are the web filters, function for function', () => {
  assert.match(web, /paper: 'brightness\(0\.92\) sepia\(0\.25\) saturate\(1\.1\) brightness\(0\.94\)'/);
  assert.match(web, /sepia: 'sepia\(0\.55\) saturate\(1\.15\) brightness\(0\.94\)'/);
  assert.match(web, /gray: 'grayscale\(0\.25\) brightness\(0\.88\) contrast\(0\.95\)'/);
});

test('Paper turns white into the cream its note promises and leaves black black', () => {
  assert.deepEqual(toneRgb('paper', [1, 1, 1]).map((v) => Math.round(v * 255)), [240, 232, 216]);
  assert.deepEqual(toneRgb('paper', [0, 0, 0]), [0, 0, 0]);
});

test('only the three themes are a tone; Original and anything else is none', () => {
  assert.equal(toneOf('sepia'), 'sepia');
  assert.equal(toneOf('amoled'), null);
  assert.equal(toneOf('x'), null);
});
