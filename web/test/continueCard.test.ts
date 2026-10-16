import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../components/cards.tsx', import.meta.url), 'utf8');
const card = src.slice(src.indexOf('export function ContinueCard'), src.indexOf('/** Grid tile (library / search). */'));

test('Keep reading: the card opens the chapter and the title opens the series, as two links that do not nest', () => {
  assert.match(card, /data-continue-chapter/);
  assert.match(card, /href=\{`\/series\/\?id=\$\{encodeURIComponent\(book\.seriesId\)\}`\} data-continue-series/);
  assert.equal((card.match(/<Link\b/g) ?? []).length, 2);
  const chapter = card.indexOf('data-continue-chapter');
  const closing = card.indexOf('/>', chapter);
  assert.ok(card.indexOf('data-continue-series') > closing, 'the title link is not inside the chapter link');
});

test('Keep reading has the series menu', () => {
  assert.match(card, /useSeriesMenu\(/);
  assert.match(card, /\{\.\.\.menu\.bind\}/);
  assert.match(card, /\{menu\.element\}/);
});
