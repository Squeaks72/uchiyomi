import test from 'node:test';
import assert from 'node:assert/strict';
import { guessMode, modeFromPages, modeFromKind, medianRatio } from '../lib/lookGuess';

const pg = (w: number, h: number) => ({ width: w, height: h });
const strips = [pg(800, 2400), pg(800, 3000), pg(800, 2800), pg(800, 1200)];
const book = [pg(1000, 1500), pg(1000, 1500), pg(2000, 1500), pg(1000, 1450)];

test('tall strips scroll, book pages page', () => {
  assert.equal(modeFromPages(strips), 'vertical');
  assert.equal(modeFromPages(book), 'paged', 'one double spread tipped a manga chapter');
});
test('too few or unmeasured pages say nothing, and junk is ignored', () => {
  assert.equal(modeFromPages([pg(800, 3000), pg(800, 3000)]), null);
  assert.equal(modeFromPages([{ width: null, height: null }, { width: null, height: null }, { width: null, height: null }]), null);
  assert.equal(medianRatio([...book, { width: 100, height: 9000, junk: true }]), medianRatio(book));
});
test('in-between shapes defer to the kind of comic', () => {
  const mid = [pg(1000, 2000), pg(1000, 2000), pg(1000, 2000)];
  assert.equal(modeFromPages(mid), null);
  assert.equal(guessMode(mid, 'manhwa', false), 'vertical');
  assert.equal(guessMode(mid, 'manga', false), 'paged');
  assert.equal(guessMode(mid, null, true), 'paged');
  assert.equal(guessMode(mid, null, false), null);
});
test('the pages beat the kind', () => {
  assert.equal(guessMode(strips, 'manga', true), 'vertical');
  assert.equal(guessMode(book, 'webtoon', false), 'paged');
  assert.equal(modeFromKind('unknown', false), null);
});

import { readFileSync } from 'fs';
import { join } from 'path';
test('the reader says where the mode came from, and an admin can save the look as the library default', () => {
  const src = readFileSync(join(__dirname, '..', 'app/reader/page.tsx'), 'utf8');
  assert.match(src, /Chosen for you from the pages/, 'a guess is not labelled as one');
  assert.match(src, /readerPrefs: \{ mode: prefs\.mode/, 'the library default key does not send the look');
  assert.match(src, /if \(!seriesId \|\| guessedFor\.current === seriesId \|\| !prefs\.autoMode/, 'the guess runs more than once or ignores the switch');
});
