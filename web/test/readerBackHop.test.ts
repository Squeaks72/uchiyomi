// Back from the first page of a chapter lands on the last page of the one before (v0.104.0). The Previous-chapter
// button already did this with `?page=last`; a page turn, a key, a tap or a controller button now does too, in both
// the paged track and the webtoon column, and at most once a second so a held key cannot run through chapters.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { join } from 'path';

const src = readFileSync(join(__dirname, '..', 'app/reader/page.tsx'), 'utf8');

test('hopBack goes to the previous chapter at its end, rate-limited', () => {
  const m = src.match(/const hopBack = \(\) => \{[\s\S]*?\n  \};/);
  assert.ok(m, 'hopBack exists');
  assert.match(m[0], /!prevId/);
  assert.match(m[0], /lastHop\.current < 1000/);
  assert.match(m[0], /goChapter\(prevId, true\)/);
});

test('paged and webtoon back-steps from the start use it', () => {
  assert.match(src, /d < 0 && from === 0 && hopBack\(\)/);
  assert.match(src, /d < 0 && el\.scrollTop <= 1 && hopBack\(\)/);
});
