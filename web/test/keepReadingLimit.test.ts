// Keep reading's length (lib/homeRails.ts keepReadingLimit): 8 cards unless the reader chose otherwise in Customize.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';
import { KEEP_READING_CHOICES, KEEP_READING_DEFAULT, keepReadingCards, keepReadingLimit } from '../lib/homeRails';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

test('the default is 8, and anything unreadable falls back to it, never to "all"', () => {
  assert.equal(KEEP_READING_DEFAULT, 8);
  for (const v of [undefined, null, '12', -1, 7, 3.5, NaN, {}, [8]]) assert.equal(keepReadingLimit(v), 8, String(v));
});

test('every offered choice is kept as chosen, 0 meaning all', () => {
  for (const n of KEEP_READING_CHOICES) assert.equal(keepReadingLimit(n), n);
  assert.ok((KEEP_READING_CHOICES as ReadonlyArray<number>).includes(0));
  assert.ok((KEEP_READING_CHOICES as ReadonlyArray<number>).includes(KEEP_READING_DEFAULT));
});

test('cards are cut to the limit, in order; 0 keeps them all', () => {
  const cards = Array.from({ length: 30 }, (_, i) => i);
  assert.deepEqual(keepReadingCards(cards, 8), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(keepReadingCards(cards, 0), cards);
  assert.deepEqual(keepReadingCards([1, 2], 8), [1, 2]);
});

test('Home draws Keep reading through the limit, and Customize offers it on the Keep reading row', () => {
  const home = read('app/page.tsx');
  assert.match(home, /keepReadingLimit\(user\?\.settings\?\.keepReadingLimit\)/);
  assert.match(home, /keepReadingCards\(data!\.onDeck, deckLimit\)\.map/);
  const sheet = read('components/HomeCustomize.tsx');
  assert.match(sheet, /deck=\{s\.key === 'continue'/);
  assert.match(sheet, /json: \{ keepReadingLimit: v \}/);
});
